// The first-run stepper's tree (route "setup"), a pure view of the `setup` that state.js keeps. Kino's own `steps` draws the
// three steps (numbered circles, the done ones pressable to go back); an older Kino without it gets the same content under a
// "Paso N de 3" heading. D-pad friendly: the main button of each step takes the focus, Atrás sits before it in the same row.
import { tw } from "../i18n.js";
import { PLATFORMS, platformByKey } from "../platforms.js";
import { COUNTRIES, countryByCode, runProgress } from "./state.js";
import { shell } from "./shell.js";

const TICK = { ms: 1000, event: "setupTick" };

const point = (key, icon, textKey) => ({
  type: "Row", key, gap: 8, crossAxisAlignment: "start", children: [
    { type: "Icon", name: icon, color: icon === "check" ? "primary" : "muted" },
    { type: "Text", flex: 1, ...tw(textKey) },
  ],
});

const backButton = () => ({ type: "TextButton", key: "setupBack", icon: "arrow_back", ...tw("back", "labelText"), onPressed: "setupBack" });

function stepOne() {
  return [
    { type: "Text", style: "caption", color: "muted", ...tw("stepOf", "text", 1) },
    { type: "Text", style: "h3", ...tw("introHeadline") },
    { type: "Text", style: "h5", ...tw("isTitle") },
    point("is1", "check", "is1"),
    point("is2", "check", "is2"),
    point("is3", "check", "is3"),
    { type: "Text", style: "h5", ...tw("isNotTitle") },
    point("isNot1", "close", "isNot1"),
    point("isNot2", "close", "isNot2"),
    { type: "Text", style: "caption", color: "muted", ...tw("credit") },
    { type: "Row", key: "step1Buttons", gap: 12, children: [
      { type: "ElevatedButton", key: "setupNext1", icon: "arrow_forward", autofocus: true, ...tw("next", "labelText"), onPressed: "setupNext" },
    ] },
  ];
}

function stepTwo(setup) {
  return [
    { type: "Text", style: "caption", color: "muted", ...tw("stepOf", "text", 2) },
    {
      type: "Form", key: "setupForm", onSubmitted: "setupNext", gap: 16, children: [
        {
          type: "Chips", key: "platforms", multiple: true, required: true, minLength: 1,
          ...tw("platformsLabel", "labelText"), ...tw("platformsHint", "hintText"), ...tw("pickPlatform", "errorText"),
          ...(setup.picks.length ? { value: setup.picks } : {}),
          options: PLATFORMS.map((p) => ({ value: p.key, label: p.name, labelEn: p.name })),
        },
        {
          type: "DropdownButton", key: "country", required: true,
          ...tw("countryLabel", "labelText"), ...tw("countryHint", "hintText"), ...tw("pickCountry", "errorText"),
          ...(setup.region ? { value: setup.region } : {}),
          options: COUNTRIES,
        },
        { type: "Row", key: "step2Buttons", gap: 12, children: [
          backButton(),
          { type: "ElevatedButton", key: "setupNext2", icon: "arrow_forward", submit: true, ...tw("next", "labelText") },
        ] },
      ],
    },
  ];
}

const STATUS = {
  pending: { icon: "schedule", color: "muted", text: "stPending" },
  ok: { icon: "check", color: "primary", text: "stOk" },
  empty: { icon: "info", color: "muted", text: "stEmpty" },
  failed: { icon: "error", color: "error", text: "stFailed" },
};

const names = (keys) => keys.map((k) => platformByKey(k).name).join(", ");

function platformLine(key, status) {
  const s = STATUS[status] || STATUS.pending;
  return {
    type: "Row", key: "pl-" + key, gap: 12, crossAxisAlignment: "center", children: [
      { type: "Icon", name: s.icon, color: s.color },
      { type: "Text", flex: 1, text: platformByKey(key).name, textEn: platformByKey(key).name },
      { type: "Text", style: "caption", color: s.color, ...tw(s.text) },
    ],
  };
}

