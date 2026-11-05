// The Title route: a pure view model (`titleModel`: which blocks exist, the follow button's state, the platforms of the person's
// country, the season and its episodes) and the tree drawn from it (`titleView`). A missing field hides its block; while the
// data loads the page is skeletons and a one-second timer asks for it; a TMDB failure shows a retry, never a blank screen.
// On a TV the D-pad walks: Back, then "Buscar dónde verlo" (autofocus), Seguir, the season chips, the episodes, the similar rail.
import { langOf, tw } from "../i18n.js";
import { list as followList, maxFollows } from "../follows.js";
import { enabledPlatforms, regionOf } from "../platforms.js";
import { shell } from "./shell.js";
import { titleArgs } from "./state.js";
import { titleKey } from "./titleData.js";

/** Episodes drawn before "Ver todos" (a node budget: the tree has 600). */
export const EPISODES_SHOWN = 30;
const EPISODES_MAX = 80;

// ---- the texts [Spanish, English] -------------------------------------------------------------------------------------------
const TT = {
  where: ["Buscar dónde verlo", "Find where to watch"],
  follow: ["Seguir", "Follow"],
  unfollow: ["Dejar de seguir", "Unfollow"],
  markSeen: ["Marcar como visto", "Mark as seen"],
  followed: (name) => [`Ahora sigues ${name}`, `You now follow ${name}`],
  unfollowed: (name) => [`Dejaste de seguir ${name}`, `You no longer follow ${name}`],
  seenDone: ["Marcado como visto", "Marked as seen"],
  followFailed: ["No se pudo seguir esta serie", "This series could not be followed"],
  overview: ["Sinopsis", "Synopsis"],
  platformsTitle: (country) => [`Dónde está en tu país (${country})`, `Where it is in your country (${country})`],
  groupStream: ["Con suscripción", "With a subscription"],
  groupFree: ["Gratis o con anuncios", "Free or with ads"],
  groupPaid: ["Alquiler o compra", "Rent or buy"],
  yours: ["Es una de tus plataformas", "One of your platforms"],
  justwatch: ["Disponibilidad: JustWatch", "Availability: JustWatch"],
  cast: ["Reparto", "Cast"],
  seasons: ["Temporadas", "Seasons"],
  season: (n) => [`Temporada ${n}`, `Season ${n}`],
  episodes: ["Capítulos", "Episodes"],
  episode: (n) => [`Capítulo ${n}`, `Episode ${n}`],
  upcoming: ["Próximamente", "Upcoming"],
  noEpisodes: ["Esta temporada aún no tiene capítulos", "This season has no episodes yet"],
  episodesFailed: ["No se pudieron cargar los capítulos", "The episodes could not be loaded"],
  showAll: (n) => [`Ver los ${n} restantes`, `Show the other ${n}`],
  similar: ["Títulos parecidos", "Similar titles"],
  failedTitle: ["No se pudo cargar este título", "This title could not be loaded"],
  failedText: ["Revisa tu conexión e inténtalo de nuevo.", "Check your connection and try again."],
  year: (y) => [String(y), String(y)],
  seasonsCount: (n) => [n === 1 ? "1 temporada" : `${n} temporadas`, n === 1 ? "1 season" : `${n} seasons`],
  runtime: (m) => {
    const label = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
    return [label, label];
  },
  rating: (r) => [`★ ${r}`, `★ ${r}`],
  episodeRuntime: (m) => [`${m} min`, `${m} min`],
};

const MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const dateText = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return [`${d} ${MONTHS.es[m - 1]} ${y}`, `${MONTHS.en[m - 1]} ${d}, ${y}`];
};

