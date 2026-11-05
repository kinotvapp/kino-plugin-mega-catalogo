# Mega Catálogo (Mega Catalog)

A catalog-only Kino plugin: it shows what is available on the streaming platforms the person picks (Netflix, Prime Video,
Disney+, Max, Apple TV+, Paramount+, Crunchyroll, Hulu) in the person's country, what is new, and lets them search and follow
series. Data comes from TMDB through `kino.tmdb` (Kino brings the key).

## What it is and is not

- It is a catalog. `catalogOnly: true`, no account, no login, always `include_adult=false` (there is no setting for 18+).
- It never plays anything and is not from any platform. A title's main button is **Buscar dónde verlo** (`go.titleByIds`):
  Kino looks the title up in the person's other plugins (one match plays, several open the sources list, none says so).
- Hosts: only `image.tmdb.org` (posters). The plugin declares no TMDB host.

## Requirements

Kino with `apiVersion` 23 (the manifest declares it; the validator notes it needs Kino 0.9.83 or later).

## The flow

- **First run (stepper).** The screen shows three steps until `setupDone` (kino.storage) is set: 1) what it is and is not, with the
  data credit; 2) pick platforms (`Chips`, at least one) and a country (required, no "auto" in the stepper); 3) Comenzar writes
  the choices to the real settings (`config`), loads page 1 of each kind for every chosen platform with per-platform progress
  (about 2 TMDB calls per platform) and sets `setupDone` once at least one platform loaded. Failed platforms can be retried.
- **Inicio.** Rails per chosen platform ("Nuevo en X", "Lo más visto en X"), merged Películas / Series rails, five genre rails,
  and first a rail "Capítulos nuevos de tus series". A hero slider, a platform filter (with 2+ platforms), skeletons while rails
  load (one rail per 1 s tick, only when the TMDB throttle has room). The catalog keeps filling in the background while it is open.
- **Buscar.** Searches the local catalog (kino.catalog, accent/case insensitive). While any chosen platform has fewer than
  200 titles locally, it also runs TMDB `/search/multi` and keeps only results whose `/watch/providers` confirm a chosen platform
  (at most 10 confirmations). Filters by platform and type are client side.
- **Siguiendo.** The followed series, newest episode first, "Nuevo" badge, "Marcar como visto" (one or all), "Ver ficha",
  "Dejar de seguir", and an add box. It also explains the notices switch.
- **Title screen.** Backdrop, logo, synopsis, facts, platforms in the person's country (the chosen ones are marked by TMDB
  provider id), cast, seasons and episodes (series), similar titles, Seguir / Dejar de seguir (series only), "Buscar dónde
  verlo", and "Marcar como visto" when a new episode is pending.
- **Ajustes.** Kino's own settings form for the 12 settings, buttons for the two actions, the plugin's own widgets for the
  prefs, and the state of the `episodes` job with an "Activar los avisos" button.
- Navigation: one merged top bar (`AppBar` with `mergeWithKinoBar`, `dense`) with the tabs Inicio / Buscar / Siguiendo / Ajustes
  as its `bottom`. The Title screen is a pushed route, so Back returns to the previous screen.
- Beyond the screen, Kino's own section and Home also get the rows (the `homeRows` setting turns Home rows off). Home loads only
  the first 3 chosen platforms (at most about 12 TMDB calls); the rest is reachable from browse and the screen.

## Settings

