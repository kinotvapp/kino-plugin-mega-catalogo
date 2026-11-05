// Mega Catálogo: a catalog-only plugin (plays nothing) that shows what is on the streaming platforms the person picks.
// Data comes from TMDB through `kino.tmdb` (discover with the watch-provider filters). Home, browse, episodes, search and the
// refresh job, meta, the screen app (src/screen/) and the settings actions are real.
import { homeRowsOn } from "./platforms.js";
import { homeRows, rowPage } from "./rows.js";
import { seriesWithEpisodes } from "./tmdb.js";
import { search as searchTitles } from "./search.js";
import { job as refreshJob } from "./job.js";
import { meta as describeTitle } from "./meta.js";
import { checkEpisodes } from "./episodeWatch.js";
import { clear as clearCatalog, ensureFilled } from "./store.js";
import { makeScreenApp, settingsAction } from "./screen/index.js";
import { postDigest } from "./digest.js";
import { autoFollow, hiddenRefs, rowsWithoutWatched, withoutWatched } from "./library.js";
import { where as availabilityWhere, searchTitles as availabilitySearch } from "./provides.js";

/** Home: the rows of every chosen platform, or none when the person turned the rows off (they still have the plugin's screen). */
export async function home() {
  if (!homeRowsOn()) return [];
  return rowsWithoutWatched(await homeRows(kino.config), await hiddenRefs());
}

/** "Ver más" of a row: `browse(ref, cursor)` -> `{ items, next }`. */
export async function browse(ref, cursor) {
  const page = await rowPage(kino.config, ref, cursor);
  return ref === "row:episodes:all" ? page : { ...page, items: withoutWatched(page.items, await hiddenRefs()) };
}

/** A series' episodes from TMDB. The `ref` is the item's (`series:<tmdb id>`). */
export async function episodes(ref) {
  const m = /^series:(\d{1,9})$/.exec(String(ref || ""));
  if (!m) throw kino.error("not_found", "not a series of this catalog");
  return seriesWithEpisodes(Number(m[1]));
}

/** Search: the local catalog first, TMDB's search confirmed by the watch providers while the catalog is thin. */
export async function search(query) {
  return withoutWatched(await searchTitles(kino.config, query), await hiddenRefs());
}

/** Describes titles other plugins list (logo, cast, synopsis, genres) from TMDB; null when it has nothing, never throws. */
export async function meta(query) {
  return describeTitle(query);
}

/** The "availability" door (manifest `provides`): where a title can be watched. Kino validates the request and the answer. */
export async function proto_availability_where(arg) {
  return availabilityWhere(arg, kino.config);
}

/** The door's search: titles from TMDB with the known platforms that carry each in the person's region. */
export async function proto_availability_search(arg) {
  return availabilitySearch(arg, kino.config);
}

// The screen app: the first-run stepper, the tabs (Inicio, Buscar, Siguiendo, Ajustes) and the title page (src/screen/).
const app = makeScreenApp();

export async function screen(ctx) {
  return app.screen(ctx);
}

export async function screenEvent(ev) {
  return app.screenEvent(ev);
}

/** The settings actions: `resetIntro` (the stepper shows again) and `reloadCatalog` (empty the catalog and load it again). */
export async function action(key) {
  return settingsAction(key, { clear: clearCatalog, ensureFilled });
}

/**
 * The jobs, told apart by `ctx.id`: `episodes` checks the followed series for new episodes (notice + Home row data);
 * `refresh` (the default) stages titles in kino.storage (a job cannot use kino.catalog); search and the screen merge them.
 */
export async function job(ctx) {
  if (ctx && ctx.id === "episodes") {
    await autoFollow({ maxNew: 2 }).catch(() => null); // at most 2 requests, so the run stays inside its 10
    const summary = await checkEpisodes(ctx);
    await postDigest().catch(() => null); // the weekly notice (off by default); it asks TMDB for nothing
    return summary;
  }
  return refreshJob(kino.config);
}