const pair = (key, ...args) => {
  const entry = TT[key];
  return typeof entry === "function" ? entry(...args) : entry;
};
/** `ptw("where", "labelText")` -> `{ labelText, labelTextEn }`. */
const ptw = (key, prop = "text", ...args) => {
  const [es, en] = pair(key, ...args);
  return { [prop]: es, [prop + "En"]: en };
};
/** The text of [key] in the person's language (toasts built by the events). */
export const ttl = (key, ...args) => pair(key, ...args)[langOf() === "es" ? 0 : 1];
export const ttPair = (key, ...args) => pair(key, ...args);
const same = (text, prop = "text") => ({ [prop]: text, [prop + "En"]: text });

// ---- the view model ---------------------------------------------------------------------------------------------------------

const isoToday = () => new Date().toISOString().slice(0, 10);

/**
 * What the page shows, no texts yet. [entry] is the state's `td[key]` (null while loading), [followed] the person's follow
 * record of this series (or null), [followCount] how many series they follow, [chosen] the TMDB watch-provider ids of their platforms (matched by id, never by name: "Disney Plus" is Disney+).
 */
export function titleModel({ args, entry, followed = null, followCount = 0, chosen = [], today = isoToday() }) {
  const base = { kind: args.kind, tmdbId: args.tmdbId, blocks: [] };
  if (!entry) return { ...base, status: "loading" };
  if (entry.st !== "ok" || !entry.d) return { ...base, status: "failed" };
  const d = entry.d;
  const series = args.kind === "series";
  const blocks = ["hero"];
  const facts = {};
  if (d.year) facts.year = d.year;
  if (!series && d.runtime) facts.runtime = d.runtime;
  if (series && d.seasonCount) facts.seasonCount = d.seasonCount;
  if (d.rating) facts.rating = d.rating;
  if (Object.keys(facts).length) blocks.push("facts");
  if (d.genres && d.genres.length) blocks.push("genres");
  blocks.push("actions");
  if (d.overview) blocks.push("overview");

  let platforms = null;
  if (d.platforms) {
    const groups = [];
    for (const [key, field] of [["stream", "stream"], ["free", "free"], ["paid", "paid"]]) {
      const items = (d.platforms[field] || []).map((p) => ({ name: p.name, ...(p.logo ? { logo: p.logo } : {}), mine: Number.isInteger(p.id) && chosen.includes(p.id) }));
      if (items.length) groups.push({ key, items });
    }
    if (groups.length) platforms = { groups, credit: "JustWatch" };
  }
  if (platforms) blocks.push("platforms");
  if (d.cast && d.cast.length) blocks.push("cast");

  let seasons = null;
  let episodes = null;
  if (series && d.seasons && d.seasons.length) {
    const current = d.seasons.some((s) => s.n === entry.season) ? entry.season : d.season;
    seasons = { options: d.seasons.map((s) => ({ value: String(s.n), n: s.n })), value: String(current) };
    blocks.push("seasons", "episodes");
    if (entry.epsSt === "failed") {
      episodes = { status: "failed", items: [], more: 0, season: current };
    } else {
      const all = Array.isArray(entry.eps) ? entry.eps : [];
      const limit = entry.all ? EPISODES_MAX : EPISODES_SHOWN;
      const items = all.slice(0, limit).map((e) => ({
        number: e.number,
        ...(e.title ? { title: e.title } : {}),
        ...(e.airDate ? { airDate: e.airDate } : {}),
        ...(e.runtime ? { runtime: e.runtime } : {}),
        ...(e.still ? { still: e.still } : {}),
        ...(e.overview ? { overview: e.overview } : {}),
        aired: e.airDate ? e.airDate <= today : null,
      }));
      episodes = { status: "ok", items, more: Math.max(0, Math.min(all.length, EPISODES_MAX) - items.length), season: current };
    }
  }
  if (d.similar && d.similar.length) blocks.push("similar");

  const title = { tmdb: args.tmdbId, kind: args.kind, title: d.title, ...(d.year ? { year: Number(d.year) } : {}) };
  const unseen = !!(followed && followed.latest && !followed.ackedAt);
  return {
    ...base,
    status: "ok",
    blocks,
    title: d.title,
    logo: d.logo || null,
    backdrop: d.backdrop || d.poster || null,
    facts,
    genres: d.genres || [],
    overview: d.overview || "",
    platforms,
    cast: d.cast || [],
    seasons,
    episodes,
    similar: d.similar || [],
    where: { go: { titleByIds: Object.fromEntries(Object.entries(title).filter(([, v]) => v !== "" && v !== undefined)) } },
    follow: series ? { kind: followed ? "unfollow" : "follow", limit: !followed && followCount >= maxFollows() } : null,
    markSeen: series && unseen,
  };
}

