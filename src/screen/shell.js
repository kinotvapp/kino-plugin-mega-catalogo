// The frame every route is drawn in: a Scaffold whose one AppBar is Kino's title bar merged with ours (the plugin's name, a Close
// or, on the title page, a Back arrow). Inicio and Siguiendo get the TabBar as the bar's bottom, with Buscar and Ajustes as buttons of the bar (Back on those two), above a
// body that scrolls; the stepper and the title page have none (the stepper is a flow of its own).
// On a TV the tab bar is one D-pad strip: Left and Right walk the tabs, Down enters the body.
import { tw } from "../i18n.js";
import { LOGO_ASPECT, LOGO_DATA } from "./logo.js";

const TAB_TEXT = { home: "tabHome", search: "tabSearch", following: "tabFollowing", settings: "tabSettings" };

/** The content tabs under the bar; Buscar and Ajustes are buttons of the bar itself, not tabs. */
export const BAR_TABS = ["home", "following"];

/** The top tab bar with [route] picked; its `onChanged` event "tab" carries the route as its value. */
export function tabBar(route) {
  return {
    type: "TabBar",
    key: "tabs",
    divider: false,
    value: route,
    onChanged: "tab",
    tabs: BAR_TABS.map((r) => ({ value: r, ...tw(TAB_TEXT[r], "label") })),
  };
}

/** The page padding: tight on a phone, the TV's overscan-safe room on a wide window. */
export const PAGE_PADDING = { compact: 12, expanded: 24 };

/** The plugin's name in the one bar (Kino's own title bar is merged into it, so the person still sees whose screen this is). */
const BAR_TITLE = {
  title: { type: "Image", key: "logo", url: LOGO_DATA, aspect: LOGO_ASPECT, fit: "contain", h: 40, alt: "Mega Catálogo", altEn: "Mega Catalog" },
};

/** The bar's single exit: Back on the title page (pops to where the person came from), Close everywhere else. */
function leadingOf(route) {
  if (route === "search" || route === "settings") {
    return { type: "IconButton", key: "barHome", icon: "arrow_back", ...tw("back", "labelText"), onPressed: { event: "tab", arg: "home" } };
  }
  return route === "title"
    ? { type: "IconButton", key: "barBack", icon: "arrow_back", ...tw("back", "labelText"), onPressed: "back" }
    : { type: "IconButton", key: "barClose", icon: "close", ...tw("close", "labelText"), onPressed: { close: true } };
}

/**
 * The whole tree of [route] around its [body] (one node): a Scaffold whose AppBar is Kino's bar and ours in one
 * (`mergeWithKinoBar`, `dense`), with the TabBar as its `bottom` on a tab route, and the body in a keyed scroll (Kino keeps each
 * tab's scroll); `every` (a timer) goes on the root.
 */
export function shell({ route, body, every }) {
  const appBar = { type: "AppBar", key: "bar", mergeWithKinoBar: true, dense: true, ...BAR_TITLE, leading: leadingOf(route) };
  if (BAR_TABS.includes(route)) {
    appBar.bottom = tabBar(route);
    appBar.actions = [
      { type: "IconButton", key: "barSearch", icon: "search", ...tw("tabSearch", "labelText"), ...tw("tabSearch", "tooltip"), onPressed: { event: "tab", arg: "search" } },
      { type: "IconButton", key: "barSettings", icon: "settings", ...tw("tabSettings", "labelText"), ...tw("tabSettings", "tooltip"), onPressed: { event: "tab", arg: "settings" } },
    ];
  }
  // A title page's banner goes edge to edge: lifted out of the padded column, right under the bar.
  const banner = body && body.key === "titleBody" && Array.isArray(body.children) && body.children[0] && body.children[0].type === "heroCard" ? body.children[0] : null;
  const rest = banner ? { ...body, children: body.children.slice(1) } : body;
  const page = {
    type: "SingleChildScrollView",
    key: "page-" + route,
    children: [...(banner ? [banner] : []), { type: "Column", key: "body-" + route, padding: PAGE_PADDING, gap: 16, children: [rest] }],
  };
  const root = { type: "Scaffold", key: "app", appBar, body: page };
  return every ? { ...root, every } : root;
}
