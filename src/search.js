// Search: the local catalog first; while a chosen platform is thin in it (< 200 titles, R5), TMDB's own search too, keeping
// only the results that TMDB's watch-provider data confirms for the chosen platforms in the person's region.
import { enabledPlatforms, kindsOf, regionOf } from "./platforms.js";
import { tmdbLanguage } from "./i18n.js";
import { ask, mergeItems, toItem } from "./tmdb.js";
import { ensureRegion, mergeStage, platformCounts, query as queryCatalog, upsert } from "./store.js";

export const THIN_BELOW = 200; // a platform with fewer titles than this in the catalog is "thin"
export const MAX_CONFIRMATIONS = 10; // watch-provider lookups per search
const LOCAL_LIMIT = 40;
const MAX_QUERY = 256;
const TYPE_OF_KIND = { movie: "movie", series: "tv" };

/** The titles of /search/multi that could be shown (right kind, not adult, not already found), at most [max], as items. */
function candidates(body, kinds, skip, max) {
  const out = [];
  for (const row of body && Array.isArray(body.results) ? body.results : []) {
    const kind = row && row.media_type === "movie" ? "movie" : row && row.media_type === "tv" ? "series" : null;
    if (!kind || !kinds.includes(kind)) continue;
    const item = toItem(row, kind, []);
    if (!item || skip.has(item.ref)) continue;
    const original = kind === "series" ? row.original_name : row.original_title;
    if (typeof original === "string" && original && original !== item.title) item.originalTitle = original;
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/** The badges of [item]: the chosen platforms that carry it as flatrate in [region], or null when none does. */
async function confirm(item, platforms, region) {
  const body = await ask(`/${TYPE_OF_KIND[item.kind]}/${item.ids.tmdb}/watch/providers`, {});
  const flat = body && body.results && body.results[region] && Array.isArray(body.results[region].flatrate) ? body.results[region].flatrate : [];
  const ids = new Set(flat.map((p) => p && p.provider_id));
  const badges = platforms.filter((p) => ids.has(p.providerId)).map((p) => p.name);
  return badges.length ? { ...item, badges } : null;
}

/** `search(query)` of the plugin: `{ q }` -> items. A TMDB failure keeps the local answer; with nothing local it is thrown. */
export async function search(config, query) {
  const text = String((query && query.q) || "").trim().slice(0, MAX_QUERY);
  const platforms = enabledPlatforms(config);
  if (!text || !platforms.length) return [];
  const region = regionOf(config);
  const kinds = kindsOf(config);
  const keys = platforms.map((p) => p.key);

  let local = [];
  try {
    await ensureRegion(region);
    await mergeStage(region);
    local = await queryCatalog(text, { kinds, platforms: keys, limit: LOCAL_LIMIT });
  } catch (e) {
    kino.log && kino.log("catalog unavailable: " + (e && e.message));
  }

  const counts = platformCounts();
  if (!platforms.some((p) => (counts[p.key] || 0) < THIN_BELOW)) return local;

  let found;
  try {
    const body = await ask("/search/multi", { query: text, include_adult: false, language: tmdbLanguage(), page: 1 });
    found = candidates(body, kinds, new Set(local.map((i) => i.ref)), MAX_CONFIRMATIONS);
  } catch (e) {
    if (local.length) return local;
    throw e;
  }
  const settled = await Promise.allSettled(found.map((item) => confirm(item, platforms, region)));
  const confirmed = settled.filter((s) => s.status === "fulfilled" && s.value).map((s) => s.value);
  const failed = settled.find((s) => s.status === "rejected");
  if (!confirmed.length && !local.length && failed) throw failed.reason;
  if (confirmed.length) {
    try {
      await upsert(confirmed);
    } catch (e) {
      kino.log && kino.log("could not keep search results: " + (e && e.message));
    }
  }
  return mergeItems([local, confirmed.map(({ originalTitle, ...item }) => item)]);
}
