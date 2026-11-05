// The events of the Buscar and Siguiendo routes. `makeSearchEvents` / `makeFollowingEvents` return handler maps that index.js
// spreads into its own; each handler takes Kino's event `{ name, arg, value, state }` and answers a screen answer or null.
//
// A submit never searches itself: it answers `loading` (the tree then carries a one-second tick on its root) and the tick runs the
// search, so the person sees the skeleton while TMDB answers. A tick whose state is no longer `loading` does nothing.
import { acknowledge, follow, list as followList, unfollow } from "../follows.js";
import { enabledPlatforms } from "../platforms.js";
import { search as catalogSearch } from "../search.js";
import { ALL, cleanFilters, cleanQuery, cleanSearch, compactItems } from "./searchView.js";
import { addResults, cleanAdd } from "./followingView.js";
import { navigate } from "./state.js";
import { vw } from "./viewText.js";

const codeOf = (e) => (e && typeof e.code === "string" ? e.code.slice(0, 40) : "failed");
const ownState = (state, key) => (state && typeof state === "object" ? state[key] : undefined);

/** The `{ toast }` of a text of viewText.js. */
export const textToast = (key, role, ...args) => ({ toast: { ...vw(key, "text", ...args), ...(role ? { role } : {}) } });

/** [deps] replace what the tests fake: `search(q)` (the Buscar search), `searchSeries(q)` (the add box's). */
export function makeSearchEvents(deps = {}) {
  const run = deps.search || ((q) => catalogSearch(kino.config, { q }));
  const filtersOf = (state) => cleanFilters(ownState(state, "filters"), enabledPlatforms(kino.config));
  const loading = (q, filters) => ({ state: { route: "search", search: { q, status: "loading", items: [], code: "" }, filters } });

  return {
    search({ value, state }) {
      const q = cleanQuery(value);
      if (!q) return { state: { route: "search", search: null } };
      return loading(q, { platform: ALL, kind: ALL });
    },
    async searchTick({ state }) {
      const s = cleanSearch(state.search);
      if (!s || s.status !== "loading") return null;
      try {
        const items = compactItems(await run(s.q));
        return { state: { route: "search", search: { q: s.q, status: "done", items, code: "" } } };
      } catch (e) {
        return { state: { route: "search", search: { q: s.q, status: "error", items: [], code: codeOf(e) } } };
      }
    },
    /** A result card: the title route is pushed, so Back returns to these results. */
    searchOpen({ arg }) {
      const m = /^(movie|series)-(\d{1,10})$/.exec(String(arg || ""));
      return m ? navigate("title", { kind: m[1], tmdbId: Number(m[2]) }) : null;
    },
    searchRetry({ state }) {
      const s = cleanSearch(state.search);
      return s ? loading(s.q, filtersOf(state)) : null;
    },
    searchFilter({ arg, value, state }) {
      const next = { ...filtersOf(state) };
      if (arg === "platform") next.platform = typeof value === "string" ? value : ALL;
      else if (arg === "kind") next.kind = typeof value === "string" ? value : ALL;
      else return null;
      return { state: { route: "search", filters: cleanFilters(next, enabledPlatforms(kino.config)) } };
    },
    searchClearFilters() {
      return { state: { route: "search", filters: { platform: ALL, kind: ALL } } };
    },
  };
}

const idOf = (arg) => {
  const n = Number(arg);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function makeFollowingEvents(deps = {}) {
  // The add box searches the catalog for series whatever the "kinds" setting says.
  const seriesConfig = { get: (k) => (k === "kinds" ? "series" : kino.config.get(k)) };
  const run = deps.searchSeries || ((q) => catalogSearch(seriesConfig, { q }));
  const bump = (state, extra = {}) => ({ state: { route: "following", rev: (Number(ownState(state, "rev")) || 0) + 1, ...extra } });

  return {
    addSearch({ value }) {
      const q = cleanQuery(value);
      if (!q) return { state: { route: "following", add: null } };
      return { state: { route: "following", add: { q, status: "loading", items: [], code: "" } } };
    },
    async addTick({ state }) {
      const a = cleanAdd(state.add);
      if (!a || a.status !== "loading") return null;
      try {
        return { state: { route: "following", add: { q: a.q, status: "done", items: addResults(await run(a.q)), code: "" } } };
      } catch (e) {
        return { state: { route: "following", add: { q: a.q, status: "error", items: [], code: codeOf(e) } } };
      }
    },
    /** "Ver ficha": pushed too, so Back returns to Siguiendo. */
    followingOpen({ arg }) {
      const id = idOf(arg);
      return id ? navigate("title", { kind: "series", tmdbId: id }) : null;
    },
    addRetry({ state }) {
      const a = cleanAdd(state.add);
      return a ? { state: { route: "following", add: { q: a.q, status: "loading", items: [], code: "" } } } : null;
    },
    async addFollow({ arg, state }) {
      const id = idOf(arg);
      const a = cleanAdd(state.add);
      const found = id && a ? a.items.find((c) => c.tmdb === id) : null;
      if (!found) return textToast("followFailed", "error");
      const r = await follow({ tmdbId: found.tmdb, name: found.title, poster: found.poster });
      if (!r.ok) return { toast: { text: r.messageEs, textEn: r.messageEn, role: "error" }, ...bump(state) };
      return { ...textToast("followedToast", "success", found.title), ...bump(state) };
    },
    followingUnfollow({ arg, state }) {
      const id = idOf(arg);
      if (!id) return null;
      const name = (followList().find((f) => f.tmdbId === id) || {}).name || "";
      const r = unfollow(id);
      if (!r.ok) return { toast: { text: r.messageEs, textEn: r.messageEn, role: "error" } };
      return { ...(r.removed ? textToast("unfollowedToast", undefined, name) : {}), ...bump(state) };
    },
    followingSeen({ arg, state }) {
      const id = idOf(arg);
      if (!id) return null;
      const r = acknowledge(id);
      if (!r.ok) return { toast: { text: r.messageEs, textEn: r.messageEn, role: "error" } };
      return { ...textToast("seenToast"), ...bump(state) };
    },
    followingSeenAll({ state }) {
      const r = acknowledge(undefined);
      if (!r.ok) return { toast: { text: r.messageEs, textEn: r.messageEn, role: "error" } };
      return { ...textToast("seenAllToast"), ...bump(state) };
    },
  };
}

