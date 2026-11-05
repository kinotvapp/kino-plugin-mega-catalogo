// The Buscar route: a search field, filter chips (platform, movies or series), the results as a card grid and the states around
// them. Pure: `searchModel` decides the phase from the state, `searchView` draws it; index.js owns the events. The results live in
// the screen state as compact records (a card needs a handful of fields), rebuilt into cards on every draw.
import { vw } from "./viewText.js";

export const MAX_QUERY = 120;
export const MAX_RESULTS = 40; // a grid inside Kino's scroll draws all at once: 60 at most
export const SEARCH_TICK = { ms: 1000, event: "searchTick" };
export const ALL = "all";
const KINDS = ["movie", "series"];
const STATUSES = ["loading", "done", "error"];

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/** The text to search for: trimmed, inner spaces collapsed, at most MAX_QUERY characters ("" when it is not a string). */
export function cleanQuery(raw) {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY) : "";
}

/** A search result as the compact record kept in the state, or null when it names no title. */
export function compactItem(item) {
  const tmdb = item && item.ids ? item.ids.tmdb : undefined;
  if (!item || !KINDS.includes(item.kind) || !Number.isInteger(tmdb) || tmdb < 1 || typeof item.title !== "string" || !item.title) return null;
  const out = { kind: item.kind, tmdb, title: item.title.slice(0, 120), badges: (Array.isArray(item.badges) ? item.badges : []).filter((b) => typeof b === "string").slice(0, 8) };
  if ((Number.isInteger(item.year) && item.year > 0) || (typeof item.year === "string" && /^\d{4}$/.test(item.year))) out.year = String(item.year);
  if (typeof item.poster === "string" && item.poster.startsWith("https://") && item.poster.length <= 200) out.poster = item.poster;
  if (typeof item.rating === "number") out.rating = item.rating;
  return out;
}

/** A compact record read back from the state (it may come from another version), or null. */
export function cleanRecord(c) {
  if (!c || typeof c !== "object" || !KINDS.includes(c.kind) || !Number.isInteger(c.tmdb) || c.tmdb < 1 || typeof c.title !== "string" || !c.title) return null;
  return compactItem({ kind: c.kind, title: c.title, year: c.year, poster: c.poster, rating: c.rating, badges: c.badges, ids: { tmdb: c.tmdb } });
}

/** The records of [items], one per title (kind + TMDB id), at most MAX_RESULTS. */
export function compactItems(items) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const c = compactItem(it);
    if (!c || seen.has(c.kind + c.tmdb)) continue;
    seen.add(c.kind + c.tmdb);
    out.push(c);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/** The card (a Kino item) of a compact record; the tree makes its tap the `searchOpen` event (a push of the `title` route). */
export function cardOf(c) {
  const item = { id: `${c.kind}-${c.tmdb}`, ref: `${c.kind}:${c.tmdb}`, kind: c.kind, title: c.title, ids: { tmdb: c.tmdb }, badges: c.badges };
  if (c.year) item.year = c.year;
  if (c.poster) item.poster = c.poster;
  if (c.rating) item.rating = c.rating;
  return item;
}
export const cardsOf = (records) => records.map(cardOf);

/** The search kept in the state, checked, or null when there is none. */
export function cleanSearch(raw) {
  if (!raw || typeof raw !== "object") return null;
  const q = cleanQuery(raw.q);
  if (!q) return null;
  return {
    q,
    status: STATUSES.includes(raw.status) ? raw.status : "done",
    items: Array.isArray(raw.items) ? raw.items.map(cleanRecord).filter(Boolean).slice(0, MAX_RESULTS) : [],
    code: str(raw.code, 40),
  };
}

/** The chips' choices kept in the state: a platform that is on (or "all") and a kind (or "all"). */
export function cleanFilters(raw, platforms) {
  const f = raw && typeof raw === "object" ? raw : {};
  return {
    platform: platforms.some((p) => p.key === f.platform) ? f.platform : ALL,
    kind: KINDS.includes(f.kind) ? f.kind : ALL,
  };
}

/** The records on the picked platform (by badge) and of the picked kind. */
export function applyFilters(items, filters, platforms) {
  const platform = platforms.find((p) => p.key === filters.platform);
  return items.filter((i) => (filters.kind === ALL || i.kind === filters.kind) && (!platform || i.badges.includes(platform.name)));
}

/**
 * What to draw: `{ phase, q, code, platforms, kinds, filters, cards, total }`. Phases: noPlatforms, idle, loading, error, none (no
 * result at all), filtered (results, none with the chips) and results. [watched] (a Set of `kind:tmdb` refs from kino.library) is
 * dropped from the results when [hideWatched] is on, else its cards carry [watchedMark].
 */
