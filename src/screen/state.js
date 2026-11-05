// The screen app's state machine, pure (no tree, no network): which route is drawn, how the person moves between routes, and
// the first-run stepper (steps 1 -> 2 -> 3, then a run that loads the chosen platforms one per tick). The tree builders
// (shell.js, stepper.js, settingsView.js) only read what this module decides; index.js wires both to Kino's calls.
//
// Routes: `setup` (the stepper), `home`, `search`, `following`, `settings` (the four tabs, kept in the state key `route`)
// and `title` (a pushed Kino route, so Back returns to the tab it came from). Another surface opens a route with
// `go: { screen: { route, args } }`, which Kino hands as `route.name` / `route.args`.
import { PLATFORMS, enabledPlatforms, setting } from "../platforms.js";
import { countryOfLang } from "../i18n.js";

export const ROUTES = ["setup", "home", "title", "search", "following", "settings"];
export const TAB_ROUTES = ["home", "search", "following", "settings"];
export const TITLE_KINDS = ["movie", "series"];

/** The countries the person picks from: the manifest's `region` options without "auto" (a test keeps them equal). */
export const COUNTRIES = [
  { value: "CO", label: "Colombia", labelEn: "Colombia" },
  { value: "MX", label: "México", labelEn: "Mexico" },
  { value: "AR", label: "Argentina", labelEn: "Argentina" },
  { value: "CL", label: "Chile", labelEn: "Chile" },
  { value: "PE", label: "Perú", labelEn: "Peru" },
  { value: "EC", label: "Ecuador", labelEn: "Ecuador" },
  { value: "VE", label: "Venezuela", labelEn: "Venezuela" },
  { value: "UY", label: "Uruguay", labelEn: "Uruguay" },
  { value: "PY", label: "Paraguay", labelEn: "Paraguay" },
  { value: "BO", label: "Bolivia", labelEn: "Bolivia" },
  { value: "CR", label: "Costa Rica", labelEn: "Costa Rica" },
  { value: "PA", label: "Panamá", labelEn: "Panama" },
  { value: "DO", label: "República Dominicana", labelEn: "Dominican Republic" },
  { value: "GT", label: "Guatemala", labelEn: "Guatemala" },
  { value: "ES", label: "España", labelEn: "Spain" },
  { value: "US", label: "Estados Unidos", labelEn: "United States" },
  { value: "BR", label: "Brasil", labelEn: "Brazil" },
  { value: "GB", label: "Reino Unido", labelEn: "United Kingdom" },
  { value: "CA", label: "Canadá", labelEn: "Canada" },
];
const COUNTRY_CODES = COUNTRIES.map((c) => c.value);
export const countryByCode = (code) => COUNTRIES.find((c) => c.value === code) || null;

const PLATFORM_KEYS = PLATFORMS.map((p) => p.key);

// ---- setupDone (kino.storage) ----------------------------------------------------------------------------------------------

const SETUP_DONE = "setupDone";

export function isSetupDone(storage) {
  try {
    const v = storage.get(SETUP_DONE);
    return v === "1" || v === "true" || v === true;
  } catch {
    return false;
  }
}
export const markSetupDone = (storage) => storage.set(SETUP_DONE, "1");
/** The `resetIntro` action: the next opening shows the stepper again (the choices stay in the settings). */
export const resetIntro = (storage) => storage.remove(SETUP_DONE);

// ---- routes ----------------------------------------------------------------------------------------------------------------

const plainArgs = (a) => (a && typeof a === "object" && !Array.isArray(a) ? a : null);

/** A title route's args `{ kind, tmdbId }`, or null when they name no title. */
export function titleArgs(a) {
  const o = plainArgs(a);
  if (!o) return null;
  const tmdbId = Number(o.tmdbId);
  if (!TITLE_KINDS.includes(o.kind) || !Number.isInteger(tmdbId) || tmdbId < 1 || tmdbId > 2147483647) return null;
  return { kind: o.kind, tmdbId };
}

