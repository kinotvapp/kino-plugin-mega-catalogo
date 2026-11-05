// The Inicio route's tree, a pure view of homeModel.js's view model: the platform chips, the hero slider, then the rails.
// What has not loaded yet is a Skeleton shaped like what replaces it (a banner, a heading over a row of poster cards), so
// nothing jumps when it arrives; a failed rail keeps its place with a line and Reintentar. Every text is in both languages.
//
// Events: `homeOpen` (arg "movie-603" / "series-1399": a card or a slide's Info opens the title route), `homeRetry` (arg a
// rail id), `homeFilter` (the chips' value), `homeTick` (the timer, only while something is left to load).
import { TICK_MS } from "./homeModel.js";

export const HOME_TEXT = {
  allPlatforms: ["Todas", "All"],
  filterLabel: ["Plataforma", "Platform"],
  whereToWatch: ["Buscar dónde verlo", "Find where to watch"],
  info: ["Info", "Info"],
  railFailed: ["No se pudo cargar esta fila.", "This row could not be loaded."],
  retry: ["Reintentar", "Retry"],
  noPlatformTitle: ["Elige una plataforma", "Pick a platform"],
  noPlatformText: ["Enciende al menos una plataforma en Ajustes para ver su catálogo.", "Turn on at least one platform in Settings to see its catalog."],
  openSettings: ["Abrir Ajustes", "Open Settings"],
  nothingTitle: ["Nada por aquí todavía", "Nothing here yet"],
  nothingText: ["Esta plataforma no tiene títulos en tu país.", "This platform has no titles in your country."],
};

/** The pair of properties of a Home text: `hw("retry", "labelText")` -> `{ labelText, labelTextEn }`. */
export function hw(key, prop = "text") {
  const [es, en] = HOME_TEXT[key];
  return { [prop]: es, [prop + "En"]: en };
}

const CARD_SIZE = { compact: "small", expanded: "medium" };

/** A heading bar over a row of poster cards: three on a phone, six on a wide window. */
const railSkeleton = (id) => ({
  type: "Column", key: "rail-" + id, gap: 8, children: [
    { type: "Skeleton", key: "rh-" + id, shape: "line", width: 160 },
    { type: "Row", key: "rc-" + id, gap: 12, sizes: ["compact"], children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `rc-${id}-${i}`, flex: 1 })) },
    { type: "Row", key: "rw-" + id, gap: 12, sizes: ["medium", "expanded"], children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `rw-${id}-${i}`, flex: 1 })) },
  ],
});

const HERO_H = { compact: 200, expanded: 240 };
const heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: HERO_H });

const slideNode = (s) => ({
  type: "heroCard", key: "slide-" + s.key, h: HERO_H, ...(s.logo ? { logo: s.logo } : {}),
  title: s.title, titleEn: s.title, ...(s.text ? { text: s.text, textEn: s.text } : {}), image: s.image,
  buttons: [
    { type: "ElevatedButton", key: "where-" + s.key, icon: "search", ...hw("whereToWatch", "labelText"),
      onPressed: { go: { titleByIds: { tmdb: s.tmdbId, kind: s.kind, title: s.title.slice(0, 120) } } } },
    { type: "TextButton", key: "info-" + s.key, icon: "info", ...hw("info", "labelText"), onPressed: { event: "homeOpen", arg: s.key } },
  ],
});

// The key carries the number of slides: Kino's pager keeps the count of its first drawing, so a slider that changes its
// number of slides must be a new pager.
const heroNode = (slides) => (slides.length === 1 ? slideNode(slides[0]) : {
  type: "PageView", key: "hero" + slides.length, autoPlayMs: 7000, children: slides.map(slideNode),
});

/** A card: Kino's own poster card, its tap opening this plugin's title route. */
const cardNode = (railId, item) => ({
  type: "titleCard", key: `c-${railId}-${item.id}`, size: CARD_SIZE, item, onTap: { event: "homeOpen", arg: item.id },
});

const railNode = (r) => {
  if (r.status === "skeleton") return railSkeleton(r.id);
  const heading = { type: "Text", key: "rt-" + r.id, style: "h4", text: r.title, textEn: r.titleEn };
  if (r.status === "failed") {
    return { type: "Column", key: "rail-" + r.id, gap: 8, children: [
      heading,
      { type: "Row", key: "rf-" + r.id, gap: 12, crossAxisAlignment: "center", children: [
        { type: "Text", key: "rfm-" + r.id, color: "muted", ...hw("railFailed") },
        { type: "TextButton", key: "retry-" + r.id, icon: "refresh", ...hw("retry", "labelText"), onPressed: { event: "homeRetry", arg: r.id } },
      ] },
    ] };
  }
  return { type: "Column", key: "rail-" + r.id, gap: 8, children: [
    heading,
    { type: "SingleChildScrollView", key: "rs-" + r.id, direction: "horizontal", children: [
      { type: "Row", key: "rr-" + r.id, gap: 12, children: r.items.map((it) => cardNode(r.id, it)) },
    ] },
  ] };
};

/** The platform chips ("Todas" and each chosen platform), only when there is more than one platform to pick. */
const chipsNode = (platforms, filter) => ({
  type: "Chips", key: "homeFilter", ...hw("filterLabel", "labelText"), value: filter, onChanged: "homeFilter",
  options: [{ value: "all", ...hw("allPlatforms", "label") }, ...platforms.map((p) => ({ value: p.key, label: p.name, labelEn: p.name }))],
});

/** The body of the Inicio route (one node) and its timer: `{ body, every }` (`every` only while something is left to load). */
export function homeView(model) {
  if (model.empty) {
    const children = model.rails.map(railNode);
    children.push(
      { type: "emptyState", key: "noPlatform", icon: "tune", ...hw("noPlatformTitle", "title"), ...hw("noPlatformText") },
      { type: "ElevatedButton", key: "openSettings", icon: "settings", ...hw("openSettings", "labelText"), onPressed: { event: "tab", arg: "settings" } },
    );
    return { body: { type: "Column", key: "homeEmpty", gap: 16, children } };
  }
  const children = [];
  if (model.platforms.length > 1) children.push(chipsNode(model.platforms, model.filter));
  if (model.hero.status === "ok") children.push(heroNode(model.hero.slides));
  else if (model.hero.status === "skeleton") children.push(heroSkeleton());
  for (const r of model.rails) children.push(railNode(r));
  if (!model.rails.length && model.hero.status === "none") children.push({ type: "emptyState", key: "homeNothing", icon: "movie", ...hw("nothingTitle", "title"), ...hw("nothingText") });
  return {
    body: { type: "Column", key: "home", gap: 24, children },
    ...(model.ticking ? { every: { ms: TICK_MS, event: "homeTick" } } : {}),
  };
}
