// The "availability" door (plugin protocol, apiVersion 20): other plugins ask where a title can be watched. Both calls read
// TMDB's watch-provider data through the throttled caller; nothing is stored. Kino validates requests strictly and responses
// loosely (64 KB, 10 s), but the values are checked here too: only the known platforms leave, only what the person's TMDB says.
import { PLATFORMS, regionOf } from "./platforms.js";
import { ask, toItem } from "./tmdb.js";
import { tmdbLanguage } from "./i18n.js";

export const MAX_RESULTS = 8; // titles per search (each costs one providers lookup)
const MAX_QUERY = 100;
const TYPE_OF_KIND = { movie: "movie", series: "tv" };

const bad = (message) => kino.error("bad_request", message);

/** The platforms (key and name, in the plugin's order) of a `/watch/providers` body that carry the title in [region]: flatrate, free or with ads. */
export function platformsIn(body, region) {
  const block = body && typeof body === "object" && body.results && typeof body.results === "object" ? body.results[region] : null;
  const ids = new Set();
  if (block && typeof block === "object") {
    for (const group of ["flatrate", "free", "ads"]) {
      for (const p of Array.isArray(block[group]) ? block[group] : []) if (p && Number.isInteger(p.provider_id)) ids.add(p.provider_id);
    }
  }
  return PLATFORMS.filter((p) => ids.has(p.providerId)).map(({ key, name }) => ({ key, name }));
}

/** `where({ kind, tmdbId, region? })` -> `{ platforms, region }`; the region is the asked one, else the person's. */
export async function where(arg, config) {
  const a = arg && typeof arg === "object" ? arg : {};
  const type = Object.hasOwn(TYPE_OF_KIND, a.kind) ? TYPE_OF_KIND[a.kind] : null;
  if (!type) throw bad('kind must be "movie" or "series"');
  if (!Number.isInteger(a.tmdbId) || a.tmdbId < 1 || a.tmdbId > 999999999) throw bad("tmdbId must be a TMDB id");
  if (a.region !== undefined && a.region !== null && !/^[A-Za-z]{2}$/.test(String(a.region))) throw bad("region must be a two-letter country code");
  const region = a.region ? String(a.region).toUpperCase() : regionOf(config);
  const body = await ask(`/${type}/${a.tmdbId}/watch/providers`, {});
  return { platforms: platformsIn(body, region), region };
}

/** `search({ q })` -> up to 8 titles from TMDB's search, each with the platforms that carry it in the person's region. */
export async function searchTitles(arg, config) {
  const q = String((arg && typeof arg === "object" && arg.q) || "").trim();
  if (!q) throw bad("q is empty");
  if ([...q].length > MAX_QUERY) throw bad("q is too long");
  const region = regionOf(config);
  const body = await ask("/search/multi", { query: q, include_adult: false, language: tmdbLanguage(), page: 1 });
  const items = [];
  for (const row of body && Array.isArray(body.results) ? body.results : []) {
    const kind = row && row.media_type === "movie" ? "movie" : row && row.media_type === "tv" ? "series" : null;
    const item = kind ? toItem(row, kind, []) : null;
    if (item) items.push(item);
    if (items.length >= MAX_RESULTS) break;
  }
  const lookups = await Promise.allSettled(items.map((it) => ask(`/${TYPE_OF_KIND[it.kind]}/${it.ids.tmdb}/watch/providers`, {})));
  return items.map((it, i) => {
    const title = { tmdbId: it.ids.tmdb, kind: it.kind, title: it.title, platforms: lookups[i].status === "fulfilled" ? platformsIn(lookups[i].value, region) : [] };
    if (it.year) title.year = Number(it.year);
    if (it.poster) title.posterUrl = it.poster;
    return title;
  });
}
