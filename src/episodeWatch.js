// New episodes of the followed series: the `episodes` job (checkEpisodes) and the Home row it feeds (newEpisodesRow).
//
// The job asks TMDB's `/tv/{id}` for `last_episode_to_air` of up to 8 followed series per run (a rotating cursor in
// kino.storage covers all 10 in two runs; at most 8 requests, under the job's 10). A series whose last aired episode is newer
// than its `seen` gets one notice in the Home bell (`ep-<tmdbId>`: the same id replaces the earlier one) and a `latest`, which
// is all the Home row reads, so the row never calls TMDB. Nothing but an episode already aired (on or before today) counts:
// `next_episode_to_air` and future dates are ignored.
import { isNewer, episodeOf, list, updateMany } from "./follows.js";
import { t, tmdbLanguage } from "./i18n.js";
import { newEpisodeDaysOf } from "./prefs.js";
import { ask, clockNow } from "./tmdb.js";

export const MAX_PER_RUN = 8;
export const MAX_RUN_MS = 12000; // stop between series well before the job's 20 s cap; what was checked is already saved
const CURSOR_KEY = "epCursor";
const DAY_MS = 86400000;

const isoToday = () => new Date().toISOString().slice(0, 10);
const dayBefore = (today, days) => new Date(Date.parse(today + "T00:00:00Z") - days * DAY_MS).toISOString().slice(0, 10);
const code = (s, e) => `${t("T", "S")}${s}·E${e}`;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function readCursor(n) {
  const c = Number.parseInt(kino.storage.get(CURSOR_KEY), 10);
  return Number.isInteger(c) && c >= 0 && c < n ? c : 0;
}

/** The notice for [follow]'s new episode [e], in both languages (title <= 80 characters, text <= 160). */
function noticeOf(follow, e) {
  const name = clip(follow.name, 60);
  const label = (s) => `${s}${e.season}·E${e.number}`;
  const text = e.title ? [`${label("T")} «${clip(e.title, 100)}» ya salió`, `${label("S")} “${clip(e.title, 100)}” is out`] : [`${label("T")} ya salió`, `${label("S")} is out`];
  return {
    id: `ep-${follow.tmdbId}`,
    title: `Nuevo capítulo de ${name}`,
    titleEn: `New episode of ${name}`,
    text: text[0],
    textEn: text[1],
    go: { titleByIds: { tmdb: follow.tmdbId, kind: "series", title: clip(follow.name, 120) } },
  };
}

/** Tries the notice. true: posted, or it can never be (no bell, or the person switched it off), so don't retry; false: retry next run. */
async function notify(follow, e) {
  if (typeof kino.notifications !== "object" || !kino.notifications || typeof kino.notifications.post !== "function") return { posted: false, retry: false };
  try {
    await kino.notifications.post(noticeOf(follow, e));
    return { posted: true, retry: false };
  } catch (err) {
    const denied = err && (err.code === "permission_denied" || err.code === "not_allowed");
    return { posted: false, retry: !denied };
  }
}

/**
 * The `episodes` job: `{ checked, posted, failed }`. A TMDB error on one series leaves its `seen` alone and the others go on; a
 * notice that could not be posted (rate limit) keeps `seen` so the next run tries again, while the Home row still learns.
 */
export async function checkEpisodes(ctx, { today = isoToday() } = {}) {
  const summary = { checked: 0, posted: 0, failed: 0 };
  const follows = list();
  if (!follows.length) return summary;
  const start = readCursor(follows.length);
  const count = Math.min(MAX_PER_RUN, follows.length);
  const language = tmdbLanguage();
  const startedAt = clockNow();
  let done = 0;
  // Each series is saved as soon as it is checked (its patch and the cursor), so a run Kino cuts keeps its progress.
  const save = (patches) => {
    updateMany(patches);
    kino.storage.set(CURSOR_KEY, String((start + done) % follows.length));
  };
  for (let i = 0; i < count; i++) {
    if (i > 0 && clockNow() - startedAt >= MAX_RUN_MS) break;
    const patches = new Map();
    done = i + 1;
    const follow = follows[(start + i) % follows.length];
    summary.checked++;
    let body;
    try {
      body = await ask(`/tv/${follow.tmdbId}`, { language });
    } catch {
      summary.failed++;
      save(patches);
      continue;
    }
    const last = episodeOf(body && body.last_episode_to_air);
    if (last && last.airDate > today) { save(patches); continue; } // not aired yet
    const baseline = last ? { season: last.season, number: last.number, airDate: last.airDate } : { season: 0, number: 0, airDate: "" };
    if (follow.seen === null) {
      patches.set(follow.tmdbId, (f) => { if (f.seen === null) f.seen = baseline; }); // the unknown baseline: no notice for what was already out
      save(patches);
      continue;
    }
    if (!last || !isNewer(last, follow.seen)) { save(patches); continue; }
    const outcome = await notify(follow, last);
    if (outcome.posted) summary.posted++;
    patches.set(follow.tmdbId, (f) => {
      const fresh = !f.latest || isNewer(last, f.latest);
      f.latest = { season: last.season, number: last.number, airDate: last.airDate, ...(last.title ? { title: last.title } : {}) };
      if (fresh) delete f.ackedAt; // a new episode shows the series again
      if (!outcome.retry) f.seen = baseline;
    });
    save(patches);
  }
  return summary;
}

/**
 * The Home row "Capítulos nuevos de tus series", or null: the followed series whose `latest` episode aired inside the last
 * `newEpisodeDays` (7/14/30, shared prefs) and that the person has not marked as seen, newest first. Reads kino.shared only.
 */
export function newEpisodesRow({ today = isoToday() } = {}) {
  const from = dayBefore(today, newEpisodeDaysOf());
  const fresh = list()
    .filter((f) => f.latest && !f.ackedAt && f.latest.airDate >= from && f.latest.airDate <= today)
    .sort((a, b) => (a.latest.airDate === b.latest.airDate ? a.tmdbId - b.tmdbId : a.latest.airDate < b.latest.airDate ? 1 : -1));
  if (!fresh.length) return null;
  return {
    id: "episodes",
    title: t("Capítulos nuevos de tus series", "New episodes of your series"),
    ref: "row:episodes:all",
    items: fresh.map((f) => {
      const item = { id: `series-${f.tmdbId}`, ref: `series:${f.tmdbId}`, kind: "series", title: f.name, ids: { tmdb: f.tmdbId }, badges: [t(`${code(f.latest.season, f.latest.number)} nuevo`, `${code(f.latest.season, f.latest.number)} new`)] };
      if (f.poster) item.poster = f.poster;
      return item;
    }),
  };
}
