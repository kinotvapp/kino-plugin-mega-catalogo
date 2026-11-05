// What the title page loads: one TMDB request for the header, the credits, the logos, the similar titles and the watch providers
// (`append_to_response`), plus one for a series' season. Everything is cut down to what the screen draws, because Kino keeps the
// screen's state (64 KB) between calls. Every call goes through the throttled `ask`.
import { ask, toItem } from "../tmdb.js";
import { langOf, tmdbLanguage } from "../i18n.js";
import { castOf, pickLogo } from "../meta.js";

const BACKDROP = "https://image.tmdb.org/t/p/w780";
const POSTER = "https://image.tmdb.org/t/p/w342";
const PROVIDER_LOGO = "https://image.tmdb.org/t/p/w92";
const STILL = "https://image.tmdb.org/t/p/w300";
const MAX_SLIDES = 5;

/** The title's wide pictures (TMDB's backdrops, best voted first) for the banner's slider: [first], the one the page already has, leads. */
function backdropsOf(images, first) {
  const list = isObject(images) && Array.isArray(images.backdrops) ? images.backdrops : [];
  const sorted = list.filter((b) => isObject(b) && typeof b.file_path === "string" && Number(b.width) >= 1000).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  const out = [];
  for (const u of [first, ...sorted.map((b) => img(BACKDROP, b.file_path))]) {
    if (u && !out.some((x) => x.slice(x.lastIndexOf("/")) === u.slice(u.lastIndexOf("/")))) out.push(u);
  }
  return out.slice(0, MAX_SLIDES);
}
const MAX_CAST = 12;
const MAX_SIMILAR = 12;
const MAX_PER_GROUP = 10;
const MAX_EPISODES = 80; // a season page keeps the screen state small (the state is 64 KB for everything)
const MAX_TEXT = 2000;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const img = (base, path) => (typeof path === "string" && path.startsWith("/") ? base + path : undefined);
const text = (v, cap) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, cap) : "");
const day = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

/** The state key of a title: "movie:603". */
export const titleKey = (args) => `${args.kind}:${args.tmdbId}`;

function providersOf(block, region) {
  const here = isObject(block) && isObject(block.results) ? block.results[region] : null;
  if (!isObject(here)) return null;
  const group = (rows) => {
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const name = isObject(r) ? text(r.provider_name, 30) : "";
      if (!name || out.some((o) => o.name === name)) continue;
      const logo = img(PROVIDER_LOGO, r.logo_path);
      out.push({ name, ...(Number.isInteger(r.provider_id) ? { id: r.provider_id } : {}), ...(logo ? { logo } : {}) });
      if (out.length >= MAX_PER_GROUP) break;
    }
    return out;
  };
  const stream = group(here.flatrate);
  const free = group([...(Array.isArray(here.free) ? here.free : []), ...(Array.isArray(here.ads) ? here.ads : [])]);
  const paid = group([...(Array.isArray(here.rent) ? here.rent : []), ...(Array.isArray(here.buy) ? here.buy : [])]);
  if (!stream.length && !free.length && !paid.length) return null;
  return { stream, free, paid };
}

function similarOf(body, kind, language) {
  const rows = isObject(body.similar) && Array.isArray(body.similar.results) ? body.similar.results : [];
  const out = [];
  for (const row of rows) {
    const item = toItem(row, kind, [], language);
    if (!item || !item.poster) continue;
    out.push({ id: item.id, ref: item.ref, kind, title: item.title.slice(0, 80), ...(item.year ? { year: item.year } : {}), poster: item.poster, ids: item.ids });
    if (out.length >= MAX_SIMILAR) break;
  }
  return out;
}

function lastEpisodeOf(e) {
  if (!isObject(e) || !Number.isInteger(e.season_number) || !Number.isInteger(e.episode_number)) return null;
  const airDate = day(e.air_date);
  return airDate ? { season: e.season_number, number: e.episode_number, airDate } : null;
}

function seasonsOf(body) {
  const rows = Array.isArray(body.seasons) ? body.seasons : [];
  const out = [];
  for (const s of rows) {
    if (!isObject(s) || !Number.isInteger(s.season_number) || s.season_number < 1 || s.season_number > 999) continue;
    out.push({ n: s.season_number, ...(Number.isInteger(s.episode_count) && s.episode_count > 0 ? { count: s.episode_count } : {}) });
  }
  return out.slice(0, 60);
}

