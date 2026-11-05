// The Ajustes route: Kino's own `settings` node for the plugin's 12 real settings (saved as they change) and its two actions,
// plus the plugin's own widgets for the preferences kept in kino.shared `prefs` (they did not fit Kino's 12-setting form), and
// where the new-episode notices are switched on (the job's own switch in Kino's Ajustes; a tap here can turn it on).
import { tw } from "../i18n.js";
import { PLATFORMS } from "../platforms.js";
import { NEW_EPISODE_DAYS } from "../prefs.js";

const section = (key, titleKey, children, hintKey) => ({
  type: "Column", key, gap: 8, children: [
    { type: "Text", style: "h4", ...tw(titleKey) },
    ...(hintKey ? [{ type: "Text", style: "caption", color: "muted", ...tw(hintKey) }] : []),
    ...children,
  ],
});

const prefSwitch = (pref, key, labelKey, hintKey, value) => ({
  type: "Column", key: key + "Box", gap: 4, children: [
    { type: "Switch", key, value, ...tw(labelKey, "labelText"), onChanged: { event: "pref", arg: pref } },
    { type: "Text", style: "caption", color: "muted", ...tw(hintKey) },
  ],
});

/**
 * [prefs]: the validated prefs (prefs.js `prefsOf`); [jobOn]: whether Kino's row of the episodes job is on (null when this
 * Kino cannot tell).
 */
export function settingsView({ prefs, jobOn }) {
  const notices = [{ type: "Text", ...tw("noticesText") }];
  if (jobOn === true) notices.push({ type: "Text", style: "caption", color: "primary", ...tw("noticesOn") });
  else {
    if (jobOn === false) notices.push({ type: "Text", style: "caption", color: "muted", ...tw("noticesOff") });
    notices.push({ type: "Button", variant: "secondary", key: "enableEpisodes", icon: "notifications", ...tw("noticesEnable", "labelText"), onPressed: "enableEpisodes" });
  }
  return {
    type: "Column", key: "settingsPage", gap: 24, children: [
      section("setPlatforms", "setPlatformsTitle", [
        { type: "settings", key: "settingsPlatforms", autoSave: true, onSaved: "saved", keys: [...PLATFORMS.map((p) => "p_" + p.key), "region"] },
      ]),
      section("setShow", "setShowTitle", [
        { type: "settings", key: "settingsShow", autoSave: true, onSaved: "saved", keys: ["kinds", "newDays", "tmdbKey"] },
      ]),
      section("setApp", "setAppTitle", [
        prefSwitch("homeRows", "prefHomeRows", "prefHomeRows", "prefHomeRowsHint", prefs.homeRows),
        prefSwitch("hideWatched", "prefHideWatched", "prefHideWatched", "prefHideWatchedHint", prefs.hideWatched),
        prefSwitch("autoFollow", "prefAutoFollow", "prefAutoFollow", "prefAutoFollowHint", prefs.autoFollow),
        prefSwitch("notifyDigest", "prefNotifyDigest", "prefNotifyDigest", "prefNotifyDigestHint", prefs.notifyDigest),
        {
          type: "DropdownButton", key: "prefNewEpisodeDays", value: String(prefs.newEpisodeDays), ...tw("prefNewEpisodeDays", "labelText"),
          onChanged: { event: "pref", arg: "newEpisodeDays" },
          options: NEW_EPISODE_DAYS.map((n) => ({ value: String(n), ...tw("days", "label", n) })),
        },
      ], "setAppHint"),
      section("setNotices", "noticesTitle", notices),
      section("setMaintenance", "maintenanceTitle", [
        { type: "settings", key: "settingsActions", onSaved: "saved", keys: ["resetIntro", "reloadCatalog"] },
      ]),
      { type: "Text", style: "caption", color: "muted", ...tw("credit") },
    ],
  };
}