/**
 * The route to draw `{ name, args }`, from Kino's `route` (main, a pushed `title`, or the route a `go.screen` opened), the
 * state's `route` key (the tab the person picked) and whether the first run is done. Until it is, only the stepper shows.
 */
export function resolveRoute({ route, state, setupDone }) {
  if (!setupDone) return { name: "setup", args: null };
  const kinoName = route && typeof route.name === "string" ? route.name : "main";
  if (kinoName === "title") return { name: "title", args: titleArgs(plainArgs(route.args) || plainArgs(route.params)) };
  const s = state && typeof state === "object" ? state : {};
  if (ROUTES.includes(s.route) && s.route !== "title") return { name: s.route, args: plainArgs(s.args) };
  if (TAB_ROUTES.includes(kinoName)) return { name: kinoName, args: plainArgs(route.args) };
  return { name: "home", args: null };
}

/** The route the reserved `open` starts at: a `go.screen` route wins over the tab the state kept. */
export function openingRoute({ route, state, setupDone }) {
  const kinoName = route && typeof route.name === "string" ? route.name : "main";
  if (setupDone && TAB_ROUTES.includes(kinoName)) return { name: kinoName, args: plainArgs(route.args) };
  return resolveRoute({ route, state, setupDone });
}

/** The answer that moves to [to]: a tab patches the state; `title` is pushed so Back returns. Null for anything else. */
export function navigate(to, args = null) {
  if (to === "title") {
    const a = titleArgs(args);
    return a ? { route: { push: "title", params: a } } : null;
  }
  if (TAB_ROUTES.includes(to)) return { state: { route: to, args: plainArgs(args) } };
  return null;
}

// ---- the stepper -----------------------------------------------------------------------------------------------------------
// setup = { step: 1|2|3, picks: [platform keys], region: "CO"|null, run: null | { status, per: { <key>: status } } }
//   run.status: "loading" (ticks running), "done" (every platform loaded), "partial" (some failed, one loaded), "failed" (none)
//   per[key]:   "pending", "ok", "empty" (TMDB answered with nothing in the country: no failure), "failed"

const RUN_STATUSES = ["loading", "done", "partial", "failed"];
const PER_STATUSES = ["pending", "ok", "empty", "failed"];

const cleanPicks = (list) => PLATFORM_KEYS.filter((k) => Array.isArray(list) && list.includes(k));

/** A fresh stepper: the platforms already on and the country the settings (or an "es-CO"-like language) name, else none. */
export function initialSetup(config) {
  const saved = String(setting(config, "region") || "");
  const fromLang = countryOfLang();
  const region = COUNTRY_CODES.includes(saved) ? saved : COUNTRY_CODES.includes(fromLang) ? fromLang : null;
  return { step: 1, picks: enabledPlatforms(config).map((p) => p.key), region, run: null };
}

/** The stepper kept in the state, checked (the state is ours, but a newer or older version may have written it). */
export function cleanSetup(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const step = [1, 2, 3].includes(s.step) ? s.step : 1;
  const picks = cleanPicks(s.picks);
  const region = COUNTRY_CODES.includes(s.region) ? s.region : null;
  let run = null;
  if (s.run && typeof s.run === "object" && RUN_STATUSES.includes(s.run.status) && step === 3) {
    const per = {};
    for (const k of picks) per[k] = PER_STATUSES.includes(s.run.per && s.run.per[k]) ? s.run.per[k] : "pending";
    run = { status: s.run.status, per };
  }
  return { step, picks, region, run };
}

/**
 * Siguiente: step 1 -> 2; step 2 -> 3 with the form's `{ platforms, country }` (at least one known platform, a real country).
 * Answers `{ setup }`, or `{ setup, error: "pickPlatform" | "pickCountry" }` with what was picked kept and the step unchanged.
 */
