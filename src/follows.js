// The series the person follows, in kino.shared key `follows` (it syncs between their devices; the only place follows live, so
// kino.storage's 256 KB per-run budget stays for the stage). At most 10 series (owner limit): the 11th is refused with a typed
// result and a message in both languages, never dropped silently. UI-facing calls answer `{ ok, ... }` instead of throwing.
//
// A record: { tmdbId, name, poster?, seen, latest?, ackedAt? }
//   seen    { season, number, airDate } the last aired episode already told about; { season: 0, number: 0, airDate: "" } when the
//           series had none aired yet; null when the baseline could not be read (the first check takes it without a notice).
//   latest  { season, number, title?, airDate } the newest aired episode the job found since the follow (the Home row reads it).
//   ackedAt ISO time of "Marcar como visto"; a newer episode clears it.
import { t, tmdbLanguage } from "./i18n.js";
import { ask, ownKey, posterUrl } from "./tmdb.js";

export const MAX_FOLLOWS = 10;
export const MAX_FOLLOWS_OWN_KEY = 100; // with the person's own TMDB key (kino.shared's 64 KB holds them with room to spare)

/** How many series may be followed now: 10, or 100 with the person's own TMDB key. */
export const maxFollows = () => (ownKey() ? MAX_FOLLOWS_OWN_KEY : MAX_FOLLOWS);
const KEY = "follows";
const MAX_NAME = 120;
const MAX_URL = 300;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isCount = (n) => Number.isInteger(n) && n >= 0 && n < 100000;

/** An episode `{ season, number, title?, airDate }` from TMDB's `last_episode_to_air` shape, or null when it has no usable date. */
export function episodeOf(e) {
  if (!e || typeof e !== "object" || !isCount(e.season_number) || !isCount(e.episode_number) || typeof e.air_date !== "string" || !DAY.test(e.air_date)) return null;
  const out = { season: e.season_number, number: e.episode_number, airDate: e.air_date };
  if (typeof e.name === "string" && e.name.trim()) out.title = e.name.trim().slice(0, MAX_NAME);
  return out;
}

/** Is [a] later than [b] (air date, then season, then number)? An empty [b] airDate means "none yet". */
export function isNewer(a, b) {
  if (!b) return true;
  if (a.airDate !== b.airDate) return a.airDate > b.airDate;
  if (a.season !== b.season) return a.season > b.season;
  return a.number > b.number;
}

function cleanEpisode(e, withTitle) {
  if (!e || typeof e !== "object" || !isCount(e.season) || !isCount(e.number) || typeof e.airDate !== "string" || !(DAY.test(e.airDate) || (e.airDate === "" && e.season === 0))) return null;
  const out = { season: e.season, number: e.number, airDate: e.airDate };
  if (withTitle && typeof e.title === "string" && e.title) out.title = e.title.slice(0, MAX_NAME);
  return out;
}

