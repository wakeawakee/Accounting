# KarSathi — compliance & client-chasing assistant for Nepali accountants

Accountants add their business clients once. KarSathi knows the recurring IRD deadlines (VAT, TDS, annual income tax) on the **Bikram Sambat** calendar, sends clients SMS reminders with a **personal upload link**, collects bill photos/PDFs, and shows one dashboard of who has sent documents and who is close to a deadline.

KarSathi does **not** do accounting, invoicing, tax calculation or e-filing.

> ⚠️ **The deadline rules are placeholders.** Have a tax professional check `packages/shared/src/rules/config.ts` against current IRD notices, then update `verifiedOn`. The date is shown in **Settings → Compliance rules**.

## Repo layout

```
apps/api         Express + Mongoose REST API, BullMQ jobs
apps/web         React + Vite + Tailwind dashboard and the public upload page (/u/:token)
packages/shared  BS date wrapper, rules engine, reminder timing, SMS segment counter, Zod schemas, templates
```

Main files:

| What | Where |
|---|---|
| BS ↔ AD conversion (wraps `nepali-date-converter`, BS 2000–2090) | `packages/shared/src/bsDate.ts` |
| Rule sets per fiscal year (data, not code) | `packages/shared/src/rules/config.ts` |
| Task generation engine | `packages/shared/src/rules/engine.ts` |
| Quiet hours / reminder times | `packages/shared/src/reminders.ts` |
| Tenancy guard (every query must filter by `firmId`) | `apps/api/src/db/tenantPlugin.ts` |
| Reminder send / retry / auto-stop | `apps/api/src/services/reminders.ts` |
| Job scheduler (BullMQ, or setInterval without Redis) | `apps/api/src/jobs/scheduler.ts` |
| Message providers (Console, HTTP SMS, Viber stub) | `apps/api/src/services/messaging/index.ts` |
| Storage (local disk / S3-compatible) + magic-byte checks | `apps/api/src/services/storage/index.ts` |
| Excel/CSV import + validation report | `apps/api/src/services/importer.ts` |

## Local setup

Requires Node 20+, pnpm 9+, and Docker (for MongoDB and Redis).

```bash
pnpm install
cp .env.example .env        # defaults work for local dev
pnpm dev                    # docker compose up -d, then API (:4000) + web (:5173)
```

If you run MongoDB/Redis yourself (no Docker), use `pnpm dev:apps`. Without `REDIS_URL`, the API uses an in-process scheduler.

Then:

1. Open http://localhost:5173 and sign up. This creates your firm and its owner account.
2. Go to **Clients → Import from Excel/CSV** and upload `apps/api/samples/clients-50.xlsx` (regenerate it with `pnpm sample:excel`). Columns are matched automatically. Click **Check rows**, then **Import**.
3. **Today** and **Tasks** now list VAT/TDS tasks for the current BS month, plus the annual return.
4. Reminders go to the API console (`ConsoleProvider`). To test sending, use **📩 Send reminder now** on a task, or wait for the scheduler.
5. Click **🔗 Upload link** on a task, open the link on your phone (same Wi-Fi: set `WEB_URL` to your LAN IP and run `pnpm --filter @karsathi/web dev --host`), then upload photos. The task changes to *Docs received*, its reminders stop, and the 🔔 bell shows the upload within about 15 seconds.

Demo data: `pnpm seed` creates a firm with 20 clients. Log in as `demo@karsathi.test` / `demo12345` (staff user: `staff@karsathi.test`).

## Tests

```bash
pnpm test
```

- `packages/shared`: rules engine and BS date tests. Covers month lengths of 29–32 days, round-tripping every day from 2080 to 2089, FY rollover (Ashadh → Shrawan), year rollover (Chaitra → Baisakh), holiday flags and shifts, trimesters, custom rules, and rule-set versioning. Also tests quiet hours, SMS segments and validation.
- `apps/api`: Supertest tests covering tenancy isolation (firm A can't read or change firm B's data, staff scoping, and the plugin rejecting unscoped queries). Also tests Excel import, reminder scheduling and sending, retry and backoff, auto-stop on upload, magic-byte rejection, bulk filing and templates.
  The API tests need MongoDB. By default they start an in-memory MongoDB (`mongodb-memory-server` downloads a `mongod` binary the first time it runs). To use the docker-compose Mongo instead, run `MONGO_URL_TEST=mongodb://127.0.0.1:27017 pnpm test`.

## How it works

