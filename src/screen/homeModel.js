// The Inicio route's model, pure apart from the injected loaders: which rails the Home has and in what order, what the screen
// state keeps of each (compact titles, a status), one tick of lazy loading, and the view model homeView.js draws.
//
// Rails, in order: "Capítulos nuevos de tus series" (from the follows in kino.shared, no TMDB call; hidden when nothing is new),
// then per chosen platform "Nuevo en X" and "Lo más visto en X", then Películas and Series (built from the platforms' "most
// watched" rails, no call of their own), then a few genres across the chosen platforms. Each fetched rail loads on its own,
// one per tick and only when the TMDB throttle has room for it, so the Home never asks for everything at once; a failed rail
// keeps its place with a retry. When every rail is in, the hero's clear logos come one by one, and after that the local
// catalog keeps filling (store.ensureFilled), one step at a time and only while the throttle is idle.
//
// state.home = { v, sig, filter, rails: { <id>: { s: "ok"|"empty"|"failed", items: [compact] } }, hero: [slide],
//                logos: { <ref>: url | "" }, filled, fillFails }
//   compact = { k: "movie"|"series", t: tmdbId, ti: title, p?: poster path, y?: year, b: [platform keys] }
//   slide   = compact + { bd: backdrop path, tx: one line of overview }
import { PLATFORMS, enabledPlatforms, kindsOf, newDaysOf, platformByKey, regionOf } from "../platforms.js";
import { langOf, tmdbLanguage } from "../i18n.js";
import { daysBefore } from "../rows.js";
import { interleave, toItem } from "../tmdb.js";

export const HOME_V = 1;
export const RAIL_CARDS = 12; // cards kept per rail (the tree's 600 nodes hold 24 rails of 12)
export const HERO_SLIDES = 5;
export const TICK_MS = 1000;
export const FILL_PAGES_PER_TICK = 2; // catalog fill from the open screen: a few pages per tick, so a tap never waits long behind it

const POSTER = "https://image.tmdb.org/t/p/w342";
const BACKDROP = "https://image.tmdb.org/t/p/w780";
const LOGO = "https://image.tmdb.org/t/p/w500";
const MAX_TITLE = 120;
const MAX_LINE = 140;
const MAX_FILL_FAILS = 3;
const KINDS = ["movie", "series"];
const STATUSES = ["ok", "empty", "failed"];

/** The genre rails across the chosen platforms: TMDB's movie and TV genre ids, and the heading in both languages. */
export const GENRES = [
  { key: "action", movie: 28, series: 10759, es: "Acción y aventura", en: "Action and adventure" },
  { key: "comedy", movie: 35, series: 35, es: "Comedia", en: "Comedy" },
  { key: "animation", movie: 16, series: 16, es: "Animación", en: "Animation" },
  { key: "drama", movie: 18, series: 18, es: "Drama", en: "Drama" },
  { key: "documentary", movie: 99, series: 99, es: "Documentales", en: "Documentaries" },
];

const isoToday = () => new Date().toISOString().slice(0, 10);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clip = (s, n) => {
  const text = String(s || "").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n - 1).replace(/[\uD800-\uDBFF]$/, "") + "…" : text;
};
const pathOf = (url, base) => (typeof url === "string" && url.startsWith(base + "/") ? url.slice(base.length) : undefined);
const keyOfName = (name) => (PLATFORMS.find((p) => p.name === name) || {}).key;
const refOf = (c) => `${c.k}:${c.t}`;

// ---- the plan ---------------------------------------------------------------------------------------------------------------

/** What the rails depend on: when it changes (other platforms, country, kinds, window, language) the Home starts over. */
export function homeSignature(config) {
  return [regionOf(config), enabledPlatforms(config).map((p) => p.key).join(","), kindsOf(config).join(","), newDaysOf(config), langOf()].join("|");
}

/**
 * The fetched and derived rails in order (the episodes rail is not here: it comes from kino.shared at drawing time).
 * `cost` is how many TMDB calls loading it takes (0 for a derived rail).
 */