// ---- the tree ---------------------------------------------------------------------------------------------------------------

const skeletonPage = () => ({
  type: "Column", key: "titleLoading", gap: 12, children: [
    { type: "Skeleton", key: "sk-hero", shape: "block", height: 200 },
    { type: "Skeleton", key: "sk-title", shape: "line", lines: 2 },
    { type: "Row", key: "sk-buttons", gap: 12, children: [
      { type: "Skeleton", shape: "block", width: 160, height: 48 },
      { type: "Skeleton", shape: "block", width: 120, height: 48 },
    ] },
    { type: "Skeleton", key: "sk-text", shape: "line", lines: 4 },
    { type: "Row", key: "sk-cards", gap: 12, children: [1, 2, 3].map((i) => ({ type: "Skeleton", key: "sk-card-" + i, shape: "card", width: 120 })) },
  ],
});

const failedPage = () => ({
  type: "Column", key: "titleFailed", gap: 12, crossAxisAlignment: "center", children: [
    { type: "errorState", icon: "refresh", ...ptw("failedTitle", "title"), ...ptw("failedText") },
    { type: "ElevatedButton", key: "titleRetry", icon: "refresh", autofocus: true, ...tw("retry", "labelText"), onPressed: "titleRetry" },
  ],
});

const sectionTitle = (key) => ({ type: "Text", style: "h4", ...ptw(key) });

const LEAD_MAX = 140;

/** The banner: the backdrop under the title (its logo when TMDB has one), a short lead and the two main buttons. */
function hero(m) {
  const lead = m.overview.length <= LEAD_MAX ? m.overview : `${m.overview.slice(0, LEAD_MAX - 1).trimEnd()}…`;
  return {
    type: "heroCard", key: "thero", h: { compact: 240, expanded: 320 }, title: m.title, titleEn: m.title, ...(lead ? same(lead) : {}),
    ...(m.backdrop ? { image: m.backdrop } : {}), ...(m.logo ? { logo: m.logo } : {}),
    buttons: heroButtons(m),
  };
}

function heroButtons(m) {
  const buttons = [{ type: "ElevatedButton", key: "twhere", icon: "search", autofocus: true, ...ptw("where", "labelText"), onPressed: { go: m.where.go } }];
  if (m.follow) {
    buttons.push(m.follow.kind === "follow"
      ? { type: "TextButton", key: "tfollow", icon: "add", ...ptw("follow", "labelText"), onPressed: "titleFollow" }
      : { type: "TextButton", key: "tunfollow", icon: "check", ...ptw("unfollow", "labelText"), onPressed: "titleUnfollow" });
  }
  return buttons;
}

function facts(m) {
  const parts = [];
  if (m.facts.year) parts.push(pair("year", m.facts.year));
  if (m.facts.runtime) parts.push(pair("runtime", m.facts.runtime));
  if (m.facts.seasonCount) parts.push(pair("seasonsCount", m.facts.seasonCount));
  if (m.facts.rating) parts.push(pair("rating", m.facts.rating));
  return { type: "Text", key: "tfacts", style: "h4", text: parts.map((p) => p[0]).join("  ·  "), textEn: parts.map((p) => p[1]).join("  ·  ") };
}

