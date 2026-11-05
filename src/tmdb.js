// TMDB through Kino's own service (`kino.tmdb`): Kino brings the key, so this plugin holds none and declares no TMDB host.
// `include_adult` is always false and 18+ is not a setting.
import { tmdbLanguage } from "./i18n.js";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const STILL_BASE = "https://image.tmdb.org/t/p/w300";

const GENRES = {
  28: ["Acción", "Action"], 12: ["Aventura", "Adventure"], 16: ["Animación", "Animation"], 35: ["Comedia", "Comedy"], 80: ["Crimen", "Crime"],
  99: ["Documental", "Documentary"], 18: ["Drama", "Drama"], 10751: ["Familia", "Family"], 14: ["Fantasía", "Fantasy"], 36: ["Historia", "History"],
  27: ["Terror", "Horror"], 10402: ["Música", "Music"], 9648: ["Misterio", "Mystery"], 10749: ["Romance", "Romance"],
  878: ["Ciencia ficción", "Science Fiction"], 10770: ["Película de TV", "TV Movie"], 53: ["Suspense", "Thriller"], 10752: ["Bélica", "War"], 37: ["Western", "Western"],
  10759: ["Acción y aventura", "Action & Adventure"], 10762: ["Infantil", "Kids"], 10763: ["Noticias", "News"], 10764: ["Reality", "Reality"],
  10765: ["Ciencia ficción y fantasía", "Sci-Fi & Fantasy"], 10766: ["Telenovela", "Soap"], 10767: ["Charla", "Talk"], 10768: ["Guerra y política", "War & Politics"],
};

// R3: Kino's own TMDB key allows 20 calls per 10 s per plugin (a cached or failed call counts too). Every caller goes through
// `ask`, which queues a call until fewer than 16 were spent in the last 10 s, so the plugin never trips the limit itself.
export const THROTTLE = { budget: 16, windowMs: 10000 };
const MAX_SLEEP_MS = 5000; // kino.sleep waits 0 to 5000 ms

const realClock = () => ({
  now: () => Date.now(),
  sleep: async (ms) => {
    await kino.sleep(ms);
  },
});
let clock = realClock();
let spent = []; // when each call in the window was made

/** The tests' fake clock: `{ now(), sleep(ms) }`. */
export function setClock(c) { clock = c; }
/** Forget the window and go back to the real clock. */
export function resetThrottle() { spent = []; clock = realClock(); }
/** The throttle's "now" (the job measures its own run with it). */
export const clockNow = () => clock.now();
/** How many calls the throttle would let through right now (the Home loads a rail only when all its calls fit). */
export function throttleRoom() {
  const now = clock.now();
  return THROTTLE.budget - spent.filter((at) => at > now - THROTTLE.windowMs).length;
}

async function acquire() {
  for (;;) {
    const now = clock.now();
    spent = spent.filter((at) => at > now - THROTTLE.windowMs);
    if (spent.length < THROTTLE.budget) {
      spent.push(now);
      return;
    }
    await clock.sleep(Math.max(1, Math.min(MAX_SLEEP_MS, spent[0] + THROTTLE.windowMs - now)));
  }
}

/** The person's own TMDB key (the `tmdbKey` setting), or "". With it the calls go straight to TMDB, outside Kino's shared budget. */
export function ownKey() {
  try {
    const k = kino.config.get("tmdbKey");
    return typeof k === "string" ? k.trim() : "";
  } catch {
    return "";
  }
}

/** One call with the person's own key; a refused key (401) is `null` so the caller falls back to Kino's. */
async function askOwn(key, path, params) {
  const q = new URLSearchParams({ ...params, api_key: key });
  const r = await kino.fetch(`https://api.themoviedb.org/3${path}?${q}`);
  if (r.status === 401) return null;
  if (!r.ok) throw kino.error(r.status === 404 ? "not_found" : "unavailable", "TMDB answered " + r.status);
  return r.json();
}

/** One TMDB call: with the person's own key when set (no throttle of ours), else `kino.tmdb`, throttled; its failures stay Kino's own errors (their `code` reaches Kino, which words them for the person). */
export async function ask(path, params) {
  const key = ownKey();
  if (key) {
    const body = await askOwn(key, path, params);
    if (body !== null) return body;
  }
  if (typeof kino.tmdb !== "function") throw kino.error("unavailable", "kino.tmdb needs Kino 0.9.53 or later"); // catalogOnly already needs 0.9.54
  await acquire();
  return kino.tmdb(path, params);
}

const yearOf = (date) => (typeof date === "string" && /^\d{4}/.test(date) ? date.slice(0, 4) : undefined);
const imageOf = (base, path) => (typeof path === "string" && path.startsWith("/") ? base + path : undefined);
/** The poster URL of a TMDB `poster_path`, or undefined. */
export const posterUrl = (path) => imageOf(IMAGE_BASE, path);

function genresOf(row, language) {
  const ids = Array.isArray(row.genre_ids) ? row.genre_ids : Array.isArray(row.genres) ? row.genres.map((g) => g && g.id) : [];
  const names = [];
  for (const id of ids) {
    const g = GENRES[id];
    if (g) names.push(language.startsWith("es") ? g[0] : g[1]);
  }
  return names;
}

