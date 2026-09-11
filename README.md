# bps-volunteer-backend

Hourly job that reads canteen + event sign-ups from SignUpGenius and writes a
single `data.json` for `bps-volunteer-ui`. One of three repos — see
[`DESIGN.md`](https://github.com/wkapri/bps-volunteer-ui/blob/main/DESIGN.md)
in `bps-volunteer-ui` for the full design (this repo is `bps-volunteer-cron`
in that doc; kept as `bps-volunteer-backend` for now, may be renamed later).

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
   detection from `DESIGN.md` section 4.2.
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
validate`). **`bps-volunteer-ui`'s mirror schema needs the same fix** — it
still has `"format": "uri"` there.

## Known gaps vs. the v1 design (see `DESIGN.md` section 10)

- **Canteen deep link.** The per-date `#<slotid>-date-wrap` anchor is
  currently derived from the smallest `slotitemid` seen for that date in the
  report response. This is a best-effort stand-in — the design doc flags it as
  **unverified**: confirm it actually lands on the right day in a browser
  before trusting it, or switch to the keyless public sign-up sheet endpoint
  if it doesn't.
- **Event description/image.** SignUpGenius doesn't return a usable
  description for the real sign-ups tested; `description` is currently always
  `null` and `imageUrl` falls back to the theme thumbnail. A hand-maintained
  overrides file may be needed later.
- **"More than 3 failed events" email.** The run logs a warning but does not
  yet send email — SMTP/Resend wiring is deferred (see `DESIGN.md` section 8).

## Environment variables

See [`.env.example`](.env.example). In GitHub Actions:

- `SUG_API_KEY` — secret.
- `DATA_REPO` — repository **variable**, e.g. `wkapri/bps-volunteer-data`. The
  publish step in `.github/workflows/cron.yml` is skipped until this is set.
- `DATA_REPO_TOKEN` — secret, a token with push access to `DATA_REPO`.