/** The season to open on: the one holding the last aired episode, else the latest one. */
export function initialSeason(seasons, last) {
  if (!seasons.length) return 0;
  if (last && seasons.some((s) => s.n === last.season)) return last.season;
  return seasons[seasons.length - 1].n;
}

/**
 * The title page's data for [args] `{ kind, tmdbId }` in [region]: `{ title, year, runtime?, seasonCount?, rating?, genres,
 * overview?, backdrop?, poster?, logo?, cast, platforms, similar, seasons, last?, season? }`. Throws Kino's error when TMDB
 * fails or has no such title (the screen shows a retry).
 */
export async function fetchTitle(args, region) {
  const series = args.kind === "series";
  const tmdbLang = tmdbLanguage();
  const lang = langOf();
  const base = (series ? "/tv/" : "/movie/") + args.tmdbId;
  const body = await ask(base, { language: tmdbLang, append_to_response: "credits,images,similar,watch/providers", include_image_language: lang === "es" ? "es,en,null" : "en,null" });
  if (!isObject(body)) throw kino.error("not_found", "no such title");
  const title = text(series ? body.name : body.title, 120);
  if (!title) throw kino.error("not_found", "no such title");
  let overview = text(body.overview, MAX_TEXT);
  if (!overview && tmdbLang !== "en-US") {
    try {
      const english = await ask(base, { language: "en-US" }); // the synopsis in the person's language is empty: the English one fills it
      overview = isObject(english) ? text(english.overview, MAX_TEXT) : "";
    } catch {
      // the page is complete enough without it
    }
  }
  const out = { title, genres: [], cast: castOf(body.credits).slice(0, MAX_CAST), similar: similarOf(body, args.kind, tmdbLang), platforms: providersOf(body["watch/providers"], region), seasons: [] };
  const date = day(series ? body.first_air_date : body.release_date);
  if (date) out.year = date.slice(0, 4);
  if (overview) out.overview = overview;
  const genres = (Array.isArray(body.genres) ? body.genres : []).map((g) => (isObject(g) ? text(g.name, 30) : "")).filter(Boolean);
  out.genres = genres.slice(0, 5);
  if (typeof body.vote_average === "number" && body.vote_average > 0 && (body.vote_count === undefined || body.vote_count > 0)) out.rating = Math.round(body.vote_average * 10) / 10;
  const backdrop = img(BACKDROP, body.backdrop_path);
  if (backdrop) out.backdrop = backdrop;
  const slides = backdropsOf(body.images, backdrop);
  if (slides.length > 1) out.images = slides;
  const poster = img(POSTER, body.poster_path);
  if (poster) out.poster = poster;
  const logo = pickLogo(body.images, lang);
  if (logo) out.logo = logo;
  if (series) {
    out.seasons = seasonsOf(body);
    if (Number.isInteger(body.number_of_seasons) && body.number_of_seasons > 0) out.seasonCount = body.number_of_seasons;
    else if (out.seasons.length) out.seasonCount = out.seasons.length;
    const last = lastEpisodeOf(body.last_episode_to_air);
    if (last) out.last = last;
    out.season = initialSeason(out.seasons, last);
  } else if (Number.isInteger(body.runtime) && body.runtime > 0) {
    out.runtime = body.runtime;
  }
  return out;
}

/** The episodes of [season] of series [tmdbId]: `[{ number, title?, airDate?, runtime?, still?, overview? }]` (empty when TMDB lists none). */
export async function fetchSeason(tmdbId, season) {
  const body = await ask(`/tv/${tmdbId}/season/${season}`, { language: tmdbLanguage() });
  const rows = isObject(body) && Array.isArray(body.episodes) ? body.episodes : [];
  const out = [];
  for (const e of rows) {
    if (!isObject(e) || !Number.isInteger(e.episode_number) || e.episode_number < 1) continue;
    const ep = { number: e.episode_number };
    const name = text(e.name, 80);
    if (name) ep.title = name;
    const airDate = day(e.air_date);
    if (airDate) ep.airDate = airDate;
    if (Number.isInteger(e.runtime) && e.runtime > 0) ep.runtime = e.runtime;
    if (typeof e.still_path === "string" && /^\/[A-Za-z0-9._-]+$/.test(e.still_path)) ep.still = STILL + e.still_path;
    const overview = text(e.overview, 110);
    if (overview) ep.overview = overview;
    out.push(ep);
    if (out.length >= MAX_EPISODES) break;
  }
  return out;
}
