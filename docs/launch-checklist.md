# Passline launch checklist

Code for every slice in SPEC §18 is done and tested locally. What's left is **setup that only you can do** (accounts, domains, the production deploy) and the **manual tests** from SPEC §14 that need real phones, inboxes and a real Sheet. Work top to bottom. Each box names the SPEC test it satisfies.

---

## 1. Production setup (one time)

### Supabase (production project)
- [ ] Create the project in the region closest to Toronto (§17 A9), e.g. `ca-central-1` or `us-east-1`.
- [ ] Apply the migrations from your machine: `supabase link --project-ref <ref>` then `supabase db push`. This creates every table, function, grant and the private `photos` bucket.
- [ ] Auth → URL configuration: set Site URL to `https://<your-domain>` and add `https://<your-domain>/auth/callback**` to the redirect URLs.
- [ ] Auth → SMTP: **set up custom SMTP** (e.g. Resend's SMTP). Supabase's built-in mailer only sends a few emails per hour, which isn't enough for volunteers signing in on event day.
- [ ] Copy the project URL, anon key and service-role key for the Vercel env.

### Resend (pass emails)
- [ ] Add and verify your sending domain. **SPF and DKIM must pass** (check "Show original" in Gmail).
- [ ] **Turn off open and click tracking** (§12). Tracking rewrites the `/p#token` link.
- [ ] Create an API key.

### Vercel
- [ ] Import the repo. Set the function region to match Supabase (§15).
- [ ] Environment variables (SPEC §19):
      `NEXT_PUBLIC_APP_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
      `SHEET_INGEST_SECRET` and `DRAIN_SECRET` (`openssl rand -hex 32` each), `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`,
      `EMAIL_FROM`, and optionally `GOOGLE_SERVICE_ACCOUNT_JSON` for Sync now.
- [ ] Deploy, then open `https://<your-domain>/login` to confirm it loads.

### Scheduler (outbox drain every minute, retention daily)
In the Supabase SQL editor, enable `pg_cron` and `pg_net` (Database → Extensions), then run the following. Replace `<origin>` and `<DRAIN_SECRET>` with your values; store the secret in Vault if you prefer:

```sql
select cron.schedule('passline-drain', '* * * * *', $$
  select net.http_post(url := '<origin>/api/email/drain',
                       headers := jsonb_build_object('Authorization', 'Bearer <DRAIN_SECRET>'))
$$);
select cron.schedule('passline-retention', '17 4 * * *', $$
  select net.http_post(url := '<origin>/api/retention',
                       headers := jsonb_build_object('Authorization', 'Bearer <DRAIN_SECRET>'))
$$);
```
- [ ] After a minute, `select * from cron.job_run_details order by start_time desc limit 5;` shows successful runs.

### Your event
- [ ] Create it with production env vars loaded in your shell:
      `pnpm event:create --slug <slug> --name "<name>" --venue "<venue>" --starts 2026-10-03T09:00 --ends 2026-10-03T18:00 --organizer <you@club.org>`
- [ ] Sign in at `/login` with that email and set your display name. `/admin/<slug>` should open.
- [ ] Add checkpoints (meals, sessions, custom) on the Checkpoints tab. They start closed.

### Google Sheet + Apps Script (SPEC Appendix A)
- [ ] Add the columns `Applicant ID`, `Status` (with data validation) and `Sync Status`.
- [ ] Paste `apps-script/Code.gs`, set the script properties `ENDPOINT=<origin>/api/ingest/sheet`, `EVENT_SLUG` and `INGEST_SECRET` (= `SHEET_INGEST_SECRET`), and add the two installable triggers.
- [ ] For Sync now: share the Sheet (view only) with the service-account email, then link it on `/admin/<slug>/sync`.

---

## 2. Manual tests (on the production or preview deployment)

### Sheet bridge: T-GAS (on a **copy** of the real Sheet)
- [ ] 01 Submit the form → `Applicant ID` is filled with a UUID.
- [ ] 02 Set one Status to Accepted → `PASS_QUEUED <time>`; the email arrives within 5 min.
- [ ] 03 Paste Accepted into 30 rows → one POST; 30 Sync Status cells filled.
- [ ] 04 Edit a non-Status column → no POST.  05 Edit the header row → no POST.
- [ ] 06 Sort by name, then change a Status → the right person changes.
- [ ] 07 Insert a column left of Status → still works.
- [ ] 08 Point `ENDPOINT` at a dead URL → `ERROR …`; restore it; Sync now reconciles.
- [ ] 09 Clear an accepted Status → `IGNORED_CLEAR`.

### Email: T-MAIL-12
Check each of Gmail web, Gmail iOS in **dark mode**, Apple Mail, Outlook web and the college email:
- [ ] The email lands in the inbox, not spam.  - [ ] The QR scans straight off the screen.

### Pass page: T-PASS-10
- [ ] On a real iPhone, add a photo from the library (a HEIC original) → the upload succeeds.

### Device matrix: T-DEV / T-SCUI-13 (target ≥ 95% of scans under 3 s)
Scanners: iPhone Safari (current iOS and one version back) and Android Chrome (a recent phone and an old or cheap one).
Codes: email at 100% brightness, at 30%, a screenshot, a printed code, a code with about 10% taped over, Gmail iOS dark mode.
Conditions: bright window light and a dim room. Record pass/fail and time for each combination.

### Load: T-PERF-01
- [ ] Target: `/api/scan` p95 < 700 ms with 0 errors for 5 scanners, 300 scans in 10 min, 500 participants.
      Locally, `pnpm load-test --minutes 10` measures this against your dev server. Running it against a preview needs a **staging** Supabase project; the harness refuses non-local targets so it can't seed production by accident.

---

## 3. Dry run → user testing (SPEC §16, T − 7 days)
- [ ] 10 club members as participants with `is_test` on: the full flow from Sheet → email → pass page → door → lunch → session.
- [ ] Every volunteer signs in on their own phone and does a test scan.
- [ ] Afterwards, check the dashboard counts, export the CSVs, and void or clean up the test scans.
- [ ] Print the accepted roster as the paper fallback.
