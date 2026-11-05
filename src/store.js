// The local catalog: titles of the chosen platforms kept in `kino.catalog` (SQLite, searched by Kino) so search answers without
// asking TMDB. `kino.catalog` works in the screen, home and search paths but not in a job (R1), so the refresh job only
// *stages* compact titles in `kino.storage` and `mergeStage()` moves them into the catalog from a path where it works.
import { PLATFORMS, enabledPlatforms, kindsOf, regionOf } from "./platforms.js";
import { clockNow, discover } from "./tmdb.js";

/** `evictAbove`: the oldest rows (by the time they were last seen) go beyond it; Kino's own limit is 100,000. */
export const LIMITS = { evictAbove: 90000 };

const BATCH = 500; // kino.catalog.upsert / get / remove take at most 500
const MAX_TITLE = 300;
const MAX_QUERY = 256;
const FILL_PAGES_PER_STEP = 8;
const FILL_MAX_PAGES = 25; // per platform and kind: the 500 most popular titles are plenty for search
const MAX_STAGE = 400; // staged titles
const MAX_STAGE_BYTES = 90 * 1024; // the stage's JSON; a run may write 256 KB in all, and the job writes the stage at most twice
const QUERY_PAGE = 100;
const QUERY_MAX_PAGES = 5;
const POSTER_BASE = "https://image.tmdb.org/t/p/w342";

const KINDS = ["movie", "series"];
const nameOf = (key) => (PLATFORMS.find((p) => p.key === key) || {}).name;
const keyOfName = (name) => (PLATFORMS.find((p) => p.name === name) || {}).key;

function clip(text, max) {
  let t = String(text).slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t;
}

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---- small JSON values in kino.storage -------------------------------------------------------------------------------------

function readJson(key) {
  try {
    const raw = kino.storage.get(key);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}
const writeJson = (key, value) => kino.storage.set(key, JSON.stringify(value));

// ---- items <-> catalog records ---------------------------------------------------------------------------------------------

const isTitle = (it) => it && typeof it === "object" && KINDS.includes(it.kind) && it.ids && Number.isInteger(it.ids.tmdb) && it.ids.tmdb > 0 && typeof it.title === "string" && it.title;

/** A Kino item (with `badges` as platform names) -> the platform keys it carries. */
const keysOf = (item) => (Array.isArray(item.badges) ? item.badges.map(keyOfName).filter(Boolean) : []);

/** The catalog row of an item: its `title` is what Kino searches (the localized and the original title), `data` what is shown. */
function toRecord(item, keys, now) {
  const original = item.originalTitle && fold(item.originalTitle) !== fold(item.title) ? " " + item.originalTitle : "";
  const data = { k: item.kind, t: item.ids.tmdb, ti: clip(item.title, MAX_TITLE), b: keys };
  if (item.year) data.y = String(item.year);
  if (typeof item.poster === "string" && item.poster.startsWith(POSTER_BASE)) data.p = item.poster.slice(POSTER_BASE.length);
  if (typeof item.rating === "number") data.r = item.rating;
  return { id: item.id || `${item.kind}-${item.ids.tmdb}`, title: clip(item.title + original, MAX_TITLE), sort: now, data };
}

/** A catalog row -> a Kino item whose badges are the platforms of [chosen] (platform keys) it is on, in the platforms' order. */
function fromRecord(rec, chosen) {
  const d = rec.data;
  const badges = PLATFORMS.filter((p) => d.b.includes(p.key) && chosen.includes(p.key)).map((p) => p.name);
  const item = { id: rec.id, ref: `${d.k}:${d.t}`, kind: d.k, title: d.ti, ids: { tmdb: d.t }, badges };
  if (d.y) item.year = d.y;
  if (d.p) item.poster = POSTER_BASE + d.p;
  if (typeof d.r === "number") item.rating = d.r;
  return item;
}

const validRecord = (r) => r && r.data && typeof r.data === "object" && KINDS.includes(r.data.k) && Number.isInteger(r.data.t) && Array.isArray(r.data.b) && typeof r.data.ti === "string";

// ---- per-platform counts (how thick the catalog is) ------------------------------------------------------------------------

/** `{ netflix: 120, ... }`: how many titles each platform has in the catalog (search falls back to TMDB while one is thin). */
export function platformCounts() {
  const c = readJson("counts");
  return c && typeof c === "object" && !Array.isArray(c) ? c : {};
}

// ---- the catalog -----------------------------------------------------------------------------------------------------------

export const count = () => kino.catalog.count();

/** Empty the catalog and forget the counts and the fill cursor. */
export async function clear() {
  await kino.catalog.clear();
  kino.storage.remove("counts");
  kino.storage.remove("fill");
  kino.storage.remove("fillSig");
}

async function getAll(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += BATCH) for (const r of await kino.catalog.get(ids.slice(i, i + BATCH))) out.set(r.id, r);
  return out;
}