/** A TMDB row of [kind] ("movie" | "series") -> a Kino item, or null for an adult row or one without an id or a title. */
export function toItem(row, kind, badges = [], language = tmdbLanguage()) {
  if (!row || typeof row !== "object" || row.adult === true) return null;
  const title = kind === "series" ? row.name : row.title;
  if (!Number.isInteger(row.id) || row.id < 1 || typeof title !== "string" || !title) return null;
  const ref = `${kind}:${row.id}`;
  const item = { id: `${kind}-${row.id}`, ref, kind, title, ids: { tmdb: row.id }, badges: [...badges] };
  const year = yearOf(kind === "series" ? row.first_air_date : row.release_date);
  if (year) item.year = year;
  const poster = imageOf(IMAGE_BASE, row.poster_path);
  if (poster) item.poster = poster;
  const backdrop = imageOf(BACKDROP_BASE, row.backdrop_path);
  if (backdrop) item.backdrop = backdrop;
  if (typeof row.overview === "string" && row.overview) item.overview = row.overview;
  if (typeof row.vote_average === "number" && row.vote_average > 0 && (row.vote_count === undefined || row.vote_count > 0)) item.rating = Math.round(row.vote_average * 10) / 10;
  const genres = genresOf(row, language);
  if (genres.length) item.genres = genres;
  return item;
}

/**
 * One discover page of a kind on a platform: `{ items, page, totalPages }` (empty `items` when the platform has nothing in
 * that region, which is not an error; `withOriginal` adds `originalTitle` for the local catalog). `since` ("YYYY-MM-DD") keeps what was released from then on, up to `until`.
 */
export async function discover({ kind, platform, region, sort = "popularity.desc", since, until, page = 1, language = tmdbLanguage(), withOriginal = false }) {
  const series = kind === "series";
  const params = {
    with_watch_providers: platform.providerId,
    watch_region: region,
    with_watch_monetization_types: "flatrate",
    include_adult: false,
    sort_by: sort,
    page,
    language,
  };
  const dateKey = series ? "first_air_date" : "primary_release_date";
  if (since) params[dateKey + ".gte"] = since;
  if (since && until) params[dateKey + ".lte"] = until;
  const body = await ask(series ? "/discover/tv" : "/discover/movie", params);
  const rows = body && Array.isArray(body.results) ? body.results : [];
  const items = [];
  for (const r of rows) {
    const item = toItem(r, kind, [platform.name], language);
    if (!item) continue;
    const original = series ? r.original_name : r.original_title;
    if (withOriginal && typeof original === "string" && original && original !== item.title) item.originalTitle = original; // for the catalog's search only
    items.push(item);
  }
  const totalPages = body && Number.isInteger(body.total_pages) ? body.total_pages : items.length ? page : 0;
  return { items, page, totalPages };
}

/** Lists of items -> one list: the same title (kind + TMDB id) once, with the badges of every list it was in. Order: first seen. */
export function mergeItems(lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const item of list) {
      const known = seen.get(item.ref);
      if (!known) seen.set(item.ref, { ...item, badges: [...(item.badges || [])] });
      else for (const b of item.badges || []) if (!known.badges.includes(b)) known.badges.push(b);
    }
  }
  return [...seen.values()];
}

/** Lists -> one list taking one item from each in turn (so the first screen shows every list), merged as `mergeItems` does. */
export function interleave(lists) {
  const byRef = new Map(mergeItems(lists).map((item) => [item.ref, item])); // badges in the lists' order
  const order = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length && !order.includes(l[i].ref)) order.push(l[i].ref);
  return order.map((ref) => byRef.get(ref));
}

/** A series' header and episodes: `/tv/{id}` plus its seasons through `append_to_response` (up to 20 seasons a request). */
export async function seriesWithEpisodes(id, language = tmdbLanguage()) {
  const show = await ask(`/tv/${id}`, { language });
  const numbers = (Array.isArray(show.seasons) ? show.seasons : []).map((s) => s && s.season_number).filter((n) => Number.isInteger(n) && n > 0);
  const episodes = [];
  for (let i = 0; i < numbers.length; i += 20) {
    const batch = numbers.slice(i, i + 20);
    const body = await ask(`/tv/${id}`, { language, append_to_response: batch.map((n) => `season/${n}`).join(",") });
    for (const n of batch) {
      const season = body[`season/${n}`];
      for (const e of season && Array.isArray(season.episodes) ? season.episodes : []) {
        if (!e || !Number.isInteger(e.episode_number)) continue;
        const ep = { season: n, number: e.episode_number, ref: `episode:${id}:${n}:${e.episode_number}` };
        if (typeof e.name === "string" && e.name) ep.title = e.name;
        const still = imageOf(STILL_BASE, e.still_path);
        if (still) ep.still = still;
        if (typeof e.overview === "string" && e.overview) ep.overview = e.overview;
        if (typeof e.air_date === "string" && e.air_date) ep.airDate = e.air_date;
        if (Number.isInteger(e.runtime) && e.runtime > 0) ep.runtimeMinutes = e.runtime;
        episodes.push(ep);
      }
    }
  }
  const info = { ids: { tmdb: Number.isInteger(show.id) ? show.id : Number(id) } };
  if (typeof show.name === "string" && show.name) info.title = show.name;
  const poster = imageOf(IMAGE_BASE, show.poster_path);
  if (poster) info.poster = poster;
  const backdrop = imageOf(BACKDROP_BASE, show.backdrop_path);
  if (backdrop) info.backdrop = backdrop;
  if (typeof show.overview === "string" && show.overview) info.overview = show.overview;
  const year = yearOf(show.first_air_date);
  if (year) info.year = year;
  const genres = genresOf(show, language);
  if (genres.length) info.genres = genres;
  if (typeof show.vote_average === "number" && show.vote_average > 0) info.rating = Math.round(show.vote_average * 10) / 10;
  return { series: info, episodes };
}