function stepThree(setup) {
  const country = countryByCode(setup.region);
  const out = [
    { type: "Text", style: "caption", color: "muted", ...tw("stepOf", "text", 3) },
    { type: "Text", ...tw("summary", "text", names(setup.picks), country ? [country.label, country.labelEn] : ["", ""]) },
  ];
  const run = setup.run;
  if (!run) {
    out.push(
      { type: "Text", style: "caption", color: "muted", ...tw("startHint") },
      { type: "Row", key: "step3Buttons", gap: 12, children: [
        backButton(),
        { type: "ElevatedButton", key: "setupStart", icon: "play", autofocus: true, ...tw("start", "labelText"), onPressed: "setupStart" },
      ] },
    );
    return out;
  }
  const { done, total } = runProgress(run);
  out.push({ type: "LinearProgressIndicator", key: "setupProgress", value: total ? done / total : 0, ...tw("progress", "labelText", done, total) });
  for (const key of setup.picks) out.push(platformLine(key, run.per[key]));
  const failed = setup.picks.filter((k) => run.per[k] === "failed");
  if (run.status === "partial") {
    out.push(
      { type: "MaterialBanner", key: "setupPartial", role: "warning", ...tw("partialTitle", "title"), ...tw("partialText", "text", names(failed)) },
      { type: "Row", key: "partialButtons", gap: 12, children: [
        { type: "TextButton", key: "setupRetry", icon: "refresh", ...tw("retry", "labelText"), onPressed: "setupRetry" },
        { type: "ElevatedButton", key: "setupFinish", icon: "arrow_forward", autofocus: true, ...tw("goCatalog", "labelText"), onPressed: "setupFinish" },
      ] },
    );
  } else if (run.status === "failed") {
    out.push(
      { type: "MaterialBanner", key: "setupFailed", role: "error", ...tw("failedTitle", "title"), ...tw("failedText") },
      { type: "Row", key: "failedButtons", gap: 12, children: [
        backButton(),
        { type: "ElevatedButton", key: "setupRetry", icon: "refresh", autofocus: true, ...tw("retry", "labelText"), onPressed: "setupRetry" },
      ] },
    );
  }
  return out;
}

const STEP_TITLES = ["step1Title", "step2Title", "step3Title"];

/** What a done step shows collapsed. */
function doneSubtitle(n, setup) {
  if (n === 2 && setup.picks.length) {
    const c = countryByCode(setup.region);
    const list = names(setup.picks);
    return { subtitle: c ? `${list} · ${c.label}` : list, subtitleEn: c ? `${list} · ${c.labelEn}` : list };
  }
  return {};
}

/**
 * The stepper's whole tree for [setup] (already cleaned). `hasSteps`: this Kino draws `steps` (else plain headings). While the
 * run loads, a one-second timer sends "setupTick" (one platform per tick, so the progress moves).
 */
export function stepperView({ setup, hasSteps = true }) {
  const content = setup.step === 1 ? stepOne() : setup.step === 2 ? stepTwo(setup) : stepThree(setup);
  const body = hasSteps
    ? {
      type: "steps", key: "setupSteps", onStepTap: "setupGoto",
      items: STEP_TITLES.map((titleKey, i) => {
        const n = i + 1;
        const state = n < setup.step ? "done" : n === setup.step ? "current" : "pending";
        return { key: "s" + n, ...tw(titleKey, "title"), state, ...(state === "done" ? doneSubtitle(n, setup) : {}), ...(state === "current" ? { children: [{ type: "Column", key: "stepBody", gap: 12, children: content }] } : {}) };
      }),
    }
    : { type: "Column", key: "stepBody", gap: 12, children: [{ type: "Text", style: "h3", ...tw(STEP_TITLES[setup.step - 1]) }, ...content] };
  const loading = Boolean(setup.run && setup.run.status === "loading");
  return shell({ route: "setup", body, every: loading ? TICK : undefined });
}