export function railPlan(config) {
  const kinds = kindsOf(config);
  const platforms = enabledPlatforms(config);
  const plan = [];
  for (const p of platforms) {
    plan.push({ id: "new-" + p.key, type: "new", platform: p.key, cost: kinds.length });
    plan.push({ id: "top-" + p.key, type: "top", platform: p.key, cost: kinds.length });
  }
  if (!platforms.length) return plan;
  if (kinds.includes("movie")) plan.push({ id: "movies", type: "movies", kind: "movie", cost: 0 });
  if (kinds.includes("series")) plan.push({ id: "series", type: "series", kind: "series", cost: 0 });
  for (const g of GENRES) plan.push({ id: "genre-" + g.key, type: "genre", genre: g.key, cost: kinds.length });
  return plan;
}

// ---- the state ---------------------------------------------------------------------------------------------------------------

export function freshHome(config, filter = "all") {
  return { v: HOME_V, sig: homeSignature(config), filter, rails: {}, hero: [], logos: {}, filled: false, fillFails: 0 };
}

function cleanCompact(c, slide = false) {
  if (!isObj(c) || !KINDS.includes(c.k) || !Number.isInteger(c.t) || c.t < 1 || typeof c.ti !== "string" || !c.ti) return null;
  const out = { k: c.k, t: c.t, ti: c.ti.slice(0, MAX_TITLE), b: Array.isArray(c.b) ? c.b.filter((k) => platformByKey(k)) : [] };
  if (typeof c.p === "string" && c.p.startsWith("/")) out.p = c.p;
  if (typeof c.y === "string" && /^\d{4}$/.test(c.y)) out.y = c.y;
  if (slide) {
    if (typeof c.bd !== "string" || !c.bd.startsWith("/")) return null;
    out.bd = c.bd;
    out.tx = typeof c.tx === "string" ? c.tx.slice(0, MAX_LINE) : "";
  }
  return out;
}

/** The Home kept in the state, checked; a fresh one when it is missing, from another version or for other settings. */
export function cleanHome(raw, config) {
  const sig = homeSignature(config);
  const keys = enabledPlatforms(config).map((p) => p.key);
  const filterOf = (f) => (keys.includes(f) ? f : "all");
  if (!isObj(raw) || raw.v !== HOME_V || raw.sig !== sig) return freshHome(config, isObj(raw) ? filterOf(raw.filter) : "all");
  const ids = new Set(railPlan(config).map((r) => r.id));
  const rails = {};
  if (isObj(raw.rails)) {
    for (const [id, r] of Object.entries(raw.rails)) {
      if (!ids.has(id) || !isObj(r) || !STATUSES.includes(r.s)) continue;
      rails[id] = { s: r.s, items: Array.isArray(r.items) ? r.items.map((c) => cleanCompact(c)).filter(Boolean).slice(0, RAIL_CARDS) : [] };
    }
  }
  const hero = Array.isArray(raw.hero) ? raw.hero.map((c) => cleanCompact(c, true)).filter(Boolean).slice(0, HERO_SLIDES) : [];
  const logos = {};
  if (isObj(raw.logos)) for (const [ref, url] of Object.entries(raw.logos)) if (/^(movie|series):\d+$/.test(ref) && typeof url === "string" && (url === "" || url.startsWith("https://"))) logos[ref] = url;
  const fillFails = Number.isInteger(raw.fillFails) && raw.fillFails >= 0 ? raw.fillFails : 0;
  return { v: HOME_V, sig, filter: filterOf(raw.filter), rails, hero, logos, filled: raw.filled === true, fillFails };
}

/** A Kino item (from tmdb.toItem) -> its compact form; `slide` keeps the backdrop and one line of the overview. */
export function compactOf(item, slide = false) {
  const c = { k: item.kind, t: item.ids.tmdb, ti: clip(item.title, MAX_TITLE), b: (item.badges || []).map(keyOfName).filter(Boolean) };
  const p = pathOf(item.poster, POSTER);
  if (p) c.p = p;
  if (item.year) c.y = String(item.year);
  if (slide) {
    c.bd = pathOf(item.backdrop, BACKDROP);
    c.tx = clip(item.overview || "", MAX_LINE);
  }
  return c;
}

