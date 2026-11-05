// The screen app: `screen(ctx)` draws the route state.js resolves, `screenEvent(ev)` answers the person's events through a
// handler map. Kino keeps the state; nothing here survives between calls but kino.storage (setupDone, the catalog's cursors),
// kino.shared (prefs, follows) and the settings. Routes: setup (stepper), the four tabs (home, search, following, settings) and
// title (pushed, so Back returns to where the person came from).
import { tl, tw } from "../i18n.js";
import { enabledPlatforms, kindsOf, platformByKey } from "../platforms.js";
import { ask as tmdbAsk, discover, THROTTLE, throttleRoom } from "../tmdb.js";
import { ensureFilled, ensureRegion, upsert } from "../store.js";
import { list as followList } from "../follows.js";
import { prefsOf, writePref } from "../prefs.js";
import * as st from "./state.js";
import * as budget from "./stateBudget.js";
import { shell } from "./shell.js";
import { stepperView } from "./stepper.js";
import { settingsView } from "./settingsView.js";
import * as home from "./homeModel.js";
import { homeView } from "./homeView.js";
import { newEpisodesRow } from "../episodeWatch.js";
import { searchModel, searchView, SEARCH_TICK } from "./searchView.js";
import { followingModel, followingView, addTickOf } from "./followingView.js";
import { makeSearchEvents, makeFollowingEvents } from "./searchEvents.js";
import { titleView } from "./titleView.js";
import { titleHandlers } from "./titleEvents.js";
import { autoFollow, watchedMark, watchedView } from "../library.js";

/**
 * Load the first page of each kind of [key]'s titles in [region] into the local catalog ("ok"), or answer "empty" when TMDB
 * has none there. Throws only when every kind failed (that platform's failure; the stepper keeps the others).
 */
export async function loadPlatform(key, { region }) {
  const platform = platformByKey(key);
  if (!platform) throw kino.error("bad_request", "unknown platform " + key);
  await ensureRegion(region);
  const settled = await Promise.allSettled(kindsOf(kino.config).map((kind) => discover({ kind, platform, region, page: 1, withOriginal: true })));
  const answered = settled.filter((s) => s.status === "fulfilled");
  if (!answered.length) throw settled[0].reason;
  const items = answered.flatMap((s) => s.value.items);
  if (items.length) await upsert(items);
  return items.length ? "ok" : "empty";
}

const has = (name) => {
  try {
    return typeof kino.screen !== "object" || !kino.screen || !Array.isArray(kino.screen.names) || kino.screen.names.includes(name);
  } catch {
    return true;
  }
};

function jobOnOf(id) {
  try {
    return typeof kino.jobOn === "function" ? kino.jobOn(id) === true : null;
  } catch {
    return null;
  }
}

const toast = (key, role) => ({ toast: { ...tw(key), ...(role ? { role } : {}) } });

// ---- the routes ------------------------------------------------------------------------------------------------

/** The Inicio route: the Home kept in the state (checked against the settings), drawn; its timer runs while rails load. */
async function homeScreen(state) {
  const { hide, watched } = await watchedView();
  const model = home.homeModel(home.cleanHome(state.home, kino.config), {
    watched,
    hideWatched: hide,
    config: kino.config,
    episodesRow: safe(() => newEpisodesRow(), null),
    followed: safe(() => followList().map((f) => f.tmdbId), []),
  });
  const { body, every } = homeView(model);
  return shell({ route: "home", body, every });
}

function safe(f, fallback) {
  try {
    return f();
  } catch {
    return fallback;
  }
}

/** What the Home's ticks use; the tests replace any of it with `deps.home`. */
const homeDepsOf = (over = {}) => ({
  config: kino.config,
  budget: THROTTLE.budget,
  room: throttleRoom,
  discover,
  ask: tmdbAsk,
  logoOf: (kind, tmdbId) => home.fetchLogo(tmdbAsk, kind, tmdbId),
  ensureFilled,
  ...over,
});