async function evictOldest() {
  let excess = (await kino.catalog.count()) - LIMITS.evictAbove;
  if (excess <= 0) return;
  const counts = platformCounts();
  while (excess > 0) {
    const { items } = await kino.catalog.search({ order: "oldest", limit: Math.min(100, excess) });
    if (!items.length) break;
    await kino.catalog.remove(items.map((r) => r.id));
    for (const r of items) for (const key of (r.data && r.data.b) || []) if (counts[key] > 0) counts[key]--;
    excess -= items.length;
  }
  writeJson("counts", counts);
}

/**
 * Write items into the catalog, one row per kind + TMDB id: a title seen again keeps the union of its platforms and is
 * marked seen now. Returns how many titles were new.
 */
export async function upsert(items, { now = clockNow() } = {}) {
  const wanted = new Map();
  for (const item of items || []) {
    if (!isTitle(item)) continue;
    const id = item.id || `${item.kind}-${item.ids.tmdb}`;
    const known = wanted.get(id);
    if (!known) wanted.set(id, { ...item, id, keys: keysOf(item) });
    else for (const k of keysOf(item)) if (!known.keys.includes(k)) known.keys.push(k);
  }
  if (!wanted.size) return 0;
  const existing = await getAll([...wanted.keys()]);
  const counts = platformCounts();
  let added = 0;
  const records = [];
  for (const [id, item] of wanted) {
    const prev = existing.get(id);
    const before = prev && prev.data && Array.isArray(prev.data.b) ? prev.data.b : [];
    const keys = PLATFORMS.map((p) => p.key).filter((k) => before.includes(k) || item.keys.includes(k));
    for (const k of keys) if (!before.includes(k)) counts[k] = (counts[k] || 0) + 1;
    if (!prev) added++;
    records.push(toRecord(item, keys, now));
  }
  for (let i = 0; i < records.length; i += BATCH) await kino.catalog.upsert(records.slice(i, i + BATCH));
  writeJson("counts", counts);
  await evictOldest();
  return added;
}

/**
 * Titles matching [text] (case and accents ignored, over the title and the original title) that are on at least one of the
 * [platforms] (keys) and of one of the [kinds]. A platform turned off only hides its titles; they stay in the catalog.
 */
export async function query(text, { kinds = KINDS, platforms = [], limit = 40 } = {}) {
  const q = clip(String(text || "").trim(), MAX_QUERY);
  if (!q || !platforms.length) return [];
  const out = [];
  for (let page = 0; page < QUERY_MAX_PAGES && out.length < limit; page++) {
    const { items, total } = await kino.catalog.search({ q, limit: QUERY_PAGE, offset: page * QUERY_PAGE, order: "newest" });
    for (const rec of items) {
      if (!validRecord(rec) || !kinds.includes(rec.data.k) || !rec.data.b.some((k) => platforms.includes(k))) continue;
      out.push(fromRecord(rec, platforms));
      if (out.length >= limit) break;
    }
    if ((page + 1) * QUERY_PAGE >= total) break;
  }
  return out;
}

/** A catalog is built for one watch region: when the person changes it, what was kept is for the wrong country. */
export async function ensureRegion(region) {
  const saved = kino.storage.get("catalogRegion");
  if (saved && saved !== region) await clear();
  if (saved !== region) kino.storage.set("catalogRegion", region);
}

// ---- filling the catalog from the screen and search (kino.catalog works there) ---------------------------------------------

/** The (platform, kind) lists to fill, in order. */
const pairsOf = (config) => enabledPlatforms(config).flatMap((platform) => kindsOf(config).map((kind) => ({ platform, kind })));

/**
 * One fill step: at most 8 popular discover pages of the chosen platforms and kinds, written to the catalog. [cursor] is
 * `{ i, page }` (which list, which page) or null to begin. Answers `{ cursor, done, added, pages }`; `cursor` is null when done.
 * A failure after the first page keeps what was loaded; a failure on the first page is thrown.
 */
export async function fillStep(config, cursor, { pages: maxPages = FILL_PAGES_PER_STEP } = {}) {
  const pairs = pairsOf(config);
  const region = regionOf(config);
  let i = cursor && Number.isInteger(cursor.i) && cursor.i >= 0 ? cursor.i : 0;
  let page = cursor && Number.isInteger(cursor.page) && cursor.page >= 1 ? cursor.page : 1;
  const loaded = [];
  let pages = 0;
  let failure = null;
  while (i < pairs.length && pages < maxPages) {
    const { platform, kind } = pairs[i];
    let result;
    try {
      result = await discover({ kind, platform, region, page, withOriginal: true });
    } catch (e) {
      failure = e;
      break;
    }
    pages++;
    loaded.push(...result.items);
    if (!result.items.length || page >= Math.min(result.totalPages, FILL_MAX_PAGES)) {
      i++;
      page = 1;
    } else {
      page++;
    }
  }
  if (failure && !pages) throw failure;
  const added = loaded.length ? await upsert(loaded) : 0;
  const done = !failure && i >= pairs.length;
  return { cursor: done ? null : { i, page }, done, added, pages };
}

