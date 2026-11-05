// Language helpers. Everything the person reads exists in Spanish and English; the pick follows `kino.lang` (Kino's own
// language), read at call time because Kino restarts the runtime when the person changes it.

const kinoLang = () => (typeof kino !== "undefined" && kino && typeof kino.lang === "string" ? kino.lang : "es");

/** The bare language code of the person's Kino: "es" or "en" (anything that is not Spanish reads English). */
export function langOf() {
  return kinoLang().toLowerCase().startsWith("es") ? "es" : "en";
}

/** The Spanish or the English text, by the person's language. */
export function t(es, en) {
  return langOf() === "es" ? es : en;
}

/** The `language` parameter TMDB gets: titles and overviews in the person's language. */
export function tmdbLanguage() {
  return langOf() === "es" ? "es-MX" : "en-US";
}

/** The country the person's Kino language carries ("es-CO" -> "CO"), or "" when it names none. */
export function countryOfLang() {
  const m = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(kinoLang());
  return m ? m[1].toUpperCase() : "";
}

// ---- the screen's texts ----------------------------------------------------------------------------------------------------
// Every text the plugin's screen shows, as [Spanish, English] (or a function of its values that returns that pair). Nodes
// carry both (`text` / `textEn`...) and Kino picks by the person's language; `tw` builds that pair of properties.