/** The Buscar route: the model from the state and the settings, drawn; a loading search carries the tick that runs it. */
async function searchScreen(state) {
  const { hide, watched } = await watchedView();
  const model = searchModel({ watched, hideWatched: hide, watchedMark: watchedMark(), search: state.search, filters: state.filters, platforms: enabledPlatforms(kino.config), kinds: kindsOf(kino.config) });
  return shell({ route: "search", body: searchView(model), every: model.phase === "loading" ? SEARCH_TICK : undefined });
}

/** The Siguiendo route: the follows (kino.shared) and the add box, drawn; a loading add search carries its tick. */
function followingScreen(state) {
  const model = followingModel({ follows: followList(), jobOn: jobOnOf("episodes"), add: state.add });
  return shell({ route: "following", body: followingView(model), every: addTickOf(model) });
}

// ---- the app ---------------------------------------------------------------------------------------------------------------

/** [deps] replace what the tests fake: `loadPlatform`. */
export function makeScreenApp(deps = {}) {
  const load = deps.loadPlatform || loadPlatform;
  const setupDone = () => st.isSetupDone(kino.storage);
  const freshSetup = () => st.initialSetup(kino.config);
  const searchEvents = makeSearchEvents({ search: deps.search });
  const followingEvents = makeFollowingEvents({ searchSeries: deps.searchSeries });

  async function screen(ctx = {}) {
    const state = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
    const route = st.resolveRoute({ route: ctx.route, state, setupDone: setupDone() });
    switch (route.name) {
      case "setup":
        return stepperView({ setup: st.cleanSetup(state.setup || freshSetup()), hasSteps: has("steps") });
      case "title":
        return titleView({ args: route.args, state, device: ctx.device });
      case "search":
        return searchScreen(state);
      case "following":
        return followingScreen(state);
      case "settings":
        return shell({ route: "settings", body: settingsView({ prefs: prefsOf(), jobOn: jobOnOf("episodes") }) });
      default:
        return homeScreen(state);
    }
  }

  /**
   * The stepper's answer to a changed setup, the route kept on the stepper. On the TV the done steps above are focusable too,
   * so a person's event also moves the focus to the step's main control (a timer's answer drops `focus`).
   */
  const setupAnswer = (setup, extra = {}) => {
    const focus = st.stepFocus(setup);
    return { ...(focus ? { focus } : {}), ...extra, state: { route: "setup", setup, ...(extra.state || {}) } };
  };
  const toHome = (extra = {}) => ({ ...extra, state: { route: "home", args: null, setup: null } });

  const on = {
    ...searchEvents, // Buscar: search, searchTick, searchRetry, searchFilter, searchClearFilters
    ...followingEvents, // Siguiendo: addSearch, addTick, addRetry, addFollow, followingUnfollow, followingSeen, followingSeenAll
    ...titleHandlers, // the title route: titleLoad, titleRetry, titleOpen, titleSeason, titleEpisodesAll, titleFollow, titleUnfollow, titleMarkSeen
    async open({ route, state }) {
      await autoFollow().catch(() => null); // the series they saved in Kino (autoFollow on); silent when it is off or denied
      const r = st.openingRoute({ route, state, setupDone: setupDone() });
      if (r.name === "setup") return setupAnswer(state.setup ? st.cleanSetup(state.setup) : freshSetup());
      if (r.name === "title") return null; // Kino's pushed route holds it
      return { state: { route: r.name, args: r.args } };
    },
    tab({ value, arg }) {
      const to = typeof value === "string" ? value : arg;
      return st.TAB_ROUTES.includes(to) ? st.navigate(to) : null;
    },
    back() {
      return { route: { pop: true } };
    },

    // Inicio (homeModel.js / homeView.js): the rails' ticks, a card or a slide's Info, a failed rail's retry, the platform chips
    async homeTick({ state }) {
      const next = await home.homeTick(home.cleanHome(state.home, kino.config), homeDepsOf(deps.home));
      if (!next) return null; // nothing changed: no redraw
      // the Inicio grew: the opened titles give way if the whole state would pass the budget
      const td = state.td && typeof state.td === "object" ? state.td : null;
      const fit = td ? budget.fitTd({ ...state, home: next }, td) : null;
      return { state: fit && Object.keys(fit).length !== Object.keys(td).length ? { home: next, td: fit } : { home: next } };
    },
    homeOpen({ arg }) {
      const m = /^(movie|series)-(\d{1,10})$/.exec(String(arg || ""));
      return m ? st.navigate("title", { kind: m[1], tmdbId: Number(m[2]) }) : null;
    },
    homeRetry({ state, arg }) {
      return { state: { home: home.retryRail(home.cleanHome(state.home, kino.config), String(arg || "")) } };
    },
    homeFilter({ state, value, arg }) {
      return { state: { home: home.setFilter(home.cleanHome(state.home, kino.config), value ?? arg, kino.config) } };
    },

    // the stepper
    setupNext({ state, value }) {
      const r = st.setupNext(state.setup || freshSetup(), value);
      return r.error ? setupAnswer(r.setup, toast(r.error, "error")) : setupAnswer(r.setup);
    },
    setupBack({ state }) {
      return setupAnswer(st.setupBack(state.setup || freshSetup()));
    },
    setupGoto({ state, arg }) {
      const n = /^s([123])$/.exec(String(arg || ""));
      return n ? setupAnswer(st.setupGoto(state.setup || freshSetup(), Number(n[1]))) : null;
    },
    setupStart({ state }) {
      const r = st.setupStart(state.setup || freshSetup());
      if (r.error) return setupAnswer(r.setup);
      // The choices go to the real settings now (a write restarts the runtime: the ticks read the setup, not kino.config).
      return setupAnswer(r.setup, { config: r.config });
    },
    async setupTick({ state }) {
      if (!state.setup || !state.setup.run || state.setup.run.status !== "loading") return null;
      const r = await st.setupTick(state.setup, { loadPlatform: load, storage: kino.storage });
      if (r.finished && r.setup.run.status === "done") return toHome(toast("ready"));
      return { state: { route: "setup", setup: r.setup } }; // a tick: no focus
    },
    setupRetry({ state }) {
      return setupAnswer(st.setupRetry(state.setup || freshSetup()));
    },
    setupFinish() {
      return setupDone() ? toHome() : null;
    },

    // the settings route
    pref({ arg, value }) {
      const r = writePref(arg, value);
      if (r.ok) return null;
      return r.code === "bad_request" ? null : toast("prefSaveFailed", "error");
    },
    enableEpisodes({ state }) {
      // Kino drops `enableJob` when the person switched the job off in its Ajustes, so no toast claims it: the redraw (rev) shows
      // the real state (`kino.jobOn`).
      return { enableJob: "episodes", state: { rev: (Number.isInteger(state.rev) ? state.rev : 0) + 1 } };
    },
    saved({ value, state }) {
      const v = value && typeof value === "object" ? value : {};
      if (v.kind === "action" && v.ok && v.action === "resetIntro") return setupAnswer(freshSetup());
      // the catalog and its fill cursor were emptied: let the Inicio's background fill run again in this opening
      if (v.kind === "action" && v.ok && v.action === "reloadCatalog") return { state: { home: { ...home.cleanHome(state.home, kino.config), filled: false, fillFails: 0 } } };
      return null;
    },
  };

  async function screenEvent(ev = {}) {
    const handler = Object.hasOwn(on, ev.name) ? on[ev.name] : null;
    if (!handler) return null;
    return (await handler({ ...ev, state: ev.state && typeof ev.state === "object" ? ev.state : {} })) ?? null;
  }

  return { screen, screenEvent };
}

/** The settings' action buttons (Kino calls `action(key)` from Ajustes and from the screen's `settings` node). */
export async function settingsAction(key, { clear, ensureFilled }) {
  if (key === "resetIntro") {
    st.resetIntro(kino.storage);
    return { message: tl("introReset") };
  }
  if (key === "reloadCatalog") {
    await clear();
    try {
      await ensureFilled(kino.config, { steps: 1 });
      return { message: tl("catalogReloaded") };
    } catch {
      return { message: tl("catalogCleared") };
    }
  }
  return null;
}
