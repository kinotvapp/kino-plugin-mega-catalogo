// `meta`: what Kino could not find about a title another plugin listed (logo, cast, synopsis, genres). One TMDB request per
// title (`append_to_response` for images and credits), through the throttled `ask`. It only describes; it never fails.
import { ask } from "./tmdb.js";
import { langOf } from "./i18n.js";

const POSTER = "https://image.tmdb.org/t/p/w342";
const BACKDROP = "https://image.tmdb.org/t/p/w780";
const LOGO = "https://image.tmdb.org/t/p/w500";
const PHOTO = "https://image.tmdb.org/t/p/w185";
const MAX_CAST = 20;
const TEXT_CAP = 60; // Kino reads 60 characters of a cast name and character
const GENRE_CAP = 30;

const img = (base, path) => (typeof path === "string" && path.startsWith("/") ? base + path : undefined);
const text = (v, cap) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, cap) : "");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The person's language code: the query's `lang` when it has one, else Kino's own. */
function languageOf(query) {
  const q = typeof query.lang === "string" ? query.lang.toLowerCase() : "";
  if (q) return q.startsWith("es") ? "es" : "en";
  return langOf();
}

/** The best clear logo in [lang], else in English: highest vote, then vote count. SVGs are skipped (they may not load). */
export function pickLogo(images, lang) {
  const logos = isObject(images) && Array.isArray(images.logos) ? images.logos : [];
  const usable = logos.filter((l) => isObject(l) && typeof l.file_path === "string" && /\.(png|jpe?g|webp)$/i.test(l.file_path));
  const best = (code) => usable.filter((l) => l.iso_639_1 === code).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0))[0];
  const chosen = best(lang) || best("en");
  return chosen ? img(LOGO, chosen.file_path) : undefined;
}

export function castOf(credits) {
  const rows = isObject(credits) && Array.isArray(credits.cast) ? credits.cast : [];
  const cast = [];
  for (const r of rows) {
    if (cast.length >= MAX_CAST) break;
    const name = isObject(r) ? text(r.name, TEXT_CAP) : "";
    if (!name) continue;
    const member = { name };
    const character = text(r.character, TEXT_CAP);
    if (character) member.character = character;
    const photo = img(PHOTO, r.profile_path);
    if (photo) member.photo = photo;
    cast.push(member);
  }
  return cast;
}

/** The TMDB id of the query: its own `tmdb`, else `/find` on its IMDb id. 0 when there is none. */
async function tmdbIdOf(query, kind, tmdbLang) {
  const ids = isObject(query.ids) ? query.ids : {};
  const own = typeof ids.tmdb === "string" && /^\d{1,9}$/.test(ids.tmdb) ? Number(ids.tmdb) : ids.tmdb;
  if (Number.isInteger(own) && own > 0) return own;
  if (typeof ids.imdb !== "string" || !/^tt\d{1,10}$/.test(ids.imdb)) return 0;
  const found = await ask(`/find/${ids.imdb}`, { external_source: "imdb_id", language: tmdbLang });
  const rows = isObject(found) ? found[kind === "movie" ? "movie_results" : "tv_results"] : null;
  const first = Array.isArray(rows) ? rows.find((r) => isObject(r) && Number.isInteger(r.id) && r.id > 0) : null;
  return first ? first.id : 0;
}

/** `meta(query)` -> what TMDB knows, or null: no usable id, a type that is not movie/series, nothing useful, or any failure. */
export async function meta(query) {
  try {
    if (!isObject(query) || (query.type !== "movie" && query.type !== "series")) return null;
    const kind = query.type;
    const lang = languageOf(query);
    const tmdbLang = lang === "es" ? "es-MX" : "en-US";
    const id = await tmdbIdOf(query, kind, tmdbLang);
    if (!id) return null;
    const path = kind === "movie" ? `/movie/${id}` : `/tv/${id}`;
    const body = await ask(path, { language: tmdbLang, append_to_response: "images,credits", include_image_language: lang === "es" ? "es,en" : "en" });
    if (!isObject(body)) return null;
    const out = {};
    let overview = text(body.overview, 4000);
    if (!overview && tmdbLang !== "en-US") {
      const english = await ask(path, { language: "en-US" }); // the synopsis in the person's language is empty: the English one fills it
      overview = isObject(english) ? text(english.overview, 4000) : "";
    }
    if (overview) out.overview = overview;
    const genres = (Array.isArray(body.genres) ? body.genres : []).map((g) => (isObject(g) ? text(g.name, GENRE_CAP) : "")).filter(Boolean).slice(0, 5);
    if (genres.length) out.genres = genres;
    const logo = pickLogo(body.images, lang);
    if (logo) out.logo = logo;
    const cast = castOf(body.credits);
    if (cast.length) out.cast = cast;
    const poster = img(POSTER, body.poster_path);
    if (poster) out.poster = poster;
    const backdrop = img(BACKDROP, body.backdrop_path);
    if (backdrop) out.backdrop = backdrop;
    if (!Object.keys(out).length) return null; // year and runtime alone are no answer for Kino
    const date = kind === "movie" ? body.release_date : body.first_air_date;
    if (typeof date === "string" && /^\d{4}/.test(date)) out.year = date.slice(0, 4);
    if (kind === "movie" && Number.isInteger(body.runtime) && body.runtime > 0) out.runtimeMinutes = body.runtime;
    return out;
  } catch (e) {
    return null;
  }
}