The 12 value settings in `kino-plugin.json` (Kino's limit is 12 values):

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `p_netflix`, `p_prime`, `p_disney`, `p_max`, `p_apple`, `p_paramount`, `p_crunchyroll`, `p_hulu` | toggle | off | one per platform |
| `region` | select | `auto` | 19 countries plus `auto`; `auto` takes the country from Kino's language when it names one (e.g. es-CO), otherwise US |
| `kinds` | select | `both` | `both` / `movie` / `series` |
| `newDays` | select | `90` | 30 / 90 / 180: what counts as new (release date, not the date a title joined a platform) |
| `homeRows` | toggle | on | rows on Kino's Home |

Actions: `resetIntro` (clears `setupDone`, shows the stepper again) and `reloadCatalog` (clears the saved catalog and reloads,
asks for confirmation).

Prefs kept in `kino.shared` key `prefs` (one JSON object that syncs between devices, edited with the plugin's own widgets in
Ajustes, validated on read):

| Pref | Default | Effect |
| --- | --- | --- |
| `hideWatched` | off | hides watched titles from Inicio, Buscar, Kino's Home rows, "Ver más" pages and the `search` export (never the new-episodes row); when off, watched cards carry a "Visto" badge |
| `autoFollow` | off | follows series saved in Kino's library |
| `notifyDigest` | off | one weekly digest notice (needs the `episodes` job on) |
| `newEpisodeDays` | 14 | 7 / 14 / 30: how far back the "Capítulos nuevos" row reaches |

## Jobs

Each job has its own switch in Kino's Ajustes, under Mega Catálogo. Both start off; there is no setting that enables them.

- **`refresh`** ("Actualizar el catálogo", every 180 min, options 60 / 180 / 720 / 1440). Jobs cannot use kino.catalog, so it only
  stages: up to 10 discover pages per run, one at a time, round-robin over platform x kind, into kino.storage key `stage`
  (bounded to 400 titles and 90 KB, tagged with the region). The screen and search merge the stage into kino.catalog when they
  open and clear it. Lists that came back empty are backed off for 24 h. Progress is saved every 5 requests, so a run writes the stage at most twice (Kino cuts a run that writes more than 256 KB).
- **`episodes`** ("Avisar de capítulos nuevos", every 360 min, options 60 / 180 / 360 / 720 / 1440, `runOn: "preferPhone"`).
  Checks up to 8 followed series per run (rotating cursor, so 10 series take two runs; it stops between series after 12 s and saves each series as it goes), compares TMDB's `last_episode_to_air`
  with what it has already seen, posts a bell notice `ep-<tmdbId>` ("T2·E5 «Título» ya salió") whose tap opens the series with
  `titleByIds`, and stores the latest episode for the Home row. It then runs `autoFollow` (at most 2 new follows) and the weekly
  digest (`digest-YYYY-Www`, no TMDB request). Because it prefers the phone, bell notices (per device, not synced) land on the
  phone; a TV still gets the Home row because the data is in kino.shared.

## Following

- Limit: 10 series. The 11th is refused with "Ya sigues 10 series. Deja de seguir una para agregar otra" (and the English
  text), never dropped silently.
- Lives in `kino.shared` key `follows` (syncs between devices). A new follow takes the latest aired episode as its baseline, so
  old episodes do not notify.
- Follow / unfollow is on the Title screen and in Siguiendo.

## The `availability` protocol door

Other plugins can ask where a title can be watched. Declared in `provides.availability`.

| Call | In | Out |
| --- | --- | --- |
| `where` | `{ kind: "movie" \| "series", tmdbId: number, region?: string }` | `{ platforms: Platform[], region }` |
| `search` | `{ q: string }` | `Title[]` (at most 8) |

Types: `Platform { key, name }`, `Title { tmdbId, kind, title, year?, posterUrl?, platforms }`.

`where` reads `/{movie|tv}/{id}/watch/providers` (flatrate, free, ads) for the region (default: the person's) and returns only the
8 known platforms, by provider id. `search` uses `/search/multi` plus one providers lookup per title; a failed lookup gives
`platforms: []`, a failed search is thrown. Bad input is `bad_input`/`bad_request`.

Consumer example (the consumer manifest declares the door):

```json
"consumes": { "mega": { "repo": "kinotvapp/kino-plugin-mega-catalogo", "door": "availability", "calls": ["where", "search"] } }
```

```js
const r = await kino.plugins.call("mega", "where", { kind: "movie", tmdbId: 603, region: "US" });
// r.platforms -> [{ key: "netflix", name: "Netflix" }, ...], r.region -> "US"
const found = await kino.plugins.call("mega", "search", { q: "matrix" });
```

## `meta` for other plugins' titles

The plugin declares `meta` and exports `meta(query)`. For a movie or series from any plugin it resolves the TMDB id from
`ids.tmdb` or, failing that, `/find/{imdb id}`, makes one `/movie|tv/{id}` request with `append_to_response=images,credits`
(plus one English request only when the localized synopsis is empty), and offers the clear logo, up to 20 cast members with
characters, up to 5 genres, year, runtime (movies), poster, backdrop and a synopsis. Kino fills only what is still empty. It
returns null on any error or when nothing usable was found. It has no field for "available on Netflix", so platforms cannot
appear on another plugin's card.

## The `library` permission

`library` is declared in `capabilities`; Kino shows a red consent line ("Podrá leer lo que has visto y guardado en Kino...").
It enables `hideWatched`, the "Visto" badge and `autoFollow`. `watchedRefs()` reads `kino.library.watched({ limit: 100 })` (the
API cap, no offset), cached 60 s. Without the permission, or on any error, it behaves as an empty library and never throws.
`autoFollow` follows series from `kino.library.saved` (movies ignored), never beyond 10, never replaces an existing follow, and
does not re-follow a series the person unfollowed (kino.shared key `autofollowed`). It runs on the screen's `open` event (at
most 3 new) and in the `episodes` job (at most 2 new).

## Budgets and storage

- **TMDB:** Kino's own key allows 20 calls per 10 s per plugin. `tmdb.js` queues every caller and spends at most **16 calls per
  10 s** (cached and failed calls count). The throttle is per runtime, so the screen and a job have separate windows and can
  together exceed 20 (Kino then answers `rate_limited` or serves stale data). A job gets 10 requests per run, one at a time.
- **kino.storage:** 256 KB in total for all keys. Used: `setupDone`, `stage`, `counts`, `fill`, `fillSig`, `jobCursor`,
  `catalogRegion`, `epCursor`, `digestWeek`. The stage is capped well below the limit.
- **kino.shared:** 3 of the 4 allowed keys: `follows`, `prefs`, `autofollowed`.
- **kino.catalog:** one row per kind + TMDB id, evicting the oldest above 90,000 titles. A region change clears it.
- Screen state is kept small: Kino refuses a state over 64 KB, so the Title data is kept by size (the oldest titles are dropped until the whole state is under 56 KB with the Inicio counted at its full size of about 38 KB, whether the title or the Inicio just grew; at most 3 titles, 80 episodes per season page). A title dropped from the state is fetched again when Back returns to it; the Follow button is unaffected (it reads kino.shared). The Inicio fills the catalog 2 pages per tick, so taps never wait long.

## Data credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data is provided by JustWatch
through TMDB. The credit is shown in the first-run stepper, in Ajustes and on the Title screen.

## Commands

Run from `plugins/mega-catalogo`:

```
npm run build          # bundles src/ into plugin.js
npm run check:built    # fails if plugin.js is not exactly what src/ builds to
npm test               # node --test test/*.test.mjs
node ../sdk/validate.mjs .
```

Try it offline with the kit (set `KINO_TMDB_FIXTURE=test/tmdb-fixture.json` for the TMDB answers):

```
node ../sdk/run.mjs . home
node ../sdk/run.mjs . search matrix
node ../sdk/run.mjs . meta tmdb:603 movie
node ../sdk/run.mjs . screen
node ../sdk/run.mjs . job refresh
node ../sdk/run.mjs . job episodes
node ../sdk/run.mjs . notifications
node ../sdk/run.mjs --provider . <consumer folder> screenEvent <name>
node ../sdk/run.mjs . proto availability.where '{"kind":"movie","tmdbId":603}'
```

At the last run: 246 tests pass, `check:built` is green and `validate.mjs` reports "Kino would accept this plugin".

## Not verified yet

Everything below has only been exercised with the kit and fixtures:

- The TMDB provider ids in `src/platforms.js` (Netflix 8, Prime 9, Disney+ 337, Max 1899, Apple TV+ 350, Paramount+ 531,
  Crunchyroll 283, Hulu 15) were never checked against a real TMDB response (`/watch/providers`).
- Nothing has been tested on a real device: D-pad focus (the merged bar with the tab bar as `bottom`, the horizontal rails on
  TV), the bell notices, the `library` permission behind its real consent switch, Back behaviour from the pushed Title route,
  `steps` in the stepper, `enableJob`, and `go.screen` from the digest notice.
- Whether the real `kino.tmdb` allows the `watch/providers` append in `append_to_response` (the Title screen relies on it; the
  kit fixture accepts any path). If Kino rejects it, the Title load fails and shows Retry.
- Whether a job's `kino.tmdb` works at the declared `apiVersion` on a real device.
- Posters work with only `image.tmdb.org` declared in the kit; not seen on a device.
- Home with many platforms and the first-load speed of the stepper on a slow connection.