/** The Home with [railId]'s answer `{ s, items }` (full items) in, and the hero topped up from it. */
export function applyRail(home, railId, { s, items = [] }) {
  const compact = [];
  const seen = new Set();
  for (const it of items) {
    if (!it || !it.ids || seen.has(it.ref)) continue;
    seen.add(it.ref);
    compact.push(compactOf(it));
    if (compact.length >= RAIL_CARDS) break;
  }
  const status = s === "failed" ? "failed" : compact.length ? "ok" : "empty";
  const hero = [...home.hero];
  if (status === "ok" && hero.length < HERO_SLIDES) {
    for (const it of items) {
      if (hero.length >= HERO_SLIDES) break;
      if (!it || !it.backdrop || !it.ids || hero.some((h) => refOf(h) === it.ref)) continue;
      const slide = compactOf(it, true);
      if (slide.bd) hero.push(slide);
    }
  }
  return { ...home, rails: { ...home.rails, [railId]: { s: status, items: status === "ok" ? compact : [] } }, hero };
}

/** Reintentar on a failed rail: it is pending again (the next tick loads it). */
export function retryRail(home, railId) {
  if (!home.rails[railId] || home.rails[railId].s !== "failed") return home;
  const rails = { ...home.rails };
  delete rails[railId];
  return { ...home, rails };
}

/** The platform chip: "all" or a chosen platform's key (anything else is "all"). */
export function setFilter(home, value, config) {
  const v = Array.isArray(value) ? value[0] : value;
  const keys = enabledPlatforms(config).map((p) => p.key);
  return { ...home, filter: keys.includes(v) ? v : "all" };
}

// ---- loading -----------------------------------------------------------------------------------------------------------------

const settledOf = (rail, home) => Boolean(home.rails[rail.id]);

/** The rails the current filter shows first: a platform's own rails come before the others while that platform is picked. */
function loadOrder(plan, filter) {
  if (filter === "all") return plan;
  return [...plan.filter((r) => r.platform === filter), ...plan.filter((r) => r.platform !== filter)];
}

/** The next rail to fetch, or null when every fetched rail has an answer. */
export function nextRail(home, plan) {
  return loadOrder(plan, home.filter).find((r) => r.cost > 0 && !settledOf(r, home)) || null;
}

/** The hero slide still waiting for its logo, or null. */
export const nextLogo = (home) => home.hero.find((h) => !(refOf(h) in home.logos)) || null;

/** What is left to do: "rails", "logos", "fill" or null (the timer runs only while something is). */
export function pendingWork(home, plan) {
  if (nextRail(home, plan)) return "rails";
  if (nextLogo(home)) return "logos";
  if (!home.filled && plan.length) return "fill";
  return null;
}

/** One rail's TMDB answer: `{ s: "ok"|"empty"|"failed", items }`. A kind that failed loses only its own titles. */
export async function loadRail(rail, config, { discover, ask, today = isoToday() }) {
  const kinds = kindsOf(config);
  const region = regionOf(config);
  let settled;
  if (rail.type === "new" || rail.type === "top") {
    const platform = platformByKey(rail.platform);
    const query = rail.type === "new" ? { sort: "popularity.desc", since: daysBefore(today, newDaysOf(config)), until: today } : { sort: "popularity.desc" };
    settled = await Promise.allSettled(kinds.map((kind) => discover({ kind, platform, region, page: 1, ...query })));
  } else if (rail.type === "genre") {
    const genre = GENRES.find((g) => g.key === rail.genre);
    const providers = enabledPlatforms(config).map((p) => p.providerId).join("|"); // TMDB reads "|" as "any of"
    const language = tmdbLanguage();
    settled = await Promise.allSettled(kinds.map(async (kind) => {
      const body = await ask(kind === "series" ? "/discover/tv" : "/discover/movie", {
        with_watch_providers: providers, watch_region: region, with_watch_monetization_types: "flatrate", include_adult: false,
        sort_by: "popularity.desc", page: 1, language, with_genres: genre[kind],
      });
      const rows = isObj(body) && Array.isArray(body.results) ? body.results : [];
      return { items: rows.map((r) => toItem(r, kind, [], language)).filter(Boolean) };
    }));
  } else {
    return { s: "empty", items: [] };
  }
  const ok = settled.filter((x) => x.status === "fulfilled");
  if (!ok.length) return { s: "failed", items: [] };
  const items = interleave(ok.map((x) => x.value.items));
  return { s: items.length ? "ok" : "empty", items };
}

