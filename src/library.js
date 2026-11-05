// What the person watched and saved in Kino (`kino.library`, apiVersion 14; its red consent line and its switch are Kino's). Two
// uses, both off by default and both silent when the permission is off (`permission_denied`) or the API is missing:
//   - hideWatched: titles the person already watched are left out of the rails and the search (or marked "Visto" when it is off);
//   - autoFollow: the series they saved are followed (at most 10 in all, never replacing a follow, an unfollow sticks).
import { t } from "./i18n.js";
import { follow, list as followList, MAX_FOLLOWS } from "./follows.js";
import { prefsOf } from "./prefs.js";

export const WATCHED_TTL_MS = 60000; // kino.library allows 30 calls a minute: one read a minute is plenty for a screen
const READ_LIMIT = 100; // the most one call answers
const AUTO_KEY = "autofollowed"; // kino.shared: the series already followed on the person's behalf (so an unfollow sticks)
const MAX_AUTO = 200;

let cache = null;

/** Forget the cached watched set (the tests do; otherwise it expires after a minute). */
export function resetLibraryCache() {
  cache = null;
}

const available = () => typeof kino === "object" && kino && typeof kino.library === "object" && kino.library !== null;

/** The "Visto" mark on a card, in the person's language. */
export const watchedMark = () => t("Visto", "Watched");

/** `movie:603` / `series:1399`, from a library entry (`kind`, `ids.tmdb`) or a Kino item (`ref`, or `kind` + `ids.tmdb`); null without a TMDB id. */
export function refOfEntry(e) {
  if (!e || typeof e !== "object") return null;
  if (typeof e.ref === "string" && /^(movie|series):\d{1,10}$/.test(e.ref)) return e.ref;
  const tmdb = e.ids && Number.isInteger(e.ids.tmdb) ? e.ids.tmdb : null;
  return tmdb && tmdb > 0 && (e.kind === "movie" || e.kind === "series") ? `${e.kind}:${tmdb}` : null;
}

/** The refs of what the active profile watched (newest 100), or an empty set when the library is off, denied or failing. Never throws. */
export async function watchedRefs({ now = Date.now() } = {}) {
  if (cache && now - cache.at < WATCHED_TTL_MS) return cache.refs;
  const refs = new Set();
  if (available() && typeof kino.library.watched === "function") {
    try {
      const rows = await kino.library.watched({ limit: READ_LIMIT });
      for (const row of Array.isArray(rows) ? rows : []) {
        const ref = refOfEntry(row);
        if (ref) refs.add(ref);
      }
    } catch {
      // permission_denied (not approved or switched off), rate_limited, anything: the plugin simply shows everything
    }
  }
  cache = { at: now, refs };
  return refs;
}

/** `{ hide, watched }`: the person's hideWatched preference and the watched refs (read whatever the preference, for the "Visto" mark). */
export async function watchedView() {
  return { hide: prefsOf().hideWatched === true, watched: await watchedRefs() };
}

/** [items] without the ones in [watched] (Kino items). */
export function withoutWatched(items, watched) {
  if (!watched || !watched.size) return items;
  return items.filter((i) => !watched.has(refOfEntry(i)));
}

/** Kino Home rows without the watched titles; a row left empty goes; the new-episodes row is never touched. */
export function rowsWithoutWatched(rows, watched) {
  if (!watched || !watched.size) return rows;
  return rows.map((r) => (r.id === "episodes" ? r : { ...r, items: withoutWatched(r.items, watched) })).filter((r) => r.id === "episodes" || r.items.length);
}

/** The refs to hide from Kino's own Home and search: the watched ones when hideWatched is on, else none. */
export async function hiddenRefs() {
  const { hide, watched } = await watchedView();
  return hide ? watched : new Set();
}

function readAuto() {
  try {
    const v = kino.shared.get(AUTO_KEY);
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n > 0).slice(-MAX_AUTO) : [];
  } catch {
    return [];
  }
}

/**
 * Follow the series the person saved in Kino, when autoFollow is on: at most [maxNew] new follows now (each costs one TMDB
 * request), never past the 10-series limit, never replacing a follow, and a series the person unfollowed is not followed again.
 * Answers `{ added }` (how many), never throws.
 */
export async function autoFollow({ maxNew = 3 } = {}) {
  const none = { added: 0 };
  if (!prefsOf().autoFollow || !available() || typeof kino.library.saved !== "function") return none;
  let saved;
  try {
    saved = await kino.library.saved({ kind: "series", limit: READ_LIMIT });
  } catch {
    return none;
  }
  const following = new Set(followList().map((f) => f.tmdbId));
  const done = new Set(readAuto());
  let room = MAX_FOLLOWS - following.size;
  let added = 0;
  const marked = [];
  for (const row of Array.isArray(saved) ? saved : []) {
    if (room <= 0 || added >= maxNew) break;
    const ref = refOfEntry(row);
    if (!ref || !ref.startsWith("series:") || typeof row.title !== "string" || !row.title.trim()) continue;
    const tmdbId = Number(ref.slice(7));
    if (following.has(tmdbId) || done.has(tmdbId)) continue;
    const res = await follow({ tmdbId, name: row.title.trim().slice(0, 120) });
    if (res.ok && res.added) {
      added++;
      room--;
      marked.push(tmdbId);
    } else if (!res.ok && (res.code === "limit" || res.code === "unavailable")) break;
  }
  if (marked.length) {
    try {
      kino.shared.set(AUTO_KEY, [...readAuto(), ...marked].slice(-MAX_AUTO));
    } catch {
      // the follows are kept anyway; at worst a later unfollow is followed again
    }
  }
  return { added };
}