export const SCREEN_TEXT = {
  // the tab bar and common buttons
  tabHome: ["Inicio", "Home"],
  tabSearch: ["Buscar", "Search"],
  tabFollowing: ["Siguiendo", "Following"],
  tabSettings: ["Ajustes", "Settings"],
  back: ["Atrás", "Back"],
  close: ["Cerrar", "Close"],
  next: ["Siguiente", "Next"],
  retry: ["Reintentar", "Retry"],

  // the stepper
  stepOf: (n) => [`Paso ${n} de 3`, `Step ${n} of 3`],
  step1Title: ["Qué es Mega Catálogo", "What Mega Catalog is"],
  step2Title: ["Tus plataformas y tu país", "Your platforms and your country"],
  step3Title: ["Comenzar", "Start"],
  introHeadline: ["Todo lo que hay en tus plataformas, en un solo lugar", "Everything on your platforms, in one place"],
  isTitle: ["Qué es", "What it is"],
  is1: ["El catálogo de lo que hay en cada plataforma que eliges, según tu país", "The catalog of what each platform you pick has, for your country"],
  is2: ["Lo nuevo y lo más visto, con búsqueda y la ficha de cada título", "What is new and most watched, with search and each title's page"],
  is3: ["Avisos cuando sale un capítulo nuevo de las series que sigues", "Notices when a new episode of a series you follow is out"],
  isNotTitle: ["Qué no es", "What it is not"],
  isNot1: ["No reproduce nada: «Buscar dónde verlo» te lleva a tus otros plugins", "It plays nothing: “Find where to watch” takes you to your other plugins"],
  isNot2: ["No es de ninguna plataforma y no necesita cuenta", "It belongs to no platform and needs no account"],
  credit: [
    "Datos de películas y series: TMDB. Disponibilidad por plataforma: JustWatch. Este producto usa la API de TMDB, pero TMDB no lo respalda ni lo certifica.",
    "Movie and series data: TMDB. Availability per platform: JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB.",
  ],
  platformsLabel: ["Plataformas", "Platforms"],
  platformsHint: ["Elige al menos una; puedes cambiarlas después en Ajustes", "Pick at least one; you can change them later in Settings"],
  pickPlatform: ["Elige al menos una plataforma", "Pick at least one platform"],
  countryLabel: ["País", "Country"],
  countryHint: ["Lo que hay en cada plataforma cambia por país", "What each platform has changes by country"],
  pickCountry: ["Elige tu país", "Pick your country"],
  summary: (names, country) => [`Vas a ver: ${names} · País: ${country[0]}`, `You will see: ${names} · Country: ${country[1]}`],
  startHint: [
    "Cargamos lo primero de cada plataforma ahora; el resto del catálogo se completa solo mientras usas la app.",
    "We load the first titles of each platform now; the rest of the catalog fills in by itself while you use the app.",
  ],
  start: ["Comenzar", "Start"],
  progress: (done, total) => [`Cargando ${done} de ${total}`, `Loading ${done} of ${total}`],
  stPending: ["En espera", "Waiting"],
  stOk: ["Listo", "Done"],
  stEmpty: ["Sin títulos en tu país", "No titles in your country"],
  stFailed: ["No se pudo cargar", "Could not load"],
  partialTitle: ["Algunas plataformas no cargaron", "Some platforms did not load"],
  partialText: (names) => [`No se pudo cargar: ${names}. Puedes reintentar o seguir con lo que cargó.`, `Could not load: ${names}. You can retry or go on with what loaded.`],
  failedTitle: ["No se pudo cargar ninguna plataforma", "No platform could be loaded"],
  failedText: ["Revisa tu conexión e inténtalo de nuevo.", "Check your connection and try again."],
  goCatalog: ["Ir al catálogo", "Go to the catalog"],
  ready: ["Listo: este es tu catálogo", "Done: this is your catalog"],

  noPlatformTitle: ["Elige una plataforma", "Pick a platform"],
  noPlatformText: ["Enciende al menos una plataforma en Ajustes para ver su catálogo.", "Turn on at least one platform in Settings to see its catalog."],
  openSettings: ["Abrir Ajustes", "Open Settings"],
  followingTitle: ["Series que sigues", "Series you follow"],
  followingCount: (n, max) => [`Sigues ${n} de ${max} series`, `You follow ${n} of ${max} series`],

  // the settings route
  setPlatformsTitle: ["Plataformas y país", "Platforms and country"],
  setShowTitle: ["Qué mostrar", "What to show"],
  setAppTitle: ["En esta app", "In this app"],
  setAppHint: ["Se guardan en tu cuenta de Kino y llegan a tus otros aparatos.", "Saved with your Kino account and sent to your other devices."],
  prefHideWatched: ["Ocultar lo que ya viste", "Hide what you already watched"],
  prefHideWatchedHint: ["Apagado, lo que viste lleva la marca «Visto». Necesita el permiso de biblioteca (Ajustes ▸ Mega Catálogo en Kino).", "Off, what you watched carries a “Watched” mark. It needs the library permission (Kino Settings ▸ Mega Catalog)."],
  prefAutoFollow: ["Seguir solas las series que guardas en Kino", "Follow the series you save in Kino by themselves"],
  prefAutoFollowHint: ["Hasta 10 series, con el aviso de capítulos nuevos activado; también necesita el permiso de biblioteca.", "Up to 10 series, with the new-episodes notices on; it also needs the library permission."],
  prefNotifyDigest: ["Resumen semanal de tus plataformas", "Weekly summary of your platforms"],
  prefNotifyDigestHint: ["Un aviso a la semana con lo nuevo; sale con el aviso de capítulos nuevos, que debe estar activado.", "One notice a week with what is new; it comes with the new-episodes notices, which must be on."],
  prefNewEpisodeDays: ["Capítulos nuevos: cuántos días mostrarlos", "New episodes: how many days to show them"],
  days: (n) => [`${n} días`, `${n} days`],
  noticesTitle: ["Avisos de capítulos nuevos", "New episode notices"],
  noticesText: [
    "Los avisos tienen su propio interruptor en Ajustes de Kino ▸ Mega Catálogo (Avisar de capítulos nuevos).",
    "The notices have their own switch in Kino's Settings ▸ Mega Catalog (Tell me about new episodes).",
  ],
  noticesOn: ["Están activados.", "They are on."],
  noticesOff: ["Están desactivados.", "They are off."],
  noticesEnable: ["Activar los avisos", "Turn the notices on"],
  maintenanceTitle: ["Mantenimiento", "Maintenance"],
  prefSaveFailed: ["No se pudo guardar", "Could not save"],

  // the actions
  introReset: ["Listo: la introducción se verá al abrir Mega Catálogo", "Done: the introduction shows when you open Mega Catalog"],
  catalogReloaded: ["Catálogo vaciado y recargándose", "Catalog cleared and reloading"],
  catalogCleared: ["Catálogo vaciado; se recarga al abrir Mega Catálogo", "Catalog cleared; it reloads when you open Mega Catalog"],
};

/**
 * The pair of properties of a screen text: `tw("next", "labelText")` -> `{ labelText: "Siguiente", labelTextEn: "Next" }`.
 * Extra arguments go to a text that is a function.
 */
export function tw(key, prop = "text", ...args) {
  const entry = SCREEN_TEXT[key];
  const [es, en] = typeof entry === "function" ? entry(...args) : entry;
  return { [prop]: es, [prop + "En"]: en };
}

/** A screen text in the person's language (a toast, an action's message), by `kino.lang`. */
export function tl(key, ...args) {
  const pair = tw(key, "text", ...args);
  return t(pair.text, pair.textEn);
}
