// The plugin's extra preferences, one JSON object in kino.shared key `prefs` (it syncs between the person's devices and the job
// reads it). Kino's settings form is full at 12 values, so these are edited with the plugin's own widgets. What another device
// wrote is untrusted: every field is validated here.

/** The prefs object, or {} when there is none (or kino.shared is not available). */
export function readPrefs() {
  try {
    const v = kino.shared.get("prefs");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** How many days back the Home row of new episodes reaches: 7, 14 (the default) or 30. */
export function newEpisodeDaysOf(prefs = readPrefs()) {
  const n = Number(prefs.newEpisodeDays);
  return n === 7 || n === 30 ? n : 14;
}

/** The choices of `newEpisodeDays`. */
export const NEW_EPISODE_DAYS = [7, 14, 30];

/** Every pref, validated, with its default: `{ hideWatched, autoFollow, notifyDigest, newEpisodeDays }` (all off, 14 days). */
export function prefsOf(prefs = readPrefs()) {
  const p = prefs && typeof prefs === "object" ? prefs : {};
  return {
    hideWatched: p.hideWatched === true,
    autoFollow: p.autoFollow === true,
    notifyDigest: p.notifyDigest === true,
    newEpisodeDays: newEpisodeDaysOf(p),
  };
}

const BOOLEAN_PREFS = ["hideWatched", "autoFollow", "notifyDigest"];

/**
 * Write one pref (the screen's own widgets) and answer `{ ok: true, prefs }`, or `{ ok: false, code }`: "bad_request" for an
 * unknown key or a value it cannot take, "unavailable" when kino.shared refuses. Only the four known keys are ever stored.
 */
export function writePref(key, value) {
  const next = prefsOf();
  if (BOOLEAN_PREFS.includes(key) && typeof value === "boolean") next[key] = value;
  else if (key === "newEpisodeDays" && NEW_EPISODE_DAYS.includes(Number(value))) next[key] = Number(value);
  else return { ok: false, code: "bad_request" };
  try {
    kino.shared.set("prefs", next);
  } catch {
    return { ok: false, code: "unavailable" };
  }
  return { ok: true, prefs: next };
}
