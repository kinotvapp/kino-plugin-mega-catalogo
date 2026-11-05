// The Home rows and the pages behind "Ver más": what the chosen platforms have, new and most watched, then the movies and the
// series across all of them. A title on several platforms is one card with every platform badge.
import { discover, interleave } from "./tmdb.js";
import { newEpisodesRow } from "./episodeWatch.js";
import { enabledPlatforms, kindsOf, newDaysOf, platformByKey, regionOf, rowTitle } from "./platforms.js";

const MAX_PAGE = 500; // TMDB serves no page past 500
const HOME_PLATFORMS = 3; // Home loads the first 3 chosen platforms (3 x 2 rows x 2 kinds = 12 calls); the rest come from browse and the screen

const KIND_OF_ROW = { movies: "movie", series: "series" };

/** "YYYY-MM-DD" for [today] (an ISO date, default now) minus [days]. */
export function daysBefore(today, days) {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const isoToday = () => new Date().toISOString().slice(0, 10);

/** The discover query of one kind of row: "new" is popular among what came out in the window, "top" is popular overall. */
function queryOf(type, config, today) {
  if (type === "new") return { sort: "popularity.desc", since: daysBefore(today, newDaysOf(config)), until: today };
  return { sort: "popularity.desc" };
}

/** One row's page for [platform]: its kinds, each asked on its own and interleaved. `settled` keeps a failure per kind. */
const askKinds = (platform, kinds, region, query, page) =>
  Promise.allSettled(kinds.map((kind) => discover({ kind, platform, region, page, ...query })));

const itemsOf = (settled) => interleave(settled.filter((s) => s.status === "fulfilled").map((s) => s.value.items));

/**
 * The Home rows with what happened: `{ rows, loaded, failed }`. `loaded` are the platforms TMDB answered for (even with
 * nothing), `failed` are `{ platform, error }` for the ones it did not. A platform with nothing in the region gives no row and
 * no failure. Never throws on TMDB's account: the caller decides what a total failure means.
 */
export async function homeRowsDetailed(config, { today = isoToday() } = {}) {
  const chosen = enabledPlatforms(config);
  if (!chosen.length) return { rows: [], loaded: [], failed: [] };
  const platforms = chosen.slice(0, HOME_PLATFORMS);
  const region = regionOf(config);
  const kinds = kindsOf(config);
  const perPlatform = await Promise.all(platforms.map(async (platform) => ({
    platform,
    fresh: await askKinds(platform, kinds, region, queryOf("new", config, today), 1),
    top: await askKinds(platform, kinds, region, queryOf("top", config, today), 1),
  })));

  const rows = [];
  const loaded = [];
  const failed = [];
  for (const { platform, fresh, top } of perPlatform) {
    const all = [...fresh, ...top];
    const rejected = all.find((s) => s.status === "rejected");
    if (rejected && all.every((s) => s.status === "rejected")) failed.push({ platform, error: rejected.reason });
    else loaded.push(platform);
    for (const [type, settled] of [["new", fresh], ["top", top]]) {
      const items = itemsOf(settled);
      if (items.length) rows.push({ id: `${type}-${platform.key}`, title: rowTitle[type](platform.name), ref: `row:${type}:${platform.key}`, items });
    }
  }
  if (kinds.length > 1 || platforms.length > 1) {
    kinds.forEach((kind, i) => {
      const type = kind === "movie" ? "movies" : "series";
      const items = interleave(perPlatform.map(({ top }) => (top[i].status === "fulfilled" ? top[i].value.items : [])));
      if (items.length) rows.push({ id: type, title: rowTitle[type](), ref: `row:${type}:all`, items, genre: type === "movies" ? "peliculas" : "series" });
    });
  }
  // A title on several of these platforms shows every one of their badges, in each row it is in.
  const badgesOf = new Map();
  for (const row of rows) for (const item of row.items) {
    const seen = badgesOf.get(item.ref) || new Set();
    for (const b of item.badges) seen.add(b);
    badgesOf.set(item.ref, seen);
  }
  const order = platforms.map((p) => p.name);
  for (const row of rows) row.items = row.items.map((item) => ({ ...item, badges: order.filter((b) => badgesOf.get(item.ref).has(b)) }));
  return { rows, loaded, failed };
}

/** The Home rows. When every enabled platform failed, the first failure is thrown so Kino words it; partial failures keep the rest. */
export async function homeRows(config, options) {
  const first = newEpisodesRow(options); // from kino.shared, no TMDB call; null when nothing is new
  const { rows, failed, loaded } = await homeRowsDetailed(config, options);
  if (!rows.length && !loaded.length && failed.length && !first) throw failed[0].error;
  return first ? [first, ...rows] : rows;
}

/** A row `ref` ("row:<new|top|movies|series>:<platform key|all>") -> its parts, or null. */
export function parseRowRef(ref) {
  const m = /^row:(new|top|movies|series|episodes):([a-z]+)$/.exec(String(ref || ""));
  return m ? { type: m[1], key: m[2] } : null;
}

/** One page of a row, `{ items, next }`: `next` is the following page number while TMDB has more. */
export async function rowPage(config, ref, cursor, { today = isoToday() } = {}) {
  const row = parseRowRef(ref);
  if (!row) throw kino.error("not_found", "unknown row");
  if (row.type === "episodes") {
    const episodes = newEpisodesRow({ today });
    return { items: episodes ? episodes.items : [] };
  }
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(cursor, 10) || 1));
  const region = regionOf(config);
  let settled;
  let pickPlatforms;
  if (row.key === "all") {
    pickPlatforms = enabledPlatforms(config);
    const kind = KIND_OF_ROW[row.type];
    if (!kind) throw kino.error("not_found", "unknown row");
    settled = await Promise.allSettled(pickPlatforms.map((platform) => discover({ kind, platform, region, page, ...queryOf("top", config, today) })));
  } else {
    const platform = platformByKey(row.key);
    if (!platform || (row.type !== "new" && row.type !== "top")) throw kino.error("not_found", "unknown row");
    settled = await askKinds(platform, kindsOf(config), region, queryOf(row.type, config, today), page);
  }
  const ok = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  if (!ok.length && settled.length) throw settled[0].reason;
  const more = page < MAX_PAGE && ok.some((r) => r.totalPages > page);
  const out = { items: interleave(ok.map((r) => r.items)) };
  if (more) out.next = String(page + 1);
  return out;
}
