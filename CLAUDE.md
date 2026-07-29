# Caring Companions Staffing Hub — Claude Code Context

## What This Is
A single-page internal operations hub for **Caring Companions In-Home Senior Care** (Springfield, MO).
Deployed at **sc.mo-care.com** via GitHub Pages — repo **cc16485/Staffing-Coordinator-Hub** (hub.mo-care.com is the separate team-hub landing page; cc.mo-care.com is the care-coordinator hub).
Primary file: `index.html` (~7,300 lines). All functionality is in this one file — no build step, no framework.

✅ **This folder IS the live source.** It is a git clone of cc16485/Staffing-Coordinator-Hub;
pushing to `main` deploys to sc.mo-care.com via GitHub Pages. Edit here, commit, push.

⚠️ There is an old folder `~/Claude/Projects/Caring Companions Onboarding/` that used to be
primary. It is ARCHIVED as of 2026-07-29 and is ~1,900 lines behind. Never copy from it.

**Company info:**
- Address: 1331 N Stewart Ave Ste B, Springfield MO 65802
- Phone: (417) 234-8494
- Website: mo-care.com (GitHub Pages; DNS on Cloudflare. It was on GoHighLevel once — corrected 2026-07-28)
- Email: samantha@mo-care.com

---

## Files in This Project

| File | Purpose |
|------|---------|
| `index.html` | Main hub — all 6 tabs, all JS, all CSS |
| `evv-correction-form.html` | Public caregiver form at sc.mo-care.com/evv-correction-form |
| `orientation-booking.html` | Candidate-facing orientation booking page (writes to `orient_bookings` as anon) |
| `supabase-setup.sql` | Full Supabase schema setup — run once in SQL Editor (kept current) |
| `fix-evv-permissions.sql` | Fixes "permission denied" on evv_submissions — adds GRANTs |
| `fix-scheduling-and-bookings.sql` | **RUN THIS** — adds client_queue checklist columns + creates orient_bookings |
| `supabase-edge-function/` | `axiscare-client-webhook` + `axiscare-push-note` (not yet deployed) |
| `Compliance_Hub.html` | Legacy compliance page (superseded by index.html) |

---

## Tech Stack

