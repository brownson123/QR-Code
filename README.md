# Passline

QR check-in for club events. Accepted applicants get a personal QR pass by email. Volunteers scan it at the door, at meals, at workshops and at any other checkpoint. Organizers watch live counts and export attendance.

- **How it's supposed to behave:** [SPEC.md](SPEC.md)
- **How to work on it with Claude Code:** [CLAUDE.md](CLAUDE.md)
- **Going live:** [docs/launch-checklist.md](docs/launch-checklist.md)

---

## Finding your way around

Everything is scoped to one **event**, identified by its slug in the URL (`demo`, `test-2026`, …).

| Page | Who | What it's for |
|------|-----|---------------|
| `/login` | Staff | Sign in with your email. You get a one-time link (locally it lands in the mail catcher, see below). First sign-in asks for a display name. |
| `/admin/<slug>` | Organizers | The event's control panel (tabs below). |
| `/scan/<slug>` | Organizers + volunteers | The scanner. Also reachable from the admin tabs ("Scanner ↗"). |
| `/p#<token>` | Participants | Their pass: name, event, QR code, optional photo upload. They get this link in their email. |

**Switching events:** there's no event picker yet. Change the slug in the address bar, e.g. `/admin/demo` ↔ `/admin/test-2026`. After signing in you may land on the plain home page; type the `/admin/<slug>` or `/scan/<slug>` address from there.

### Admin tabs (`/admin/<slug>`)

| Tab | Use it to |
|-----|-----------|
| **Dashboard** | See live check-ins, meals served, session attendance, the arrival chart and email status (pending/failed). It warns you if the event starts soon and the Door is still closed. |
| **Participants** | Search people. Resend a pass (their old QR stops working), revoke a pass, add a walk-in, mark someone as test data, delete someone, view or void their scans. |
| **Checkpoints** | Add the Door, meals, workshops and custom stations (raffle, swag). **Open** a checkpoint before scanning there; new ones start closed. Set capacity and whether a door check-in is required. |
| **Staff** | Invite volunteers and organizers by email; remove them. Removal takes effect on their very next scan. |
| **Sync** | "Sync now": compare the Google Sheet with the app, preview the changes, then apply. Needs the Google service account (see the launch checklist). |
| **Export** | Download CSVs of participants, scans and per-checkpoint totals. |

### The scanner (`/scan/<slug>`)

