// The refresh job. A job cannot use `kino.catalog` (it answers not_allowed there), so it only stages: each run fetches up to
// 10 popular discover pages, one request at a time and round-robin over the chosen platforms and kinds, and appends the
// titles to the stage in `kino.storage`. `mergeStage()` (store.js) moves the stage into the catalog from the screen or search.
import { enabledPlatforms, kindsOf, regionOf } from "./platforms.js";
import { clockNow, discover } from "./tmdb.js";
import { stageItems } from "./store.js";

export const MAX_REQUESTS = 10; // a run's cap
export const MAX_RUN_MS = 8000; // stop well before the 20 s cap: one slow call must not cost the run
export const SAVE_EVERY = 5; // requests between saves: a run writes the stage at most twice (Kino cuts a run at 256 KB written)
export const EMPTY_BACKOFF_MS = 24 * 60 * 60 * 1000; // a list that came back empty is not asked again for a day
const MAX_PAGE = 50; // popular titles past the 50th page of a list are not worth a request; the list starts over

function readCursor(sig) {
  try {
    const c = JSON.parse(kino.storage.get("jobCursor"));
    if (c && c.sig === sig && Number.isInteger(c.n) && c.n >= 0 && c.pages && typeof c.pages === "object") return { ...c, off: c.off && typeof c.off === "object" ? c.off : {} };
  } catch {
    // no cursor yet, or a broken one: start over
  }
  return { sig, n: 0, pages: {}, off: {} };
}

/** `job(ctx)`: stage up to 10 pages of titles. A failure before the first page is thrown (Kino backs the job off). */
export async function job(config) {
  const platforms = enabledPlatforms(config);
  const kinds = kindsOf(config);
  const pairs = platforms.flatMap((platform) => kinds.map((kind) => ({ platform, kind })));
  if (!pairs.length) return;
  const region = regionOf(config);
  const cursor = readCursor(`${region}|${pairs.map((p) => p.platform.key + p.kind).join(",")}`);
  const startedAt = clockNow();
  let pending = [];
  let requests = 0;
  let failure = null;

  const save = () => {
    if (pending.length) {
      try {
        stageItems(pending, region);
      } catch (e) {
        kino.log && kino.log("could not stage titles: " + (e && e.message)); // the run goes on; the cursor still moves
      }
      pending = [];
    }
    try {
      kino.storage.set("jobCursor", JSON.stringify(cursor));
    } catch (e) {
      kino.log && kino.log("could not save the job cursor: " + (e && e.message));
    }
  };

  while (requests < MAX_REQUESTS && clockNow() - startedAt < MAX_RUN_MS) {
    // the next list that is not backed off
    let pair = null;
    let listKey = "";
    for (let tries = 0; tries < pairs.length && !pair; tries++) {
      const candidate = pairs[cursor.n % pairs.length];
      const key = candidate.platform.key + ":" + candidate.kind;
      if ((cursor.off[key] || 0) > clockNow()) cursor.n++;
      else { pair = candidate; listKey = key; }
    }
    if (!pair) break; // every list is backed off
    const page = cursor.pages[listKey] || 1;
    let result;
    try {
      result = await discover({ kind: pair.kind, platform: pair.platform, region, page, withOriginal: true });
    } catch (e) {
      failure = e;
      break;
    }
    requests++;
    pending.push(...result.items);
    if (!result.items.length && page === 1) cursor.off[listKey] = clockNow() + EMPTY_BACKOFF_MS;
    cursor.pages[listKey] = !result.items.length || page >= Math.min(result.totalPages, MAX_PAGE) ? 1 : page + 1;
    cursor.n++;
    if (requests % SAVE_EVERY === 0) save();
  }
  if (failure && !requests) throw failure;
  if (requests) save();
}