function actions(m) {
  if (!m.markSeen) return null;
  return { type: "Row", key: "tactions", wrap: true, gap: 12, children: [{ type: "TextButton", key: "tseen", icon: "check", ...ptw("markSeen", "labelText"), onPressed: "titleMarkSeen" }] };
}

function platformsBlock(m, region) {
  const groupTitle = { stream: "groupStream", free: "groupFree", paid: "groupPaid" };
  return {
    type: "Column", key: "tplatforms", gap: 8, children: [
      { type: "Text", style: "h4", ...ptw("platformsTitle", "text", region) },
      ...m.platforms.groups.map((g) => ({
        type: "Column", key: "tpg-" + g.key, gap: 8, children: [
          { type: "Text", style: "caption", color: "muted", ...ptw(groupTitle[g.key]) },
          { type: "Row", wrap: true, gap: 8, children: g.items.map((p, i) => ({ type: "Badge", key: `tp-${g.key}-${i}`, ...same(p.name), ...(p.mine ? { color: "primary" } : {}), canRequestFocus: true })) },
        ],
      })),
      { type: "Text", style: "caption", color: "muted", ...ptw("justwatch") },
    ],
  };
}

function castBlock(m) {
  return {
    type: "Column", key: "tcast", gap: 8, children: [
      sectionTitle("cast"),
      { type: "SingleChildScrollView", key: "tcast-scroll", direction: "horizontal", children: [{
        type: "Row", gap: 12, children: m.cast.map((c, i) => ({
          type: "Column", key: "tc-" + i, gap: 4, maxWidth: 96, canRequestFocus: true, crossAxisAlignment: "center", children: [
            { type: "CircleAvatar", radius: 32, ...(c.photo ? { image: c.photo } : {}), ...same(c.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()), labelText: c.name, labelTextEn: c.name },
            { type: "Text", style: "caption", textAlign: "center", ...same(c.name) },
            ...(c.character ? [{ type: "Text", style: "caption", color: "muted", textAlign: "center", ...same(c.character) }] : []),
          ],
        })),
      }] },
    ],
  };
}

function seasonsBlock(m) {
  return {
    type: "Column", key: "tseasons", gap: 8, children: [
      sectionTitle("seasons"),
      { type: "Chips", key: "season", value: m.seasons.value, onChanged: "titleSeason", options: m.seasons.options.map((o) => ({ value: o.value, ...ptwOption(o.n) })) },
    ],
  };
}
const ptwOption = (n) => {
  const [es, en] = pair("season", n);
  return { label: es, labelEn: en };
};

function episodeRow(e, i) {
  const [titleEs, titleEn] = e.title ? [`${e.number}. ${e.title}`, `${e.number}. ${e.title}`] : pair("episode", e.number);
  const date = e.airDate ? dateText(e.airDate) : null;
  const run = e.runtime ? pair("episodeRuntime", e.runtime) : null;
  const sub = [date, run].filter(Boolean);
  return {
    type: "Row", key: "te-" + i, gap: 12, crossAxisAlignment: "center", canRequestFocus: true,
    children: [
      { type: "Image", key: "tei-" + i, width: 120, aspect: "16:9", fit: "cover", ...(e.still ? { url: e.still } : {}), fallback: { type: "Skeleton", shape: "block", height: 64 } },
      { type: "Column", flex: 1, gap: 4, children: [
        { type: "Text", bold: true, maxLines: 2, text: titleEs, textEn: titleEn },
        ...(sub.length ? [{ type: "Text", style: "caption", color: "muted", text: sub.map((p) => p[0]).join(" · "), textEn: sub.map((p) => p[1]).join(" · ") }] : []),
        ...(e.overview ? [{ type: "Text", style: "caption", color: "muted", maxLines: 2, ...same(e.overview) }] : []),
        ...(e.aired === false ? [{ type: "Badge", ...ptw("upcoming") }] : []),
      ] },
    ],
  };
}