/**
 * One tick of the Home: load the next rail (when the throttle has room for all its calls), else the next hero logo, else one
 * catalog fill step (only while the throttle is idle). Answers the new Home, or null when nothing changed (nothing to do, or
 * the throttle is busy). deps: `{ config, room() , budget, discover, ask, logoOf(kind, tmdbId), ensureFilled, today }`.
 */
export async function homeTick(home, deps) {
  const { config } = deps;
  const plan = railPlan(config);
  const rail = nextRail(home, plan);
  if (rail) {
    if (deps.room() < rail.cost) return null;
    let answer;
    try {
      answer = await loadRail(rail, config, deps);
    } catch {
      answer = { s: "failed", items: [] };
    }
    return applyRail(home, rail.id, answer);
  }
  const slide = nextLogo(home);
  if (slide) {
    if (deps.room() < 1) return null;
    let url = "";
    try {
      url = (await deps.logoOf(slide.k, slide.t)) || "";
    } catch {
      url = "";
    }
    return { ...home, logos: { ...home.logos, [refOf(slide)]: url } };
  }
  if (!home.filled && plan.length) {
    if (deps.room() < deps.budget) return null; // low priority: only while nothing else spends TMDB calls
    try {
      const r = await deps.ensureFilled(config, { steps: 1, pages: FILL_PAGES_PER_TICK });
      return r && r.done ? { ...home, filled: true } : null;
    } catch {
      const fillFails = home.fillFails + 1;
      return { ...home, fillFails, filled: fillFails >= MAX_FILL_FAILS };
    }
  }
  return null;
}

/**
 * A title's clear logo for the hero (one TMDB call): the best PNG/JPEG/WebP logo in [lang], else in English, by votes; "" when
 * there is none. SVGs are skipped (they may not load).
 */
export async function fetchLogo(ask, kind, tmdbId, lang = langOf()) {
  const body = await ask(`/${kind === "series" ? "tv" : "movie"}/${tmdbId}/images`, { include_image_language: `${lang},en,null` });
  const logos = isObj(body) && Array.isArray(body.logos) ? body.logos : [];
  const usable = logos.filter((l) => isObj(l) && typeof l.file_path === "string" && l.file_path.startsWith("/") && /\.(png|jpe?g|webp)$/i.test(l.file_path));
  const best = (code) => usable.filter((l) => l.iso_639_1 === code).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0))[0];
  const chosen = best(lang) || best("en");
  return chosen ? LOGO + chosen.file_path : "";
}

// ---- the view model ----------------------------------------------------------------------------------------------------------

const nameOfKey = (key) => (platformByKey(key) || {}).name;

/** Rail headings in both languages. */
function headingOf(rail) {
  if (rail.type === "new") return [`Nuevo en ${nameOfKey(rail.platform)}`, `New on ${nameOfKey(rail.platform)}`];
  if (rail.type === "top") return [`Lo más visto en ${nameOfKey(rail.platform)}`, `Most watched on ${nameOfKey(rail.platform)}`];
  if (rail.type === "movies") return ["Películas", "Movies"];
  if (rail.type === "series") return ["Series", "Series"];
  const g = GENRES.find((x) => x.key === rail.genre);
  return [g.es, g.en];
}

/**
 * The view model homeView.js draws: `{ empty, platforms, filter, hero, rails, ticking }`.
 *   hero  = { status: "skeleton"|"ok"|"none", slides: [{ key, kind, tmdbId, title, text, image, logo? }] }
 *   rails = [{ id, title, titleEn, status: "skeleton"|"ok"|"failed", items: [KinoItem], ref? }] (hidden ones are left out)
 * [episodesRow] is episodeWatch.newEpisodesRow()'s answer (or null), [followed] the followed series' TMDB ids,
 * [lang] picks the badges' language ("Siguiendo" / "Following"). [watched] (a Set of `kind:tmdb` refs from kino.library) is hidden
 * from the rails and the slides when [hideWatched] is on, else those cards carry the "Visto" / "Watched" badge; the new-episodes
 * rail is never touched.
 */