function cleanRecord(r) {
  if (!r || typeof r !== "object" || !Number.isInteger(r.tmdbId) || r.tmdbId < 1 || typeof r.name !== "string" || !r.name.trim()) return null;
  const out = { tmdbId: r.tmdbId, name: r.name.trim().slice(0, MAX_NAME), seen: cleanEpisode(r.seen, false) };
  if (typeof r.poster === "string" && /^https:\/\//.test(r.poster) && r.poster.length <= MAX_URL) out.poster = r.poster;
  const latest = cleanEpisode(r.latest, true);
  if (latest && DAY.test(latest.airDate)) out.latest = latest;
  if (typeof r.ackedAt === "string" && r.ackedAt.length <= 40) out.ackedAt = r.ackedAt;
  return out;
}

const hasShared = () => typeof kino !== "undefined" && kino && kino.shared && typeof kino.shared.get === "function";

function read() {
  let raw;
  try {
    raw = kino.shared.get(KEY);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const byId = new Map();
  for (const r of raw) {
    const c = cleanRecord(r);
    if (c && !byId.has(c.tmdbId)) byId.set(c.tmdbId, c);
  }
  return [...byId.values()].slice(0, MAX_FOLLOWS_OWN_KEY);
}

function write(items) {
  try {
    kino.shared.set(KEY, items);
    return true;
  } catch {
    return false;
  }
}

/** The followed series, validated (at most 10). Empty without `kino.shared`. */
export function list() {
  return hasShared() ? read() : [];
}

export function isFollowing(tmdbId) {
  return list().some((f) => f.tmdbId === tmdbId);
}

const fail = (code, es, en) => ({ ok: false, code, message: t(es, en), messageEs: es, messageEn: en });
const noShared = () => fail("unavailable", "No se pueden guardar las series que sigues en este aparato", "The series you follow cannot be saved on this device");
const limitReached = (count) => {
  const max = maxFollows();
  const own = max > MAX_FOLLOWS;
  return {
    ...fail("limit",
      `Ya sigues ${max} series. Deja de seguir una para agregar otra${own ? "" : ", o pon tu llave de TMDB en Ajustes para seguir hasta 100"}`,
      `You already follow ${max} series. Unfollow one to add another${own ? "" : ", or add your TMDB key in Settings to follow up to 100"}`),
    max,
    count,
  };
};

/**
 * Follow [series] `{ tmdbId, name, poster? }`. Answers `{ ok: true, added, count }`, or `{ ok: false, code, message, messageEs,
 * messageEn }` with code "limit" (the 11th; also `max`), "bad_request" or "unavailable". A new follow asks TMDB for the series'
 * current last aired episode and starts from it (no notice for old episodes); if TMDB fails the follow is kept with an unknown
 * baseline, which the first episode check takes silently.
 */
export async function follow(series) {
  if (!series || typeof series !== "object" || !Number.isInteger(series.tmdbId) || series.tmdbId < 1 || typeof series.name !== "string" || !series.name.trim()) {
    return fail("bad_request", "No se pudo seguir esta serie", "This series could not be followed");
  }
  if (!hasShared()) return noShared();
  const current = read();
  if (current.some((f) => f.tmdbId === series.tmdbId)) return { ok: true, added: false, count: current.length };
  if (current.length >= maxFollows()) return limitReached(current.length);
  let seen = null;
  let poster = typeof series.poster === "string" ? series.poster : undefined;
  try {
    const body = await ask(`/tv/${series.tmdbId}`, { language: tmdbLanguage() });
    const last = episodeOf(body && body.last_episode_to_air);
    seen = last ? { season: last.season, number: last.number, airDate: last.airDate } : { season: 0, number: 0, airDate: "" };
    if (!poster && body) poster = posterUrl(body.poster_path);
  } catch {
    // TMDB is down or slow: follow anyway, the first check takes the baseline
  }
  // the list may have changed (another device, another tap) while TMDB answered
  const fresh = read();
  if (fresh.some((f) => f.tmdbId === series.tmdbId)) return { ok: true, added: false, count: fresh.length };
  if (fresh.length >= maxFollows()) return limitReached(fresh.length);
  fresh.push(cleanRecord({ tmdbId: series.tmdbId, name: series.name, poster, seen }));
  if (!write(fresh)) return fail("unavailable", "No se pudo guardar la serie", "The series could not be saved");
  return { ok: true, added: true, count: fresh.length };
}

/** Stop following [tmdbId]: `{ ok: true, removed }`. */
export function unfollow(tmdbId) {
  if (!hasShared()) return noShared();
  const current = read();
  const rest = current.filter((f) => f.tmdbId !== tmdbId);
  if (rest.length === current.length) return { ok: true, removed: false };
  write(rest);
  return { ok: true, removed: true };
}

/** "Marcar como visto": [tmdbId], or every series when it is undefined. [at] is an ISO time (default now). */
export function acknowledge(tmdbId, at = new Date().toISOString()) {
  if (!hasShared()) return noShared();
  const current = read();
  for (const f of current) if (tmdbId === undefined || f.tmdbId === tmdbId) f.ackedAt = at;
  write(current);
  return { ok: true };
}

/**
 * Apply [patches] (`Map<tmdbId, fn(record)>`, each editing the record in place) to a fresh read of the list and write it once.
 * A series unfollowed meanwhile is skipped, so a long check never undoes the person's tap.
 */
export function updateMany(patches) {
  if (!hasShared() || !patches.size) return false;
  const current = read();
  let changed = false;
  for (const f of current) {
    const fn = patches.get(f.tmdbId);
    if (fn) {
      fn(f);
      changed = true;
    }
  }
  return changed ? write(current.map((f) => cleanRecord(f) || f)) : false;
}
