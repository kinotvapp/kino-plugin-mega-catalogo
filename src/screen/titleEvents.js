// The Title route's events. The page's data lives in the screen's state (`state.td`, at most three titles, a series' opening
// season included); a one-second timer on the loading page asks for it, a failed load is kept as "failed" until Retry. The
// follow buttons write kino.shared through follows.js and bump `state.rev` so the page is drawn again.
import { acknowledge, follow, unfollow } from "../follows.js";
import { regionOf } from "../platforms.js";
import { fetchSeason, fetchTitle, titleKey } from "./titleData.js";
import { navigate, titleArgs } from "./state.js";
import { ttPair } from "./titleView.js";
import { fitTd } from "./stateBudget.js";

export { STATE_BUDGET, stateBytes } from "./stateBudget.js";

const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/** The title the route names, or null off the title route. */
export function routeTitle(route) {
  if (!route || route.name !== "title") return null;
  // A pushed route carries its arguments in `params`; a `go.screen` / `open.screen` restart carries them in `args` (and an empty `params`).
  return titleArgs(plain(route.args)) || titleArgs(plain(route.params));
}

/** The `td` map with [entry] stored under [key] as the newest; the oldest titles dropped until the whole state (and a full Inicio) fits. */
function withEntry(state, key, entry) {
  const td = { ...(plain(state.td) || {}) };
  delete td[key];
  td[key] = entry;
  return fitTd(state, td, key);
}

const bump = (state) => (Number.isInteger(state.rev) ? state.rev + 1 : 1);
const toast = (key, role, ...args) => {
  const [text, textEn] = ttPair(key, ...args);
  return { toast: { text, textEn, ...(role ? { role } : {}) } };
};

async function loadInto(state, args) {
  const key = titleKey(args);
  let entry;
  try {
    const d = await fetchTitle(args, regionOf(kino.config));
    entry = { st: "ok", d };
    if (args.kind === "series" && d.season) {
      entry.season = d.season;
      try {
        entry.eps = await fetchSeason(args.tmdbId, d.season);
      } catch {
        entry.eps = null;
        entry.epsSt = "failed";
      }
    }
  } catch (e) {
    entry = { st: "failed", code: e && typeof e.code === "string" ? e.code.slice(0, 40) : "error" };
  }
  return { state: { td: withEntry(state, key, entry) } };
}

const entryOf = (state, args) => {
  const td = plain(state.td);
  return td ? plain(td[titleKey(args)]) : null;
};

export const titleHandlers = {
  /** The loading page's timer. */
  async titleLoad({ route, state = {} }) {
    const args = routeTitle(route);
    if (!args || entryOf(state, args)) return null;
    return loadInto(state, args);
  },
  async titleRetry({ route, state = {} }) {
    const args = routeTitle(route);
    return args ? loadInto(state, args) : null;
  },
  /** A similar title: its own title route on top of this one, so Back comes here. */
  titleOpen({ arg }) {
    const m = /^(movie|series):(\d{1,10})$/.exec(String(arg || ""));
    return m ? navigate("title", { kind: m[1], tmdbId: Number(m[2]) }) : null;
  },
  /** A season chip: that season's episodes (the chip moves even when TMDB fails, with a retry under it). */
  async titleSeason({ route, state = {}, value, arg }) {
    const args = routeTitle(route);
    const entry = args && entryOf(state, args);
    if (!entry || entry.st !== "ok" || !entry.d) return null;
    const n = Number(typeof value === "string" ? value : arg);
    if (!Number.isInteger(n) || !entry.d.seasons.some((s) => s.n === n)) return null;
    const next = { ...entry, season: n, all: false, eps: null };
    delete next.epsSt;
    try {
      next.eps = await fetchSeason(args.tmdbId, n);
    } catch {
      next.epsSt = "failed";
    }
    return { state: { td: withEntry(state, titleKey(args), next) } };
  },
  titleEpisodesAll({ route, state = {} }) {
    const args = routeTitle(route);
    const entry = args && entryOf(state, args);
    if (!entry) return null;
    return { state: { td: withEntry(state, titleKey(args), { ...entry, all: true }) } };
  },
  async titleFollow({ route, state = {} }) {
    const args = routeTitle(route);
    const entry = args && args.kind === "series" ? entryOf(state, args) : null;
    if (!entry || entry.st !== "ok" || !entry.d) return null;
    const r = await follow({ tmdbId: args.tmdbId, name: entry.d.title, poster: entry.d.poster });
    if (!r.ok) return { state: { rev: bump(state) }, toast: { text: r.messageEs || ttPair("followFailed")[0], textEn: r.messageEn || ttPair("followFailed")[1], role: "error" } };
    return { state: { rev: bump(state) }, ...toast("followed", null, entry.d.title) };
  },
  titleUnfollow({ route, state = {} }) {
    const args = routeTitle(route);
    const entry = args && args.kind === "series" ? entryOf(state, args) : null;
    if (!args) return null;
    const r = unfollow(args.tmdbId);
    if (!r.ok) return { toast: { text: r.messageEs || ttPair("followFailed")[0], textEn: r.messageEn || ttPair("followFailed")[1], role: "error" } };
    return { state: { rev: bump(state) }, ...toast("unfollowed", null, entry && entry.d ? entry.d.title : "") };
  },
  titleMarkSeen({ route, state = {} }) {
    const args = routeTitle(route);
    if (!args || args.kind !== "series") return null;
    acknowledge(args.tmdbId);
    return { state: { rev: bump(state) }, ...toast("seenDone") };
  },
};