export function searchModel({ search, filters, platforms, kinds, watched = null, hideWatched = false, watchedMark = "Visto" }) {
  const s = cleanSearch(search);
  const f = cleanFilters(filters, platforms);
  const base = { q: s ? s.q : "", code: s ? s.code : "", platforms, kinds, filters: f, cards: [], total: 0 };
  if (!platforms.length) return { ...base, phase: "noPlatforms" };
  if (!s) return { ...base, phase: "idle" };
  if (s.status === "loading") return { ...base, phase: "loading" };
  if (s.status === "error") return { ...base, phase: "error" };
  const seen = watched instanceof Set ? watched : new Set();
  const isSeen = (c) => seen.has(`${c.kind}:${c.tmdb}`);
  const kept = hideWatched ? s.items.filter((c) => !isSeen(c)) : s.items;
  if (!kept.length) return { ...base, phase: "none" };
  const shown = applyFilters(kept, f, platforms);
  const marked = hideWatched ? shown : shown.map((c) => (isSeen(c) ? { ...c, badges: [watchedMark, ...c.badges] } : c));
  return { ...base, phase: shown.length ? "results" : "filtered", cards: cardsOf(marked), total: kept.length };
}

// ---- the tree --------------------------------------------------------------------------------------------------------------

const GRID_COLUMNS = { compact: 3, medium: 4, expanded: 6 };

function searchField(model) {
  return {
    type: "TextField", key: "q", kind: "search", value: model.q, maxLength: MAX_QUERY,
    ...vw("searchLabel", "labelText"), ...vw("searchHint", "hintText"),
    onSubmitted: "search",
    trailingIcon: "search", ...vw("searchGo", "trailingLabel"), onTrailingTap: "search",
  };
}

function filterChips(model) {
  const out = [];
  if (model.platforms.length > 1) {
    out.push({
      type: "Chips", key: "sPlatform", value: model.filters.platform, ...vw("filterPlatform", "labelText"),
      onChanged: { event: "searchFilter", arg: "platform" },
      options: [{ value: ALL, ...vw("allPlatforms", "label") }, ...model.platforms.map((p) => ({ value: p.key, label: p.name, labelEn: p.name }))],
    });
  }
  if (model.kinds.length > 1) {
    out.push({
      type: "Chips", key: "sKind", value: model.filters.kind, ...vw("filterKind", "labelText"),
      onChanged: { event: "searchFilter", arg: "kind" },
      options: [{ value: ALL, ...vw("allKinds", "label") }, { value: "movie", ...vw("kindMovies", "label") }, { value: "series", ...vw("kindSeries", "label") }],
    });
  }
  return out;
}

const skeletons = () => ({
  type: "GridView", key: "searchSkeleton", columns: GRID_COLUMNS, gap: 12,
  children: Array.from({ length: 6 }, (_, i) => ({ type: "Skeleton", key: "sk-" + i, shape: "card", height: 160 })),
});

function body(model) {
  switch (model.phase) {
    case "noPlatforms":
      return { type: "Column", key: "searchNoPlatform", gap: 16, crossAxisAlignment: "center", children: [
        { type: "emptyState", icon: "tune", ...vw("noPlatformTitle", "title"), ...vw("noPlatformText") },
        { type: "ElevatedButton", key: "openSettings", icon: "settings", ...vw("openSettings", "labelText"), onPressed: { event: "tab", arg: "settings" } },
      ] };
    case "idle":
      return { type: "emptyState", key: "searchIdle", icon: "search", ...vw("searchIdleTitle", "title"), ...vw("searchIdleText") };
    case "loading":
      return { type: "Column", key: "searchLoading", gap: 12, children: [{ type: "Text", style: "caption", color: "muted", ...vw("searching", "text", model.q) }, skeletons()] };
    case "error":
      return { type: "Column", key: "searchError", gap: 16, crossAxisAlignment: "center", children: [
        { type: "errorState", ...vw("searchErrorTitle", "title"), ...vw(model.code === "rate_limited" ? "searchErrorRate" : "searchErrorText") },
        { type: "ElevatedButton", key: "searchRetry", icon: "refresh", ...vw("retry", "labelText"), onPressed: "searchRetry" },
      ] };
    case "none":
      return { type: "emptyState", key: "searchNone", icon: "search", ...vw("noResultsTitle", "title"), ...vw("noResultsText", "text", model.q) };
    case "filtered":
      return { type: "Column", key: "searchFiltered", gap: 16, crossAxisAlignment: "center", children: [
        { type: "emptyState", icon: "tune", ...vw("filteredTitle", "title"), ...vw("filteredText") },
        { type: "ElevatedButton", key: "clearFilters", ...vw("clearFilters", "labelText"), onPressed: "searchClearFilters" },
      ] };
    default:
      return { type: "Column", key: "searchResults", gap: 12, children: [
        { type: "Text", style: "caption", color: "muted", ...vw("resultsCount", "text", model.cards.length, model.q) },
        { type: "GridView", key: "results", columns: GRID_COLUMNS, gap: 12, children: model.cards.map((item) => ({ type: "titleCard", key: "r-" + item.id, item, onTap: { event: "searchOpen", arg: item.id } })) },
      ] };
  }
}

/** The whole Buscar body (one node). */
export function searchView(model) {
  const withResults = model.phase === "results" || model.phase === "filtered";
  return {
    type: "Column", key: "searchPage", gap: 16, children: [
      searchField(model),
      ...(withResults ? filterChips(model) : []),
      body(model),
    ],
  };
}