function episodesBlock(m) {
  const e = m.episodes;
  const body = [];
  if (e.status === "failed") {
    body.push({ type: "Text", color: "muted", ...ptw("episodesFailed") });
    body.push({ type: "TextButton", key: "tepretry", icon: "refresh", ...tw("retry", "labelText"), onPressed: { event: "titleSeason", arg: String(e.season) } });
  } else if (!e.items.length) {
    body.push({ type: "Text", color: "muted", ...ptw("noEpisodes") });
  } else {
    body.push(...e.items.map(episodeRow));
    if (e.more > 0) body.push({ type: "TextButton", key: "temore", icon: "expand_more", ...ptw("showAll", "labelText", e.more), onPressed: "titleEpisodesAll" });
  }
  return { type: "Column", key: "tepisodes", gap: 4, children: [sectionTitle("episodes"), ...body] };
}

function similarBlock(m) {
  return {
    type: "Column", key: "tsimilar", gap: 8, children: [
      sectionTitle("similar"),
      { type: "SingleChildScrollView", key: "tsimilar-scroll", direction: "horizontal", children: [{
        type: "Row", gap: 12, children: m.similar.map((s) => ({
          type: "titleCard", key: "ts-" + s.id, size: "small",
          item: { id: s.id, ref: s.ref, kind: s.kind, title: s.title, ...(s.year ? { year: s.year } : {}), poster: s.poster },
          onTap: { event: "titleOpen", arg: s.ref },
        })),
      }] },
    ],
  };
}

/** The tree of [model] (a `titleModel` answer). */
export function titleTree(m, { region = "" } = {}) {
  if (m.status === "loading") return { body: { type: "Column", key: "titleBody", gap: 12, children: [skeletonPage()] }, every: { ms: 1000, event: "titleLoad" } };
  if (m.status === "failed") return { body: { type: "Column", key: "titleBody", gap: 12, children: [failedPage()] } };
  const parts = [hero(m)];
  for (const block of m.blocks) {
    if (block === "facts") parts.push(facts(m));
    else if (block === "genres") parts.push({ type: "Row", key: "tgenres", wrap: true, gap: 8, children: m.genres.map((g, i) => ({ type: "Badge", key: "tg-" + i, ...same(g) })) });
    else if (block === "actions") { const a = actions(m); if (a) parts.push(a); }
    else if (block === "overview") parts.push({ type: "Column", key: "toverview", gap: 8, children: [sectionTitle("overview"), { type: "Text", canRequestFocus: true, ...same(m.overview) }] });
    else if (block === "platforms") parts.push(platformsBlock(m, region));
    else if (block === "cast") parts.push(castBlock(m));
    else if (block === "seasons") parts.push(seasonsBlock(m));
    else if (block === "episodes") parts.push(episodesBlock(m));
    else if (block === "similar") parts.push(similarBlock(m));
  }
  return { body: { type: "Column", key: "titleBody", gap: 16, children: parts } };
}

/**
 * The whole screen of the title route for [args] from the screen's [state] (`state.td[key]` holds the loaded data): the model,
 * read with the person's follows and platforms, in the shell without a tab bar.
 */
export function titleView({ args, state = {}, device = "phone" }) {
  const a = titleArgs(args);
  if (!a) return shell({ route: "title", body: { type: "Column", key: "titleBody", gap: 12, children: [failedPage()] } });
  const td = state && state.td && typeof state.td === "object" ? state.td : {};
  const follows = a.kind === "series" ? followList() : [];
  const m = titleModel({
    args: a,
    entry: td[titleKey(a)] || null,
    followed: follows.find((f) => f.tmdbId === a.tmdbId) || null,
    followCount: follows.length,
    chosen: enabledPlatforms(kino.config).map((p) => p.providerId),
  });
  const { body, every } = titleTree(m, { region: regionOf(kino.config), device });
  return shell({ route: "title", body, every });
}
