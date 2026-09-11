# bps-volunteer-backend

Hourly job that reads canteen + event sign-ups from SignUpGenius and writes
`docs/data.json`, served by this repo's own GitHub Pages for
`bps-volunteer-ui` to fetch. See
[`DESIGN.md`](https://github.com/wkapri/bps-volunteer-ui/blob/main/DESIGN.md)
in `bps-volunteer-ui` for the full design (this repo covers what that doc
calls `bps-volunteer-cron` *and* `bps-volunteer-data` — merged into one repo;
see [Deviations from DESIGN.md](#deviations-from-designmd)).

There is no server here — it's a script GitHub Actions runs on a schedule,
not a long-running backend.

## Develop

```bash
npm install
cp .env.example .env   # fill in SUG_API_KEY
npm run generate       # writes dist/data.json
```

## Scripts

| | |
|---|---|
| `npm run generate` | Fetch from SignUpGenius, write `data.json` |
| `npm run validate` | Validate `dist/data.json` (or a given path) against `schema/data.schema.json` |
| `npm run build` / `typecheck` | `tsc --noEmit` |
| `npm test` | vitest |
| `npm run lint` | ESLint |

## How it works

1. `GET /signups/created/active/` — list all active sign-ups.
2. Identify the canteen sign-up by title prefix (`CANTEEN_TITLE_PREFIX`, default
   `"Canteen Volunteer"`) or an explicit `CANTEEN_SIGNUP_ID` override.
3. `GET /signups/report/all/{signupid}/` for the canteen sign-up — each row is
   one (date, shift-item) slot instance; an unfilled instance has blank
   participant fields and `myqty` is its remaining capacity. Grouped by date,
   summed into per-shift and per-day capacity/filled, filtered to weekdays,
   with the 3pm Sydney day-rollover and "closed" (zero-capacity weekday)
   detection from `DESIGN.md` section 4.2. Separately,
   `POST https://www.signupgenius.com/SUGboxAPI.cfm?go=s.getSignupInfo`
   (keyless, undocumented — see `src/publicSignupApi.ts`) for the per-date
   `slotid` each day's deep-link anchor needs — a *different* id from
   `slotitemid` above; see "Canteen deep link" below.
4. Same report call for every other active sign-up → `events`, dropped after
   Sydney midnight on the event date.
5. Any top-level fetch failure aborts the run without writing — the previous
   `data.json` is left in place (`DESIGN.md` section 4.3). A single failed
   event is skipped and recorded in `diagnostics.warnings` instead of aborting
   the whole run.

## Schema fix vs. bps-volunteer-ui's mirror

`schema/data.schema.json`'s `canteenDay.deepLink` had `"format": "uri"`, which
`ajv` correctly rejects for SignUpGenius's real deep-link URLs — they contain
a second, unencoded `#` (`...#/#836678361-date-wrap`), which isn't strictly
RFC 3986-conformant even though it's what SignUpGenius itself generates and
browsers handle fine. Fixed here by dropping the `format` constraint on that
one field (confirmed against a real generated `data.json` + `npm run
validate`). Applied the same fix to `bps-volunteer-ui`'s mirror schema.

## Canteen deep link (was broken, now fixed)

`DESIGN.md` section 10 flagged the per-date `#<slotid>-date-wrap` anchor as
unverified. It was in fact broken: the original implementation used the
smallest `slotitemid` seen for that date in `/signups/report/all/` —
`slotitemid` is a **per-shift** id, not the per-date id the `-date-wrap`
anchor needs, so every deep link pointed at the wrong (or a non-existent)
anchor. Confirmed 2026-09-11 by reverse-engineering signup.min.js: the real
per-date `slotid` only appears in the separate, keyless
`SUGboxAPI.cfm?go=s.getSignupInfo` endpoint (see `src/publicSignupApi.ts`),
nested one level *above* `slotitemid` in that response's shape. Cron now
calls both endpoints; if the public one fails, it falls back to the bare
`signupUrl` and records a `diagnostics.warnings` entry rather than breaking
the link silently.

## Other known gaps vs. the v1 design (see `DESIGN.md` section 10)

- **Event description/image.** SignUpGenius doesn't return a usable
  description for the real sign-ups tested; `description` is currently always
  `null` and `imageUrl` falls back to the theme thumbnail. A hand-maintained
  overrides file may be needed later.
- **"More than 3 failed events" email.** The run logs a warning but does not
  yet send email — SMTP/Resend wiring is deferred (see `DESIGN.md` section 8).

## Environment variables

See [`.env.example`](.env.example). In GitHub Actions, only one secret is
needed:

- `SUG_API_KEY` — secret (Settings → Secrets and variables → Actions → New
  repository secret). **Required** for the workflow to run at all.

The commit-back-to-this-repo step uses the workflow's automatic `GITHUB_TOKEN`
(no PAT to create, rotate, or have expire) — see below.

## Deviations from DESIGN.md

`DESIGN.md` specs three repos (`bps-volunteer-ui`, `-cron`, `-data`). This
repo merges `-cron` and `-data` into one, for two practical reasons:

1. **No cross-repo credential to maintain.** Publishing to a separate repo
   needs a PAT (fine-grained tokens expire; even "no expiration" is a
   standing credential to track). Committing to *this* repo's own
   `docs/data.json` uses the workflow's automatic `GITHUB_TOKEN`
   (`permissions: contents: write`) — issued fresh per run, nothing to
   rotate.
2. **Avoids scheduled-workflow auto-disable.** GitHub disables a scheduled
   workflow after 60 days with no activity on the repo that hosts it. A
   separate `bps-volunteer-data` repo could go quiet from this repo's point
   of view even while the cron "worked" (it only ever touched the *other*
   repo). Since every hourly run now commits to this repo directly, that
   60-day clock never has a chance to fire.

`bps-volunteer-data` (if you created it) is unused — data now lives in
`docs/data.json` here, served by this repo's own GitHub Pages.

### Enabling Pages for this repo

Settings → Pages → "Build and deployment" → Source: **Deploy from a branch**
→ Branch: `main`, folder **`/docs`**. Once enabled, `data.json` is served at:

```
https://wkapri.github.io/bps-volunteer-backend/data.json
```
