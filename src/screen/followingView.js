// The Siguiendo route: the followed series (poster, name, last aired episode, a "Nuevo" mark while that episode is not marked as
// seen), "Marcar todo como visto", the "N de 10" counter, the empty state that explains the notices, and a box to add a series by
// searching the catalog. Pure: `followingModel` reads the follows (kino.shared, through follows.js `list`) and the add box's
// state, `followingView` draws it; index.js owns the events.
import { MAX_FOLLOWS } from "../follows.js";
import { cleanQuery, cleanRecord, compactItem } from "./searchView.js";
import { vw } from "./viewText.js";

export const ADD_TICK = { ms: 1000, event: "addTick" };
export const MAX_ADD = 10; // the add box shows at most this many series
const STATUSES = ["loading", "done", "error"];
const ROW_SPAN = { compact: 12, expanded: 6 };

const episodeCode = (e) => ({ es: `T${e.season}·E${e.number}`, en: `S${e.season}·E${e.number}` });

/** The add box kept in the state, checked (series only, at most MAX_ADD), or null. */
export function cleanAdd(raw) {
  if (!raw || typeof raw !== "object") return null;
  const q = cleanQuery(raw.q);
  if (!q) return null;
  return {
    q,
    status: STATUSES.includes(raw.status) ? raw.status : "done",
    items: Array.isArray(raw.items) ? raw.items.map(cleanRecord).filter((c) => c && c.kind === "series").slice(0, MAX_ADD) : [],
    code: typeof raw.code === "string" ? raw.code.slice(0, 40) : "",
  };
}

/** The series records of search results ([items] are search.js items), as the add box keeps them. */
export function addResults(items) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const c = compactItem(it);
    if (!c || c.kind !== "series" || seen.has(c.tmdb)) continue;
    seen.add(c.tmdb);
    out.push(c);
    if (out.length >= MAX_ADD) break;
  }
  return out;
}

/** A followed series is new while its newest aired episode is not marked as seen. */
export const isNew = (f) => Boolean(f.latest) && !f.ackedAt;

/**
 * What to draw: `{ count, max, anyNew, rows, jobOn, add }`. [follows] are follows.js records; the new ones come first (newest
 * episode first), the others keep their order. [add] is the state's add box.
 */
export function followingModel({ follows, jobOn, add }) {
  const list = Array.isArray(follows) ? follows : [];
  const fresh = list.filter(isNew).sort((a, b) => (a.latest.airDate === b.latest.airDate ? a.tmdbId - b.tmdbId : a.latest.airDate < b.latest.airDate ? 1 : -1));
  const rest = list.filter((f) => !isNew(f));
  const rows = [...fresh, ...rest].map((f) => ({
    tmdbId: f.tmdbId,
    name: f.name,
    poster: f.poster || "",
    isNew: isNew(f),
    latest: f.latest || null,
  }));
  const ids = new Set(list.map((f) => f.tmdbId));
  const a = cleanAdd(add);
  return {
    count: list.length,
    max: MAX_FOLLOWS,
    anyNew: fresh.length > 0,
    rows,
    jobOn: jobOn === true ? true : jobOn === false ? false : null,
    add: a ? { ...a, items: a.items.map((c) => ({ ...c, followed: ids.has(c.tmdb) })) } : null,
  };
}

// ---- the tree --------------------------------------------------------------------------------------------------------------

function posterNode(url, width) {
  return {
    type: "Image", width, aspect: "2:3", alt: "", ...(url ? { url } : {}),
    fallback: { type: "Stack", color: "surface", children: [{ type: "Icon", name: "tv" }] },
  };
}

function episodeLine(row) {
  if (!row.latest) return vw("noEpisodeYet");
  const code = episodeCode(row.latest);
  return vw("lastEpisode", "text", code, row.latest.title || "", row.latest.airDate);
}

function followCard(row) {
  const id = row.tmdbId;
  const actions = [];
  if (row.isNew) actions.push({ type: "Button", variant: "secondary", key: `seen-${id}`, icon: "check", ...vw("markSeen", "labelText"), onPressed: { event: "followingSeen", arg: String(id) } });
  actions.push({ type: "TextButton", key: `open-${id}`, icon: "info", ...vw("openTitle", "labelText"), onPressed: { event: "followingOpen", arg: String(id) } });
  actions.push({
    type: "TextButton", key: `unfollow-${id}`, icon: "close", ...vw("unfollow", "labelText"),
    ...vw("unfollowAsk", "confirm", row.name), onPressed: { event: "followingUnfollow", arg: String(id) },
  });
  return {
    type: "Row", key: `fcard-${id}`, span: ROW_SPAN, gap: 12, padding: 12, background: "surfaceVariant", borderRadius: "medium", crossAxisAlignment: "start", children: [
      posterNode(row.poster, 64),
      { type: "Column", key: `followInfo-${id}`, flex: 1, gap: 8, children: [
        { type: "Row", key: `followHead-${id}`, gap: 8, children: [
          { type: "Text", style: "h4", flex: 1, maxLines: 2, text: row.name, textEn: row.name },
          ...(row.isNew ? [{ type: "Badge", key: `new-${id}`, ...vw("newMark") }] : []),
        ] },
        { type: "Text", style: "caption", color: "muted", ...episodeLine(row) },
        { type: "Row", key: `followActions-${id}`, wrap: true, gap: 8, children: actions },
      ] },
    ],
  };
}

