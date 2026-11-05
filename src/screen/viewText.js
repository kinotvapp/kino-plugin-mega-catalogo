// The texts of the Buscar and Siguiendo routes, as [Spanish, English] (or a function of its values that returns that pair), in the
// same shape as i18n.js SCREEN_TEXT. `vw` reads these first and then SCREEN_TEXT (the tab names, Reintentar, the platform
// empty state...), so a route never repeats a text the plugin already has.
import { SCREEN_TEXT, t } from "../i18n.js";

export const VIEW_TEXT = {
  // Buscar
  searchLabel: ["Buscar películas y series", "Search movies and series"],
  searchHint: ["Escribe un título", "Type a title"],
  searchGo: ["Buscar", "Search"],
  filterPlatform: ["Plataforma", "Platform"],
  filterKind: ["Tipo", "Type"],
  allPlatforms: ["Todas", "All"],
  allKinds: ["Todo", "All"],
  kindMovies: ["Películas", "Movies"],
  kindSeries: ["Series", "Series"],
  searchIdleTitle: ["Busca en tus plataformas", "Search your platforms"],
  searchIdleText: [
    "Escribe un título y pulsa Buscar. Solo verás lo que está en las plataformas que elegiste, en tu país.",
    "Type a title and press Search. You only see what is on the platforms you picked, in your country.",
  ],
  searching: (q) => [`Buscando «${q}»…`, `Searching for “${q}”…`],
  resultsCount: (n, q) => [n === 1 ? `1 resultado para «${q}»` : `${n} resultados para «${q}»`, n === 1 ? `1 result for “${q}”` : `${n} results for “${q}”`],
  noResultsTitle: ["Sin resultados en tus plataformas", "No results on your platforms"],
  noResultsText: (q) => [
    `No encontramos «${q}» en las plataformas que elegiste. Revisa cómo está escrito o enciende más plataformas en Ajustes.`,
    `We found no “${q}” on the platforms you picked. Check the spelling or turn on more platforms in Settings.`,
  ],
  filteredTitle: ["Nada con estos filtros", "Nothing with these filters"],
  filteredText: ["Hay resultados, pero ninguno con el filtro que elegiste.", "There are results, but none with the filter you picked."],
  clearFilters: ["Quitar filtros", "Clear filters"],
  searchErrorTitle: ["No se pudo buscar", "The search failed"],
  searchErrorText: ["Revisa tu conexión e inténtalo de nuevo.", "Check your connection and try again."],
  searchErrorRate: ["Hay muchas búsquedas seguidas. Espera unos segundos y reintenta.", "Too many searches in a row. Wait a few seconds and retry."],

  // Siguiendo
  followingEmptyTitle: ["Aún no sigues ninguna serie", "You do not follow any series yet"],
  followingEmptyText: [
    "Sigue una serie y te avisamos cuando salga un capítulo nuevo. Los avisos llegan al teléfono y necesitan su interruptor en Ajustes de Kino ▸ Mega Catálogo (Avisar de capítulos nuevos).",
    "Follow a series and we tell you when a new episode is out. The notices arrive on the phone and need their switch in Kino's Settings ▸ Mega Catalog (Tell me about new episodes).",
  ],
  newMark: ["Nuevo", "New"],
  lastEpisode: (code, title, date) => [
    `Último: ${code.es}${title ? ` «${title}»` : ""} · ${date}`,
    `Latest: ${code.en}${title ? ` “${title}”` : ""} · ${date}`,
  ],
  noEpisodeYet: ["Sin capítulos nuevos todavía", "No new episodes yet"],
  unfollow: ["Dejar de seguir", "Unfollow"],
  unfollowAsk: (name) => [`¿Dejar de seguir «${name}»?`, `Unfollow “${name}”?`],
  markSeen: ["Marcar como visto", "Mark as seen"],
  markAllSeen: ["Marcar todo como visto", "Mark all as seen"],
  openTitle: ["Ver ficha", "Open page"],
  addTitle: ["Agregar una serie", "Add a series"],
  addLabel: ["Buscar una serie para seguir", "Search for a series to follow"],
  addHint: ["Busca en el catálogo de tus plataformas", "Search your platforms' catalog"],
  follow: ["Seguir", "Follow"],
  alreadyFollowing: ["Siguiendo", "Following"],
  addNone: (q) => [`No hay series «${q}» en tus plataformas`, `No series “${q}” on your platforms`],
  addErrorText: ["No se pudo buscar. Revisa tu conexión e inténtalo de nuevo.", "The search failed. Check your connection and try again."],
  followedToast: (name) => [`Ahora sigues «${name}»`, `You now follow “${name}”`],
  unfollowedToast: (name) => [`Dejaste de seguir «${name}»`, `You unfollowed “${name}”`],
  seenToast: ["Marcado como visto", "Marked as seen"],
  seenAllToast: ["Todo marcado como visto", "Everything marked as seen"],
  followFailed: ["No se pudo seguir esta serie", "This series could not be followed"],
};

/** A text of this module or of SCREEN_TEXT as the pair of properties (`text` / `textEn`, or [prop] / [prop]En). */
export function vw(key, prop = "text", ...args) {
  const entry = Object.hasOwn(VIEW_TEXT, key) ? VIEW_TEXT[key] : SCREEN_TEXT[key];
  const [es, en] = typeof entry === "function" ? entry(...args) : entry;
  return { [prop]: es, [prop + "En"]: en };
}

/** The same text in the person's language (a toast built from a plain string). */
export function vl(key, ...args) {
  const pair = vw(key, "text", ...args);
  return t(pair.text, pair.textEn);
}