export function setupNext(raw, value) {
  const s = cleanSetup(raw);
  if (s.step === 1) return { setup: { ...s, step: 2 } };
  if (s.step !== 2) return { setup: s };
  const v = value && typeof value === "object" ? value : {};
  const picks = cleanPicks(v.platforms);
  const region = COUNTRY_CODES.includes(v.country) ? v.country : null;
  if (!picks.length) return { setup: { ...s, region: region || s.region }, error: "pickPlatform" };
  if (!region) return { setup: { ...s, picks }, error: "pickCountry" };
  return { setup: { ...s, step: 3, picks, region, run: null } };
}

/** Atrás: one step back with the choices kept; never while the run is loading. */
export function setupBack(raw) {
  const s = cleanSetup(raw);
  if (s.run && s.run.status === "loading") return s;
  return { ...s, step: Math.max(1, s.step - 1), run: null };
}

/** A tap on a done step of Kino's `steps`: back to it (never forward, never while loading). */
export function setupGoto(raw, step) {
  const s = cleanSetup(raw);
  const n = Number(step);
  if (!Number.isInteger(n) || n < 1 || n >= s.step || (s.run && s.run.status === "loading")) return s;
  return { ...s, step: n, run: null };
}

/**
 * Comenzar: the settings to write with `config` (every platform toggle as a boolean, the explicit country) and the run with
 * every chosen platform pending. `{ error: "notReady" }` before step 3 or without a platform or a country.
 */
export function setupStart(raw) {
  const s = cleanSetup(raw);
  if (s.step !== 3 || !s.picks.length || !s.region) return { setup: s, error: "notReady" };
  const config = { region: s.region };
  for (const key of PLATFORM_KEYS) config["p_" + key] = s.picks.includes(key);
  const per = Object.fromEntries(s.picks.map((k) => [k, "pending"]));
  return { setup: { ...s, run: { status: "loading", per } }, config };
}

/** Reintentar: only the failed platforms go again; what loaded stays. */
export function setupRetry(raw) {
  const s = cleanSetup(raw);
  if (!s.run || s.run.status === "loading") return s;
  const per = Object.fromEntries(Object.entries(s.run.per).map(([k, v]) => [k, v === "failed" ? "pending" : v]));
  return { ...s, run: { status: "loading", per } };
}

/** The key of the control a step's D-pad focus belongs on (the node keys stepper.js draws), or null while the run loads. */
export function stepFocus(raw) {
  const s = cleanSetup(raw);
  if (s.step === 1) return "setupNext1";
  if (s.step === 2) return "platforms";
  if (!s.run) return "setupStart";
  if (s.run.status === "partial") return "setupFinish";
  if (s.run.status === "failed") return "setupRetry";
  return null;
}

/** `{ done, total }` of a run: how many platforms have an answer (loaded, empty or failed). */
export function runProgress(run) {
  const values = run ? Object.values(run.per) : [];
  return { done: values.filter((v) => v !== "pending").length, total: values.length };
}

const loadedSome = (per) => Object.values(per).some((v) => v === "ok" || v === "empty");

/**
 * One tick of the run: load the next pending platform with `loadPlatform(key, { region })` ("ok" or "empty"; a throw is a
 * failure of that platform only). When none is pending the run ends: `setupDone` is written only if one platform loaded.
 * Answers `{ setup, finished }`.
 */
export async function setupTick(raw, { loadPlatform, storage }) {
  const s = cleanSetup(raw);
  if (!s.run) return { setup: s, finished: false };
  if (s.run.status !== "loading") return { setup: s, finished: true };
  const per = { ...s.run.per };
  const next = s.picks.find((k) => per[k] === "pending");
  if (next) {
    try {
      per[next] = (await loadPlatform(next, { region: s.region })) === "empty" ? "empty" : "ok";
    } catch {
      per[next] = "failed";
    }
  }
  if (s.picks.some((k) => per[k] === "pending")) return { setup: { ...s, run: { status: "loading", per } }, finished: false };
  const anyFailed = Object.values(per).includes("failed");
  const status = !loadedSome(per) ? "failed" : anyFailed ? "partial" : "done";
  if (status !== "failed") markSetupDone(storage);
  return { setup: { ...s, run: { status, per } }, finished: true };
}