**Deadlines are data.** Each fiscal year has a `RuleSet` with its rules, holidays and `verifiedOn` date. A period uses the rule set for its own fiscal year, or the latest earlier one if none exists. After the budget (Jestha), copy the latest set, edit it and add it to `RULE_SETS`. Firms can add custom recurring tasks (monthly, trimester or annual) in Settings.

**Task generation.** For each applicable rule, the engine makes tasks for the *current* period (the earliest one whose due date is today or later) and the *next* one. On 4 Mangsir, for example, VAT tasks are Kartik (due 25 Mangsir) and Mangsir (due 25 Poush). A daily job marks overdue tasks as `missed` and creates the next periods. Due dates that fall on a Saturday or a configured holiday are **flagged, not moved**, unless the rule has `shiftIfHoliday: true`.

**Reminders.** When a task is created, `Reminder` rows are scheduled at the firm's offsets (default 10, 5, 2 and 0 days before the due date) at the firm's send time (default 10:00 NPT). Nothing is sent during quiet hours (default 20:00–08:00 Asia/Kathmandu); quiet hours are checked both when scheduling and again at send time. A failed send is retried after 2, 4 and 8 minutes, up to 3 attempts. Reminders are cancelled when a task becomes `docs_received` or `filed`, or when the client is deactivated. Every send is written to `MessageLog` with its segment count and a cost estimate (Settings → Messages & cost).

**Tenancy.** A Mongoose plugin throws `TenantScopeError` for any query on a tenant model that lacks `firmId`. Only background jobs and the public upload lookup opt out, explicitly, with `{ crossTenant: true }`. Staff users see only the clients assigned to them.

## Changes from the spec — please review

1. **Magic links use a short random token stored in the DB instead of a signed JWT.** A JWT is about 200 characters, which would add 3 or more Unicode SMS segments to every message and roughly triple the SMS cost. Tokens are 12 random characters (about 70 bits), expire after 30 days, are tied to one client and one task, and can be revoked by deleting the row.
2. **`bcryptjs` instead of `bcrypt`.** It is the same algorithm (cost 12) with no native build step, so it is easier to install on Render, Railway and Windows.
3. **Retries are implemented in our own code (`Reminder.attempt`), not with BullMQ's `attempts` option.** This keeps the Redis and no-Redis modes identical and keeps the retry state visible in MongoDB. BullMQ provides the repeatable tick job and the per-send jobs.
4. **`MessageTemplate` stores only firm overrides.** The default templates live in `packages/shared/src/templates.ts`, so they are versioned with the code; this replaces the spec's `firmId = null` rows.
5. **New collections:** `UploadLink`, `MessageLog` (per-message cost log), `Notification` (in-app alerts) and `CustomRule`. New `ComplianceTask` fields: `periodKey`, `fiscalYear`, `holidayFlag`, `docsReceivedAt`. New `Reminder` field: `offsetDays`, plus an internal `sending` claim state.
6. **Old `.xls` files are not supported.** Users must save them as `.xlsx`. Supporting `.xls` would need SheetJS, whose npm build is outdated and has known vulnerabilities.
7. **In-app notifications use polling every 15 seconds** rather than WebSockets or SSE, which is simpler to host.

## Things to verify or watch

- **Rules and holidays.** All three rules are placeholders. `holidays` is empty, so only Saturdays are flagged. Fill in the government holiday list for each year.
- **BS library range.** `nepali-date-converter` supports BS dates up to 2090 (about AD 2034). The `bsDate` module is the only place to change when you swap libraries.
- **SMS gateway.** `HttpSmsProvider` POSTs form fields `token/from/to/text`, which matches Sparrow SMS. For other gateways, change the field names with the `SMS_FIELD_*` variables. Test it with a real account before going live. Sender IDs must be approved by the NTA or the gateway.
- **Phone validation** accepts only mobiles starting with 98 or 97. NTC, Ncell and SmartCell numbers all match, but landlines are rejected.
- **iPhone HEIC photos.** If the browser can't decode a HEIC photo for compression, the original HEIC is uploaded and the server rejects it. Android cameras produce JPEG. The camera button asks for `image/*`, and most iPhones convert to JPEG on upload.
- **Message costs** are estimates. Set `SMS_COST_PER_SEGMENT_NPR` to your gateway's actual rate.

## Hosting on Supabase + GitHub Pages (no server to run)

The web app can run as a static site on GitHub Pages, with Supabase handling the database, logins, file storage and reminder sending. The Express API in `apps/api` is not used in this setup.