const signature = (config) => `${regionOf(config)}|${pairsOf(config).map((p) => p.platform.key + p.kind).join(",")}`;

/**
 * Bring the catalog up to date from where the person is (the stepper, the screen): clear it if the region changed, merge the
 * job's stage, then run [steps] fill steps from the cursor kept in `kino.storage`. Answers `{ added, done }`.
 */
export async function ensureFilled(config, { steps = 1, pages } = {}) {
  await ensureRegion(regionOf(config));
  await mergeStage(regionOf(config));
  const sig = signature(config);
  let cursor = kino.storage.get("fillSig") === sig ? readJson("fill") : null;
  let added = 0;
  let done = false;
  for (let n = 0; n < steps && !done; n++) {
    if (cursor && cursor.done) {
      done = true;
      break;
    }
    const r = await fillStep(config, cursor, pages ? { pages } : undefined);
    added += r.added;
    done = r.done;
    cursor = r.done ? { done: true } : r.cursor;
    kino.storage.set("fillSig", sig);
    writeJson("fill", cursor);
  }
  return { added, done: done || Boolean(cursor && cursor.done) };
}

// ---- the job's stage (kino.storage) ----------------------------------------------------------------------------------------

/** An item -> its compact staged form (short keys: about 150 bytes). */
function toStaged(item) {
  const s = { k: item.kind, t: item.ids.tmdb, ti: clip(item.title, 120), b: keysOf(item) };
  if (item.originalTitle) s.o = clip(item.originalTitle, 120);
  if (item.year) s.y = String(item.year);
  if (typeof item.poster === "string" && item.poster.startsWith(POSTER_BASE)) s.p = item.poster.slice(POSTER_BASE.length);
  return s;
}

const validStaged = (s) => s && typeof s === "object" && KINDS.includes(s.k) && Number.isInteger(s.t) && s.t > 0 && typeof s.ti === "string" && s.ti && Array.isArray(s.b);

/** Bytes of [s] as UTF-8 (kino.storage counts bytes). */
const utf8Length = (s) => s.replace(/[-߿]/g, "xx").replace(/[ࠀ-￿]/g, "xxx").length;

/** Add titles to the stage (read back by `mergeStage`), merging the platforms of one that is already there; bounded. */
export function stageItems(items, region) {
  const stage = readJson("stage");
  const known = stage && stage.v === 1 && stage.r === region && Array.isArray(stage.items) ? stage.items.filter(validStaged) : [];
  const byKey = new Map(known.map((s) => [`${s.k}:${s.t}`, s]));
  for (const item of items || []) {
    if (!isTitle(item)) continue;
    const s = toStaged(item);
    const key = `${s.k}:${s.t}`;
    const prev = byKey.get(key);
    if (prev) {
      for (const k of s.b) if (!prev.b.includes(k)) prev.b.push(k);
    } else {
      byKey.set(key, s);
    }
  }
  const all = [...byKey.values()];
  let keep = all.slice(Math.max(0, all.length - MAX_STAGE));
  let json = JSON.stringify({ v: 1, r: region, items: keep });
  while (utf8Length(json) > MAX_STAGE_BYTES && keep.length > 1) { // long or non-Latin titles weigh more: drop the oldest
    keep = keep.slice(Math.ceil(keep.length / 10));
    json = JSON.stringify({ v: 1, r: region, items: keep });
  }
  kino.storage.set("stage", json);
}

/**
 * Move what the job staged into the catalog and clear the stage; a stage from another region is dropped. Safe to call
 * anywhere `kino.catalog` works (never in a job). Answers how many titles were merged.
 */
export async function mergeStage(region) {
  if (kino.storage.get("stage") === null) return 0;
  const stage = readJson("stage");
  if (!stage || stage.v !== 1 || !Array.isArray(stage.items) || (region && stage.r && stage.r !== region)) {
    kino.storage.remove("stage");
    return 0;
  }
  const items = stage.items.filter(validStaged).map((s) => ({
    id: `${s.k}-${s.t}`,
    kind: s.k,
    title: s.ti,
    ids: { tmdb: s.t },
    badges: s.b.map(nameOf).filter(Boolean),
    ...(s.o ? { originalTitle: s.o } : {}),
    ...(s.y ? { year: s.y } : {}),
    ...(s.p ? { poster: POSTER_BASE + s.p } : {}),
  }));
  if (items.length) await upsert(items);
  kino.storage.remove("stage");
  return items.length;
}
