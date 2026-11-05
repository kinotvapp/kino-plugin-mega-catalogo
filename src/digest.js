// The weekly digest "Esta semana en tus plataformas" (off by default, pref notifyDigest): the `episodes` job posts at most one
// notice per ISO week, id `digest-<week>`, listing up to 3 titles that are new to the person. They come from data the plugin
// already has (the followed series with a new episode, then the titles the refresh job staged), so it costs no TMDB request.
import { list as followList } from "./follows.js";
import { newEpisodeDaysOf, prefsOf } from "./prefs.js";
import { regionOf } from "./platforms.js";

export const MAX_TITLES = 3;
const WEEK_KEY = "digestWeek";
const DAY_MS = 86400000;
const MAX_TITLE = 40;

/** The ISO 8601 week of [date] as `YYYY-Www`, with the year that week belongs to. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function stagedTitles(region) {
  try {
    const raw = kino.storage.get("stage");
    const stage = raw ? JSON.parse(raw) : null;
    if (!stage || stage.v !== 1 || stage.r !== region || !Array.isArray(stage.items)) return [];
    return stage.items.filter((s) => s && typeof s.ti === "string" && s.ti).map((s) => s.ti);
  } catch {
    return [];
  }
}

/** Up to 3 distinct titles: the followed series with a new episode in the window first, then the staged titles. */
export function digestTitles(config, { today = new Date() } = {}) {
  const from = new Date(today.getTime() - newEpisodeDaysOf() * DAY_MS).toISOString().slice(0, 10);
  const names = followList().filter((f) => f.latest && !f.ackedAt && f.latest.airDate >= from).map((f) => f.name);
  const out = [];
  for (const name of [...names, ...stagedTitles(regionOf(config))]) {
    const title = clip(name, MAX_TITLE);
    if (!out.includes(title)) out.push(title);
    if (out.length >= MAX_TITLES) break;
  }
  return out;
}

const joined = (titles, and) => (titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} ${and} ${titles[titles.length - 1]}`);

/**
 * Post this ISO week's digest when the preference is on, nothing was sent yet this week and there is something to say. Answers
 * `{ posted: true, id }` or `{ posted: false, reason: "off" | "sent" | "empty" | "failed" }`; never throws. The week counts as used
 * only once the notice is posted, so a bell that was off is tried again on the next run.
 */
export async function postDigest({ now = new Date(), config = kino.config } = {}) {
  if (!prefsOf().notifyDigest) return { posted: false, reason: "off" };
  const week = isoWeek(now);
  if (kino.storage.get(WEEK_KEY) === week) return { posted: false, reason: "sent" };
  const titles = digestTitles(config, { today: now });
  if (!titles.length) return { posted: false, reason: "empty" };
  if (typeof kino.notifications !== "object" || !kino.notifications || typeof kino.notifications.post !== "function") return { posted: false, reason: "failed" };
  const notice = {
    id: `digest-${week}`,
    title: "Esta semana en tus plataformas",
    titleEn: "This week on your platforms",
    text: clip(`Novedades: ${joined(titles, "y")}`, 160),
    textEn: clip(`New: ${joined(titles, "and")}`, 160),
    go: { screen: { route: "home" } },
  };
  try {
    await kino.notifications.post(notice);
  } catch {
    return { posted: false, reason: "failed" };
  }
  try {
    kino.storage.set(WEEK_KEY, week);
  } catch {
    // the notice is out; at worst the next run posts the same id again, which replaces it
  }
  return { posted: true, id: notice.id };
}