1. Pick the checkpoint. The coloured banner at the top always shows where you are; switching asks you to confirm.
2. Point the camera at a pass. Results:
   - 🟢 **Green (ADMIT / SERVE / RECORDED):** let them through. It clears by itself.
   - 🟠 **Amber:** needs action, e.g. *old code* (ask for their newest email), *not checked in yet* (send them to the Door), *checkpoint closed*, *no result* (network hiccup: rescan, don't admit yet). Tap to dismiss.
   - 🔴 **Red:** stop, e.g. *already scanned* (with who and when; compare the photo), *pass cancelled*, *not accepted*, *wrong event*, *full*, *unknown code*. Tap to dismiss.
3. **Manual search:** for a broken screen or a lost email. Search by name (accents optional: `zoe` finds Zoë) and record the scan.
4. **Undo:** you can void your own scan for 2 minutes; give a reason. Organizers can void any scan from the Participants tab.
5. **OFFLINE banner:** no connection, so scanning is disabled. Use the printed roster (see the launch checklist) until it's back.

### How a pass gets to someone

Google Form → Google Sheet → an organizer sets **Status = Accepted** → the Sheet notifies the app (`Sync Status` shows `PASS_QUEUED`) → the app emails the pass → the participant shows the QR at the Door.

Setting someone to Withdrawn or Rejected cancels their pass. Clearing an accepted status on purpose does nothing (`IGNORED_CLEAR`), so an accidental delete can't cancel a pass.

---

## Running it locally

**Prerequisites:** Node 22, pnpm 10, Docker Desktop (running), and the Supabase CLI.

```bash
pnpm install
supabase start

# Create .env.local with the local keys and two fresh secrets (overwrites an existing .env.local)
eval "$(supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
cat > .env.local <<EOF
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SHEET_INGEST_SECRET=$(openssl rand -hex 32)
DRAIN_SECRET=$(openssl rand -hex 32)
EMAIL_PROVIDER=console
EOF

pnpm db:reset                      # empty database with all migrations
pnpm event:create --slug test-2026 --name "Test Event" --venue "Home" \
  --starts 2026-10-01T09:00 --ends 2026-10-01T18:00 --organizer you@example.com
pnpm seed                          # optional: "demo" event, 50 accepted people, 4 open checkpoints
pnpm dev                           # http://localhost:3000
```

**Signing in locally:** every sign-in email goes to the local mail catcher (Mailpit, usually `http://127.0.0.1:54324`; `supabase status` shows the exact URL), not a real inbox. Sign in with:
- the `--organizer` email you gave `event:create` (organizer of that event), or
- `organizer@example.test` / `volunteer@example.test`, which `pnpm seed` invites to the demo event.

Use a private window for a second account.

### Where passes end up locally

With `EMAIL_PROVIDER=console`, nothing is really emailed:

| What | Where |
|------|-------|
| The full pass email | `.mail/*.eml`. Double-click to open it in Apple Mail. |
| **The QR image alone** | **`.mail/qr/<Event>-<First>.png`**, e.g. `Test-Event-Ada.png` |
| QR images for the seeded demo people | `.seed/Demo-Hack-Day-<First>.png` |

Files are never overwritten. A second person with the same first name, or a resent pass, gets `-2`, `-3`, and so on. **The highest number is the newest code**; after a resend, the older file is how you test the "old code" screen. `pnpm clean:dev` deletes `.mail/` and `.seed/`.

### Scanning locally

Use your **laptop's webcam** as the scanner (`localhost:3000/scan/<slug>`) and show the QR images from your phone. Phones can't sign in to the local app: the login page and scanner talk to Supabase at `127.0.0.1`, which on a phone means the phone itself. Checkpoints start closed, so open the Door on the Checkpoints tab first.

---

## Connecting a Google Form

The Sheet talks to the app through `apps-script/Code.gs`. `apps-script/Setup.gs` automates the setup. In the Sheet, open **Extensions → Apps Script**, paste in both files, fill in `CONFIG` at the top of `Setup.gs`, then run one of:

| Function | When |
|----------|------|
| `setupTestForm` | Starting fresh: run it from a new, empty Google Sheet. It creates a form with the right questions, links it, adds the extra columns and a Status dropdown, sets the script properties, and installs both triggers. The execution log prints the form link. |
| `connectExistingSheet` | You already have a form and Sheet: sets the script properties and installs the triggers. |
| `backfillApplicantIds` | Your existing Sheet has responses from before the script was installed. Run once. |
| `updateEndpoint` | You're pointing the Sheet at a different app URL, e.g. moving from your tunnel to Vercel. |

For a Sheet to connect:

1. **The form is linked to the Sheet,** and the responses tab is named `Form Responses 1` (or change `SHEET_NAME` in `Code.gs`).
2. **Row-1 headers match `HEADERS` in `Code.gs` exactly:**
   - Required: `Email Address`, `First Name`, `Applicant ID`, `Status`, `Sync Status`.
   - Optional: `Last Name`, `Dietary Restrictions`, `LinkedIn URL`.

   If your questions are worded differently, edit the values in `HEADERS` rather than renaming columns. Google's built-in "Collect email addresses" setting already produces `Email Address`.
3. **Status** is Accepted, Waitlisted, Rejected or Withdrawn. Blank means undecided.
4. **Script properties:** `ENDPOINT` (app URL + `/api/ingest/sheet`), `EVENT_SLUG` (an event that exists), and `INGEST_SECRET` (the same value as `SHEET_INGEST_SECRET` in that app's env).
5. **Both installable triggers exist** (On form submit, On edit), created by an account that keeps edit access. Use the club's account for real events.
6. **One event per Sheet.**

A college Google Workspace account may block Apps Script from contacting outside servers (every sync shows `ERROR`). If so, use the club's personal Google account.

---

## A tunnel URL that never changes

Google's servers need a public HTTPS address to reach your laptop. Cloudflare "quick tunnels" change URL on every restart. **Tailscale Funnel** gives you a free URL that stays the same (`https://<your-mac>.<your-tailnet>.ts.net`), with no domain to buy and no warning page.

**One-time setup**

1. Install the Tailscale Mac app (`brew install --cask tailscale`, or from tailscale.com/download) and sign in.
2. In the Tailscale admin console, turn on **MagicDNS** and **HTTPS certificates**. The first time you run Funnel, the CLI prints a link to approve Funnel for this Mac.
3. Start it in the background:
   ```bash
   tailscale funnel --bg 3000
   tailscale funnel status        # shows your https://….ts.net URL
   ```
   It stays on until you turn it off, and the URL survives restarts.
4. Set the Sheet's `ENDPOINT` to `https://<your-mac>.<your-tailnet>.ts.net/api/ingest/sheet`. This is a one-time step now.
5. To open pass pages on your phone through it, add the host to `.env.local`, then restart `pnpm dev`:
   ```bash
   DEV_PUBLIC_HOST=<your-mac>.<your-tailnet>.ts.net
   ```

**Turn it off** when you're not testing: `tailscale funnel reset`. While Funnel is on, your dev server is reachable from the internet. Staff pages still require sign-in and the Sheet endpoint requires the signed secret, but there's no reason to leave it open.

Keep `NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000`. QR codes then match the laptop scanner, and the tunnel is only used for the Sheet and for viewing pass pages on your phone.

**Alternatives:**
- **ngrok's free static domain** is also stable. It puts a warning page in front of browser visits, which is fine for the Sheet but annoying on your phone.
- **Once the club owns a domain** (you'll need one for Resend anyway), a named Cloudflare tunnel on something like `dev.yourclub.ca` is the permanent version of this setup.

---

## Tests

| Command | Runs |
|---------|------|
| `pnpm check` | Typecheck, lint, unit tests, integration tests (needs `supabase start`) |
| `pnpm test:unit` | Fast, no database |
| `pnpm test:int` | Against the local database |
| `pnpm test:e2e` | Playwright browser tests |

Test names start with the SPEC ID they cover (e.g. `T-SCAN-11`), so you can look up what each one is supposed to prove.
