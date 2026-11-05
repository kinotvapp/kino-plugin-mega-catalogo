// The streaming platforms the plugin knows, with TMDB's watch-provider ids, and the settings that choose among them.
import { countryOfLang, t } from "./i18n.js";

/** key = the suffix of the `p_<key>` toggle; providerId = TMDB's watch-provider id (`with_watch_providers`). */
export const PLATFORMS = [
  { key: "netflix", name: "Netflix", providerId: 8 },
  { key: "prime", name: "Prime Video", providerId: 9 },
  { key: "disney", name: "Disney+", providerId: 337 },
  { key: "max", name: "Max", providerId: 1899 },
  { key: "apple", name: "Apple TV+", providerId: 350 },
  { key: "paramount", name: "Paramount+", providerId: 531 },
  { key: "crunchyroll", name: "Crunchyroll", providerId: 283 },
  { key: "hulu", name: "Hulu", providerId: 15 },
];

export const platformByKey = (key) => PLATFORMS.find((p) => p.key === key) || null;

/** A setting's value from `kino.config` (an object with `get`) or from a plain object, which is what the tests pass. */
export function setting(config, key) {
  if (config && typeof config.get === "function") return config.get(key);
  return config && typeof config === "object" ? config[key] : undefined;
}

const isOn = (v) => v === true || v === "true";

/** The platforms whose `p_<key>` toggle is on, in the order of PLATFORMS. */
export function enabledPlatforms(config) {
  return PLATFORMS.filter((p) => isOn(setting(config, "p_" + p.key)));
}

/** The two-letter TMDB watch region: the person's country, or (on "auto") the one their Kino language carries, else US. */
export function regionOf(config) {
  const v = String(setting(config, "region") || "auto");
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return countryOfLang() || "US";
}

/** Which kinds the person wants: `["movie","series"]`, `["movie"]` or `["series"]`. */
export function kindsOf(config) {
  const v = setting(config, "kinds");
  return v === "movie" ? ["movie"] : v === "series" ? ["series"] : ["movie", "series"];
}

/** How many days back "new" reaches: 30, 90 (the default) or 180. */
export function newDaysOf(config) {
  const n = Number(setting(config, "newDays"));
  return n === 30 || n === 180 ? n : 90;
}

/** Whether Kino's Home shows this plugin's rows (default on). */
export function homeRowsOn(config) {
  const v = setting(config, "homeRows");
  return v === undefined || v === null || isOn(v);
}

/** The localized title of each kind of row. */
export const rowTitle = {
  new: (name) => t(`Nuevo en ${name}`, `New on ${name}`),
  top: (name) => t(`Lo más visto en ${name}`, `Most watched on ${name}`),
  movies: () => t("Películas", "Movies"),
  series: () => t("Series", "Series"),
};