- **No framework** — vanilla JS, CSS variables, Poppins font
- **Supabase** for persistent storage + auth
  - URL: `https://zngsgedlsxinbygwmxwn.supabase.co`
  - Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZ3NnZWRsc3hpbmJ5Z3dteHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDIzNDQsImV4cCI6MjA5ODExODM0NH0.L_31_UKdccyRH9n7p1GaBlZTqcJipB008H-GIvxwLxM`
  - Auth: `sb.auth.signInWithPassword({ email, password })` — real Supabase users
  - The hub runs as `authenticated`; the two public pages run as `anon` (INSERT-only)
- **Google APIs** — Calendar + Drive via GIS token client (`google_client_id` in Settings)
- **AxisCare API** — site 16485, token `axc_eTXo41PuHg5MHNnaxw34WM2WVBJvN0sC` (used by edge functions via env secrets)
- **Zapier webhooks** — stored in `appSettings`, sent via `zapFire()` (one hardcoded: `ZAPIER_AC_STATUS_WEBHOOK`)
- **localStorage** — fallback/cache; Supabase wins on load

---

## Supabase Tables

### `app_data` (key-value store; authenticated only)
Keys actually used by the code:
- `candidates` — JSON array of candidate objects
- `caregivers` — JSON array of caregiver objects
- `orient_sessions` — JSON array of orientation session objects (bookings live inside each session)
- `settings` — the `appSettings` object (webhook URLs, Google client ID, orient_config, staff_users…)
- `evv_corrections` — the manually-logged EVV correction log

### `evv_submissions`
Public EVV form submissions. `anon`: INSERT only (never `.select()` after `.insert()`). `authenticated`: SELECT/UPDATE/DELETE.

### `client_queue`
New clients needing schedule setup. Checklist fields: `caregiver_assigned`, `caregiver_called`, `client_called`, `schedule_added` + matching `*_at` timestamps, `caregiver_call_notes`, `client_call_notes`, `axiscare_note_id`. Requires `fix-scheduling-and-bookings.sql` to have been run.

### `orient_bookings`
Self-serve bookings from orientation-booking.html. `anon`: INSERT only. The hub's `mergePendingBookings()` (runs on login and when opening the Orientations tab) merges unmerged rows into the matching session's `bookings` array and sets `merged=true`.

---

## Brand Colors (CSS Variables)

```css
--navy: #0E3860   --yellow: #FFC671   --teal: #54BDB8
--bg: #F6F9FD     --border: #E2E8F0   --gray: #6B7280
```

---

## Key Functions & Patterns

```javascript
syncToSupabase(key, data)   // upsert into app_data; flips sync badge to "Local only" on failure
loadFromSupabase()          // loads all app_data keys on login
zapFire(settingsKey, payload, json=false)  // skips blank/REPLACE/non-http URLs silently
getOrientConfig()           // appSettings.orient_config with defaults (schedule, duration, capacity…)
getOrientDuration()         // parseFloat(orient_config.duration) || 2
switchTab(name, btn)        // name = 'onboarding'|'orientations'|'training'|'compliance'|'scheduling'|'evv'
obDeriveStatus(c)           // 'Ready for Orientation' | 'Needs Review' | 'Awaiting'
trainStatus(c)              // orientation/ALZ pre-contact, 30-day OJT clock, annual training status
mergePendingBookings()      // pulls orient_bookings rows into orientSessions
```

Tab bar order (matters for `nth-child` lookups in renderAlerts):
1 Background & References (`onboarding`) · 2 Orientations (`orientations`) · 3 Training (`training`) · 4 Active Compliance (`compliance`) · 5 Scheduling (`scheduling`) · 6 EVV Corrections (`evv`). Panel IDs are `panel-<name>`.

---

## Candidate Object Shape (actual)
```javascript
{
  id: number,                    // obId counter
  first, last, phone, email, oos: 'yes'|'no'|'',
  addedAt: ISO string, resolvedAt, resolvedStatus,
  // References ×4: r1n (name), r1s ('Pending'|'Positive'|'Conditional'|'Negative'),
  //   r1_phone, r1_email, r1_proof, r1_manual {staff,via,date,...}
  oig: 'Pending'|'CLEAR'|'FLAGGED', oig_date, oig_proof,
  edl: 'Pending'|'Clear'|'Issues Found', edl_date, edl_proof,
  fcsr: same as edl, fcsr_date, fcsr_proof,
  fp: 'N/A'|'Required'|'Submitted'|'Clear'|'Issues Found', fp_date, fp_proof,
  invite_sent: bool, invite_sent_date,
  orient_outcome: 'attended'|'noshow'|'rescheduled'|'canceled'|null, orient_session_date,
  not_hired: bool, not_hired_reason, not_hired_notes, not_hired_date,
  notes
}
```

## Caregiver Object Shape (actual)
```javascript
{
  id: number, first, last, hire_date, oos, axiscare_id,
  orient_date, orient_proof, alz_date, alz_hrs, alz_proof,   // pre-contact training
  first_contact,
  ojt_date, ojt_signed, ojt_proof, ojt_online, ojt_online_proof,
  annual_date, annual_hrs, annual_proof,
  ethics_date/_proof, rights_date/_proof,
  oig_date, oig_status, oig_proof,      // recurring checks (90d)
  edl_date, edl_status, edl_proof,      // 90d
  fcsr_reg_date, fcsr_date, fcsr_status, fcsr_proof,  // annual + 15-day registration
  fp, fp_date, fp_proof,
  supv_date/_proof, perf_date/_proof    // annual
}
```

Bookings inside a session: `{ first, last, phone, candidate_id, booked_at, attend_status, cancel_method, cancel_reason, src_id }` — the outcome field is **`attend_status`**, not `outcome`.

---

## What's Built and Working
- Login with Supabase auth; session auto-restore
- Candidate pipeline (B&R tab) — add/edit (incl. email), live OIG API check + batch check, references (incl. staff-recorded manual refs), Not Moving Forward + reactivate, processing stats
- Orientations — settings-driven session generator, recurring sessions, ready queue, booking links, attendance marking, promote-to-caregiver, Google Calendar sync
- Self-serve booking page → `orient_bookings` table → auto-merged into sessions
- Training + Active Compliance tabs, bulk check marking, CSV import/export
- Scheduling tab — client queue checklist (needs `fix-scheduling-and-bookings.sql` run once), staffing SOPs
- EVV Corrections tab — pending Supabase submissions (Accept & Log / Dismiss), manual log, monthly volume monitor
- Public EVV form — original + corrected times, tasks, signatures (DPI-correct), honeypot
- Alerts strip under the header (renderAlerts)
- Settings modal (admin-passcode gated) — webhooks, Google IDs, staff users/notifications

## What's In Progress / Pending
- ~~GoHighLevel API key~~ ✅ DONE Jul 5 — GHL_API_KEY + GHL_LOCATION_ID (Recp0AhyMh8lrtKJ9kaj) secrets set; end-to-end SMS test succeeded. Candidate texting is LIVE (invites, booking confirmations, courtesy notices).
- **Register the AxisCare client.created webhook** to point at `https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/axiscare-client-webhook` (fills the Scheduling queue automatically)
- `zapier_attend_webhook` / `zapier_cand_webhook` / `ac_orient_webhook` still use zapFire (optional; silently skipped if unset). Zapier is NOT needed for candidate texting anymore — that goes through send-candidate-message.
- Viventium onboarding trigger; PDF generation

## July 5, 2026 — security incident + resolution (context for future sessions)
- The Supabase project **zngsgedlsxinbygwmxwn is SHARED by three hubs** (this one, team-hub, care-coordinator-hub) — they all read/write the same `app_data` table. Policy/schema changes made in one hub's cowork session affect all three.
- Debug-era policies ("allow_all_anon", "anon_all") had given anonymous visitors full access to app_data; combined with a hub flaw that saved empty arrays before login, the live candidates/caregivers keys got wiped. Fixed: anon now has ZERO privileges on app_data (verified); hub code refuses to sync while logged out (`syncToSupabase` session guard).
- Caregivers restored from `caregivers_import.csv` (56 records, names + hire dates only — compliance dates after Jun 27 need re-entry). Candidates were test data.
- `recover.html` (in this folder, not deployed) restores browser-localStorage backups to empty app_data keys — redeploy temporarily if ever needed.
- Edge functions deployed Jul 5: `axiscare-client-webhook` (no JWT — external caller), `axiscare-push-note`, `send-candidate-message` (both JWT-on). AXISCARE_API_KEY/AXISCARE_SITE secrets set.
- service_role table grants had been stripped — re-granted ALL on all public tables (edge functions need this).

## Fixed July 4, 2026 (manual-build review)
- EVV form crashed on submit (missing orig-time fields) — fields added
- EVV "Accept & Log" button broken (JSON-in-onclick quoting) — now id + cache lookup
- Scheduling checklist saves failed silently on missing columns — SQL + error alerts added
- Booking page wrote to app_data as anon (blocked by RLS) — now `orient_bookings` + merge
- Google Calendar events were 5–6h late (UTC vs America/Chicago) — local wall-clock now
- Alerts strip element was missing; CSV Import modal couldn't close; signature pad clipped on phones; profile read wrong outcome field; WellSky→AxisCare wording

---

## Important Gotchas

1. **anon vs authenticated**: public pages have INSERT-only on their tables. Never `.select()` after `.insert()` from them — it hangs/fails.
2. **GRANT vs RLS**: Supabase needs BOTH. See fix-evv-permissions.sql / fix-scheduling-and-bookings.sql.
3. **`zapFire()` silently no-ops** on blank/placeholder URLs. The invite modal now warns before marking "Invited" if the webhook isn't configured.
4. **appSettings is stored under app_data key `settings`** (not `app_settings`); orientation sessions under `orient_sessions` (not `orientations`).
5. **Single file, no build.** Deploy = commit and push this repo; GitHub Pages publishes it.
6. **Client-queue writes must not add new columns** without also adding them in SQL — a missing column fails the whole UPDATE (the hub now alerts when that happens).
7. **Bookings live inside `orientSessions[n].bookings`** (app_data blob); `orient_bookings` is only an inbox that gets merged and flagged `merged=true`.