function noticesBlock(model) {
  const parts = [{ type: "Text", style: "caption", color: "muted", ...vw("noticesText") }];
  if (model.jobOn === true) parts.push({ type: "Text", style: "caption", color: "primary", ...vw("noticesOn") });
  else parts.push({ type: "Button", variant: "secondary", key: "enableEpisodes", icon: "notifications", ...vw("noticesEnable", "labelText"), onPressed: "enableEpisodes" });
  return { type: "Column", key: "followingNotices", gap: 8, crossAxisAlignment: "center", children: parts };
}

function header(model) {
  return {
    type: "Row", key: "followingHeader", gap: 12, wrap: true, children: [
      { type: "Column", key: "followingHeadText", gap: 4, span: { compact: 12, expanded: 8 }, children: [
        { type: "Text", style: "h3", ...vw("followingTitle") },
        { type: "Text", key: "followingCount", color: "muted", ...vw("followingCount", "text", model.count, model.max) },
      ] },
      ...(model.anyNew ? [{ type: "Button", variant: "secondary", key: "markAllSeen", icon: "check", span: "auto", ...vw("markAllSeen", "labelText"), onPressed: "followingSeenAll" }] : []),
    ],
  };
}

function addResultRow(c) {
  return {
    type: "Row", key: `addcard-${c.tmdb}`, span: ROW_SPAN, gap: 12, padding: 12, background: "surfaceVariant", borderRadius: "medium", crossAxisAlignment: "center", children: [
      posterNode(c.poster, 48),
      { type: "Column", flex: 1, gap: 4, children: [
        { type: "Text", style: "h4", maxLines: 2, text: c.title, textEn: c.title },
        ...(c.year ? [{ type: "Text", style: "caption", color: "muted", text: String(c.year), textEn: String(c.year) }] : []),
      ] },
      c.followed
        ? { type: "Badge", key: `added-${c.tmdb}`, ...vw("alreadyFollowing") }
        : { type: "Button", key: `addbtn-${c.tmdb}`, icon: "add", ...vw("follow", "labelText"), onPressed: { event: "addFollow", arg: String(c.tmdb) } },
    ],
  };
}

function addBox(model) {
  const add = model.add;
  const parts = [
    { type: "Text", style: "h4", ...vw("addTitle") },
    {
      type: "TextField", key: "addQ", kind: "search", value: add ? add.q : "", maxLength: 120,
      ...vw("addLabel", "labelText"), ...vw("addHint", "hintText"), onSubmitted: "addSearch",
      trailingIcon: "search", ...vw("searchGo", "trailingLabel"), onTrailingTap: "addSearch",
    },
  ];
  if (add && add.status === "loading") {
    parts.push({ type: "Skeleton", key: "addSkeleton", shape: "line", lines: 3 });
  } else if (add && add.status === "error") {
    parts.push({ type: "Text", key: "addError", color: "error", ...vw("addErrorText") });
    parts.push({ type: "Button", variant: "secondary", key: "addRetry", icon: "refresh", ...vw("retry", "labelText"), onPressed: "addRetry" });
  } else if (add && !add.items.length) {
    parts.push({ type: "Text", key: "addNone", color: "muted", ...vw("addNone", "text", add.q) });
  } else if (add) {
    parts.push({ type: "Row", key: "addResults", wrap: true, gap: 12, children: add.items.map(addResultRow) });
  }
  return { type: "Column", key: "followingAdd", gap: 12, children: parts };
}

/** The whole Siguiendo body (one node). */
export function followingView(model) {
  const parts = [header(model)];
  if (model.rows.length) {
    parts.push({ type: "Row", key: "followList", wrap: true, gap: 12, children: model.rows.map(followCard) });
  } else {
    parts.push({ type: "emptyState", key: "followingEmpty", icon: "tv", ...vw("followingEmptyTitle", "title"), ...vw("followingEmptyText") });
    parts.push(noticesBlock(model));
  }
  parts.push(addBox(model));
  return { type: "Column", key: "followingPage", gap: 24, children: parts };
}

/** The tick the root carries while the add box searches. */
export const addTickOf = (model) => (model.add && model.add.status === "loading" ? ADD_TICK : undefined);
