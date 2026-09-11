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

If you're testing from behind a corporate/sandbox HTTPS proxy (e.g. Claude
Code's own sandboxed environments): Node's built-in `fetch` — which
`publicSignupApi.ts` uses — does not read `HTTPS_PROXY` by default and will
fail with a confusing 403 hitting `www.signupgenius.com` even though `curl`
to the same host works fine. Run with `NODE_USE_ENV_PROXY=1` set (Node ≥
22.21) to fix it. Not needed in GitHub Actions — runners there have normal
direct internet access.

## Scripts

| | |
|---|---|
| `npm run generate` | Fetch from SignUpGenius, write `data.json` |
| `npm run validate` | Validate `dist/data.json` (or a given path) against `schema/data.schema.json` |
| `npm run build` / `typecheck` | `tsc --noEmit` |
| `npm test` | vitest |
| `npm run lint` | ESLint |

## How it works

1. `GET /signups/created/active/` (key API) — list all active sign-ups.
2. Identify the canteen sign-up by title prefix (`CANTEEN_TITLE_PREFIX`, default
   `"Canteen Volunteer"`) or an explicit `CANTEEN_SIGNUP_ID` override.
3. **Canteen — preferred path:** `POST
   https://www.signupgenius.com/SUGboxAPI.cfm?go=s.getSignupInfo` (keyless,
   undocumented — see `src/publicSignupApi.ts`). Per DESIGN.md section 5, this
   was always meant to be the primary source. It returns, per date: a
   `slotid` (the id the `-date-wrap` deep-link anchor needs) and, per shift,
   `qty`/`qtyTaken` — SignUpGenius's own capacity/filled counts, used
   directly rather than inferred. One quirk handled: `qtyTaken` comes back as
   `""` (not `0`) when a shift is completely unfilled — see `toCount()`.
   **Fallback:** if this endpoint fails or returns nothing, falls back to
   `GET /signups/report/all/{signupid}/` (key API) — each row there is one
   (date, shift-item) slot instance, capacity/filled inferred from row
   presence — with the bare `signupUrl` in place of a real deep link (no
   `slotid` is obtainable from this endpoint; see "Canteen deep link"
   below), and a `diagnostics.warnings` entry recording why. Either way:
   weekday-only, 3pm Sydney day-rollover, "closed" (zero-capacity weekday)
   detection per DESIGN.md section 4.2.
4. **Events — same preferred/fallback pattern as canteen.** Every other
   active sign-up tries the public `getSignupInfo` endpoint first (summed
   across all its slots/items — DESIGN.md section 4.2: "v1 assumes one event
   = one date"), falling back to `/signups/report/all/` (key API) only if
   that fails. Unlike canteen there's no deep-link difference between the two
   paths (events link to the bare `signupUrl` either way), so an event only
   counts as a real *failure* (toward the >3 threshold below) if **both**
   sources fail for it — one succeeding quietly is not a failure. Dropped
   after Sydney midnight on the event date.
5. Any top-level fetch failure aborts the run without writing — the previous
   `data.json` is left in place (`DESIGN.md` section 4.3). A single event
   that fails *both* sources is skipped and recorded in
   `diagnostics.warnings` instead of aborting the whole run.
   `diagnostics.canteenSource` records which canteen path (`"public-sheet"`
   or `"key-api"`) actually served this run.

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
nested one level *above* `slotitemid` in that response's shape.

While fixing this, also switched canteen (and, since it works identically for
one-off sign-ups, events too) capacity/filled to come from that same
endpoint's `qty`/`qtyTaken` fields directly (see "How it works" above)
instead of being inferred from `/signups/report/all/` row presence — this
was always DESIGN.md's originally-specified preferred source, and is
strictly more accurate (SignUpGenius's own numbers, not our inference). The
key API remains as a fallback if the public endpoint ever breaks — without
real deep links for canteen; identical otherwise for events.

Also applied the same `toCount()` (in `src/numbers.ts`) defensively to the
key API's `myqty` field in both fallback paths — the "`\"\"` means zero"
quirk hasn't actually been observed there, but the previous `row.myqty || 0`
only coincidentally handled the falsy empty-string case and would have
silently broken the same way on any other non-numeric-string value.

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
