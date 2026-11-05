// The screen state is capped by Kino at 64 KB: a patch that would pass it is refused and the old state stays (a page would keep
// its skeleton and ask TMDB again every second). The Inicio grows tick by tick after the titles were opened, so titles are kept
// against the Inicio's FULL size, not the size it has now, and every patch that adds Inicio or title data goes through `fitTd`.

export const STATE_BUDGET = 56 * 1024; // the whole state, with the Inicio counted at least at HOME_RESERVE
export const HOME_RESERVE = 38 * 1024; // what a fully loaded Inicio of 8 platforms takes
export const MAX_TITLES = 3;

const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/** Bytes of [value] as JSON in UTF-8 (the way Kino measures the state). */
export const stateBytes = (value) => JSON.stringify(value).replace(/[\u0080-߿]/g, "xx").replace(/[ࠀ-￿]/g, "xxx").length;

/** The state's size with its Inicio counted as at least a full one. */
const accounted = (state, td) => {
  const { home, ...rest } = state;
  return stateBytes({ ...rest, td }) + Math.max(HOME_RESERVE, home ? stateBytes(home) : 0);
};

/**
 * [td] (the opened titles) without the oldest entries until the whole [state] fits and at most MAX_TITLES stay; [keep] is the key
 * of the title just stored, which is never dropped.
 */
export function fitTd(state, td, keep = null) {
  const out = { ...(plain(td) || {}) };
  const others = () => Object.keys(out).filter((k) => k !== keep);
  while (others().length >= (keep ? MAX_TITLES : MAX_TITLES + 1)) delete out[others()[0]];
  while (others().length && accounted(state, out) > STATE_BUDGET) delete out[others()[0]];
  return out;
}