| Part | How it works |
|---|---|
| Database + tenancy | Postgres tables with Row Level Security (`supabase/schema.sql`). Each user sees only their firm's rows, and staff see only their assigned clients. |
| Logins | Supabase Auth with email and password. Staff are invited by email in Settings, then sign up themselves. |
| Client uploads | Private Storage bucket `documents` (10 MB limit, JPG/PNG/PDF only). Anonymous uploads are allowed only into the folder of a valid upload link. |
| Task generation | Runs in the accountant's browser using the shared rules engine (`apps/web/src/supabase/backend.ts`), whenever the Today or Tasks page is opened. |
| Reminders | `dispatch_reminders()` runs every minute via `pg_cron`. It handles quiet hours, auto-stop and retries. The console provider only logs messages; SMS uses a Sparrow-style gateway through `pg_net`. |
| Hosting | `.github/workflows/pages.yml` builds the app to `/` and the sample-data demo to `/demo/` on the `gh-pages` branch. |

Setup (about 10 minutes):

1. **Create the project.** Go to supabase.com → New project. Pick the Mumbai or Singapore region (closest to Nepal).
2. **Create the database.** In the SQL Editor, paste all of `supabase/schema.sql` and click **Run**. If it reports that pg_cron isn't available, enable **pg_cron** and **pg_net** under Database → Extensions, then run the last block again.
3. **Allow logins from the site.**
   - Authentication → URL Configuration: set Site URL to `https://<user>.github.io/<repo>/`.
   - Optional, for quick testing: Authentication → Providers → Email → turn off **Confirm email**.
4. **Connect the app.** Copy the **Project URL** and the **anon public key** from Project Settings → API into `apps/web/.env.pages`. Both are safe to commit. Alternatively, set them as repository *variables* named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. **Turn on GitHub Pages.** In GitHub, go to Settings → Pages → Build and deployment. Set Source to **Deploy from a branch**, Branch to **gh-pages**, folder **/ (root)**, then click **Save**.
6. **Deploy.** Push to `main` or the working branch. The site appears at `https://<user>.github.io/<repo>/`.

Tests for the SQL itself run with `pnpm --filter @karsathi/supabase-tests test`. They run the real schema on PGlite (Postgres compiled to WASM) and check RLS isolation, staff scoping, the upload flow, the dispatcher and quiet hours.

Limits compared with the Express API:
- File types are checked by their first bytes in the browser, but Storage only enforces the declared type and size.
- Tasks for new periods are created when someone in the firm opens the app. Missed-marking and reminders run in the database without anyone logged in.
- Zip download and firm logo upload are not built yet.

## Deploy (Express API version)

Recommended setup: the web app on **Vercel**, with `/api/*` rewritten to the API. This makes the app and API the same origin, so the session cookie stays first-party (`SameSite=Lax`).

1. **MongoDB Atlas.** Create a cluster and copy the SRV URL into `MONGO_URL`.
2. **Upstash Redis.** Create a database and copy its `rediss://…` URL into `REDIS_URL`.
3. **Cloudflare R2.** Create a private bucket and an API token. Set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Keep the bucket private; documents are served only through 5-minute presigned URLs.
4. **API on Render or Railway.**
   - Root: repo root
   - Build: `pnpm install --frozen-lockfile && pnpm --filter @karsathi/api build`
   - Start: `pnpm --filter @karsathi/api start`
   - Health check: `/api/health`
   - Env: everything in `.env.example`, with `NODE_ENV=production`, `COOKIE_SECURE=true`, new random secrets, `WEB_URL=https://your-app.vercel.app` (or a short custom domain; links appear in SMS), `API_PUBLIC_URL=https://your-app.vercel.app` and `CORS_ORIGINS=https://your-app.vercel.app`.
   - Run a single instance for the scheduler. If you add more web instances, set `SCHEDULER_ENABLED=false` on them. Duplicate workers are safe anyway, because reminders are claimed atomically.
5. **Web on Vercel.**
   - Root directory: `apps/web`
   - Framework: Vite
   - Install command: `cd ../.. && pnpm install --frozen-lockfile`
   - Build command: `pnpm build`
   - Output directory: `dist`
   - Edit `apps/web/vercel.json` and replace `YOUR-API-HOST` with your Render/Railway host.
6. Seed a demo if you want one: `MONGO_URL=… node apps/api/dist/scripts/seed.js`.

## Later (designed for, not built)

- **Payments (Khalti / eSewa).** `Firm.plan` already has `tier`, `status`, `monthlyMessageQuota`, `currentPeriodEnd`, `paymentProvider` and `externalCustomerId`.
- **Viber.** Add a `ViberProvider` implementation in `services/messaging`.