export function homeModel(home, { config, episodesRow = null, followed = [], lang = langOf(), watched = null, hideWatched = false }) {
  const platforms = enabledPlatforms(config).map((p) => ({ key: p.key, name: p.name }));
  const plan = railPlan(config);
  const filter = home.filter;
  const following = new Set(followed);
  const followMark = lang === "es" ? "Siguiendo" : "Following";

  // One card per title: every rail it is in adds its platforms, and each card shows them all.
  const badges = new Map();
  for (const r of Object.values(home.rails)) for (const c of r.items) {
    const set = badges.get(refOf(c)) || new Set();
    for (const k of c.b) set.add(k);
    badges.set(refOf(c), set);
  }
  for (const h of home.hero) {
    const set = badges.get(refOf(h)) || new Set();
    for (const k of h.b) set.add(k);
    badges.set(refOf(h), set);
  }
  const keysOf = (c) => {
    const set = badges.get(refOf(c)) || new Set(c.b);
    return platforms.map((p) => p.key).filter((k) => set.has(k));
  };
  const seen = watched instanceof Set ? watched : new Set();
  const watchedMark = lang === "es" ? "Visto" : "Watched";
  const onWatched = (c) => !(hideWatched && seen.has(refOf(c)));
  const onFilter = (c) => (filter === "all" || keysOf(c).includes(filter)) && !(hideWatched && seen.has(refOf(c)));
  const itemOf = (c) => {
    const item = { id: `${c.k}-${c.t}`, ref: refOf(c), kind: c.k, title: c.ti, ids: { tmdb: c.t } };
    if (c.p) item.poster = POSTER + c.p;
    if (c.y) item.year = c.y;
    const names = keysOf(c).map(nameOfKey);
    item.badges = c.k === "series" && following.has(c.t) ? [followMark, ...names] : names;
    if (!hideWatched && seen.has(refOf(c))) item.badges = [watchedMark, ...item.badges];
    return item;
  };

  const rails = [];
  if (episodesRow && Array.isArray(episodesRow.items) && episodesRow.items.length) {
    rails.push({ id: "episodes", title: "Capítulos nuevos de tus series", titleEn: "New episodes of your series", status: "ok", items: episodesRow.items.slice(0, RAIL_CARDS), episodes: true });
  }
  const tops = plan.filter((r) => r.type === "top" && (filter === "all" || r.platform === filter));
  for (const rail of plan) {
    if (rail.platform && filter !== "all" && rail.platform !== filter) continue;
    const [title, titleEn] = headingOf(rail);
    if (rail.cost === 0) {
      // Películas / Series: the most watched of the shown platforms, of that kind, taking one from each in turn.
      const lists = tops.map((t) => home.rails[t.id]).filter((r) => r && r.s === "ok").map((r) => r.items.filter((c) => c.k === rail.kind && onWatched(c)));
      const merged = [];
      const seen = new Set();
      const longest = Math.max(0, ...lists.map((l) => l.length));
      for (let i = 0; i < longest && merged.length < RAIL_CARDS; i++) for (const l of lists) {
        if (i < l.length && !seen.has(refOf(l[i])) && merged.length < RAIL_CARDS) { seen.add(refOf(l[i])); merged.push(l[i]); }
      }
      if (merged.length) rails.push({ id: rail.id, title, titleEn, status: "ok", items: merged.map(itemOf) });
      else if (tops.some((t) => !home.rails[t.id])) rails.push({ id: rail.id, title, titleEn, status: "skeleton", items: [] });
      continue;
    }
    const got = home.rails[rail.id];
    if (!got) { rails.push({ id: rail.id, title, titleEn, status: "skeleton", items: [] }); continue; }
    if (got.s === "failed") { rails.push({ id: rail.id, title, titleEn, status: "failed", items: [] }); continue; }
    const items = got.items.filter(onFilter).map(itemOf);
    if (items.length) rails.push({ id: rail.id, title, titleEn, status: "ok", items });
  }

  const slides = home.hero.filter(onFilter).map((h) => {
    const s = { key: `${h.k}-${h.t}`, kind: h.k, tmdbId: h.t, title: h.ti, text: h.tx, image: BACKDROP + h.bd };
    const logo = home.logos[refOf(h)];
    if (logo) s.logo = logo;
    return s;
  });
  const platformPending = plan.some((r) => r.platform && (filter === "all" || r.platform === filter) && !home.rails[r.id]);
  const hero = { status: slides.length ? "ok" : platformPending ? "skeleton" : "none", slides };
  return { empty: !platforms.length, platforms, filter, hero, rails, ticking: pendingWork(home, plan) !== null };
}
