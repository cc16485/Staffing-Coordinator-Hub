# P1: Browser writes, work-item path, actor, origin labels, routing, counts

Read-only inventory, 2026-10-10. Repos: /tmp/p0/cc-hub-live (browser), /tmp/p0/Staffing-Coordinator-Hub/supabase/functions (server). All line numbers are from those copies.

## 1. Shared browser write helpers

### persist(key, item)  — index.html:7391
- Signature: `async function persist(key, item)`; `item.id` required (refuses loudly at 7400-7404; the RPC finds the row by `item.id`).
- Refuses `key==='candidates'` (7394) and redirects `key==='caregivers'` to `ccCaregiverPut(item)` (7393).
- RPC: `sb.rpc('upsert_app_data_item', { target_key: key, item })` (7419). Semantics (test stub, Staffing-Coordinator-Hub/client_journey_484_test.py:86-87): remove the array element whose `id` matches, append `item`. Whole-item replace, last writer wins.
- Version handling: none. No `_rev`, no `p_expected_version`. A stale page's copy of an item overwrites a newer one.
- Who/when/what: nothing is stamped by persist itself. The only audit is a side effect for two keys (7408-7416): `key==='op_routing'||'duty_windows'` -> `opEvent('config_changed', {item_id, area, summary})`. Every other key is unaudited by this helper; callers stamp fields ad hoc (see 2, 3).
- Failure: `syncClassify` -> `queuePendingSync(key,item)` (localStorage retry queue) + `syncRecordError` + pill text (7422-7428). Retry via `flushPendingSync()`.

### ccCaregiverPut(g)  — index.html:7442
- RPC: `app_data_items_apply({ p_key:'caregivers', p_changes:[{ op:'put', id, base_rev:Number(g._rev)||0, record:g }] })` (7447-7448).
- Conflict: `res.reason==='conflict'` -> reload list + alert "Someone else changed ... redo your last change" (7470-7473). `_rev` adopted from `res.revs` (7458).
- Audit: none in the browser; the SQL function logs refusals to `app_data_conflict_log` (safe_saves_2.sql:162-179, 250) with `actor` from JWT claims (safe_saves_2.sql:197-200).

### removeItem(key, itemId)  — index.html:7477
- RPC: `delete_app_data_item({ target_key:key, item_id:itemId })` (7481). No version, no audit, no opEvent. Failure only changes pill text (7485).

### ccMergeSave(key, apply)  — index.html:14319
- Read `app_data.data, version` for key -> clone -> `apply(merged, base)` returns changed-field labels -> `sb.rpc('app_data_save', { p_key, p_data:merged, p_expected_version })` (14327). Up to 5 retries on version mismatch (14320-14330). A failed read saves nothing (14322).
- Returns `{ changed, error, data }`. No audit itself.

### tkMerge(apply, what)  — index.html:14332
- Wraps `ccMergeSave('ops_settings', apply)`; on success `opEvent('setting_changed', { item_id:'ops_settings', area:'coverage', summary: ccActor().name+' changed '+what+': '+changed.join(', ') })` (14334). This is the ONLY settings path that audits, and only when called through tkMerge.

### saveSharedConfig()  — index.html:7052
- Direct table write: `sb.from('app_data').upsert({ key: CC_CFG_KEY, data: shared, updated_at }, { onConflict:'key' })` (7057-7058). Whole-blob overwrite of `CC_SHARED_SETTINGS` keys from the page's CONFIG. No version, no actor, no opEvent. Returns boolean only.

### syncToSupabase(key, data)  — caregivers-engine.js:4128
- Guards: SAFE_KEYS ('candidates','caregivers') blocked (4130); not HYDRATED -> blocked (4136-4140); no session -> skipped (4145-4146).
- Routes WHOLE_KEYS (`settings`, `orient_sessions`, `eod_reports`, `evv_corrections`, 4098) to `wholeSave`; any other key is BLOCKED (4150). So the engine saves nothing whole except those four.

### wholeSave(key, data)  — caregivers-engine.js:4098
- Requires a snapshot from load (`WHOLE_SNAP[key]`, 4101) else BLOCKED.
- `settings`: field-level merge, re-read + `app_data_save(p_expected_version=row.version)` with 5 retries (4105-4117).
- Lists: single `app_data_save(p_key, p_data, p_expected_version: snap.version)` (4121); on version refusal adopts the server copy and tells the person to redo (4126-4129).
- No actor stamp, no opEvent.

### saveCandidates(opts) / saveCaregivers(opts)  — caregivers-engine.js:4234 / 4279
- Both: localStorage first, then `safeSave(key, opts)` (4056) -> `safeRun` (3974) -> `sb.rpc('app_data_items_apply', { p_key, p_changes })` (4000) where changes are per-person `put/add/remove` diffs with `base_rev` (safeDiff). RPC refusals: `conflict` (reload + names), `duplicate_id`, `bulk_remove` (4029-4050). Server-side: safe_saves_2.sql:183 (security definer, requires role 'authenticated', 197-200; refusals logged to app_data_conflict_log).
- `saveCandidates` returns `r.ok===true`; `saveCaregivers` returns a promise of the same. Banner `bgrSharedSaveResult` on failure. No opEvent.

### attPersist(key,item)  — caregivers-engine.js:2751
- `sb.rpc('upsert_app_data_item', { target_key:key, item })`; alert on error and rethrow. Caller `logAttEvent` (2755) stamps `logged_by: email.split('@')[0]`, `created_at`. No version, no opEvent.

### mtgPersist(m)  — caregivers-engine.js:3346
- `upsert_app_data_item` on `target_key:'meetings'`. `requestMeeting` (3350) stamps `requested_by_name/email/role`, `status:'requested'`, `created_at`. No version, no opEvent.

### creqPersist(item)  — caregivers-engine.js:3669
- `upsert_app_data_item` on `target_key:'staffing_tasks'`. No version, no opEvent.

### persistStaff(s)  — caregivers-engine.js:9424 (listed for completeness; not read in depth).

### Direct bypass of persist for ops_items in the engine
- caregivers-engine.js:2160: `sb.rpc('upsert_app_data_item', { target_key:'ops_items', item:{ ... created_by:'reference check', opened_by:'system' } })` (2172). Skips persist() and its pending-sync queue.

### Summary table
| Helper | File:line | RPC / table | Version check | Actor/when stamped by helper | Audit (op_events) | Conflict handling |
|---|---|---|---|---|---|---|
| persist | index.html:7391 | upsert_app_data_item | none | none | only op_routing / duty_windows (config_changed) | last writer wins; errors queued locally |
| ccCaregiverPut | index.html:7442 | app_data_items_apply | per-record base_rev | none (SQL logs JWT actor on refusal) | none | reload + alert |
| removeItem | index.html:7477 | delete_app_data_item | none | none | none | pill text only |
| ccMergeSave | index.html:14319 | app_data_save | p_expected_version, 5 retries | none | none | re-read + reapply |
| tkMerge | index.html:14332 | via ccMergeSave | same | name in summary | setting_changed | same |
| saveSharedConfig | index.html:7052 | app_data.upsert (table) | none | updated_at only | none | overwrite |
| syncToSupabase | caregivers-engine.js:4128 | -> wholeSave or BLOCKED | n/a | none | none | n/a |
| wholeSave | caregivers-engine.js:4098 | app_data_save | snapshot version | none | none | adopt server copy, redo |
| saveCandidates/saveCaregivers | caregivers-engine.js:4234/4279 | app_data_items_apply | per-record base_rev | none | none | conflict/dup/bulk notices |
| attPersist/mtgPersist/creqPersist | caregivers-engine.js:2751/3346/3669 | upsert_app_data_item | none | caller stamps logged_by / requested_by_* | none | alert + throw |

## 2. The work-item path (ops_items)

### Creation
- `opsAdd()` index.html:33577. Fields set (33596-33600): `id:'ops_'+Date.now().toString(36)`, `kind`, `title`, `detail`, `about`, `urgency`, `status:'open'`, `created_at`, `due` (opsDueFromChoice 31060), `owner`, `owner_name`, `created_by: ME.name||ME.email` (name first, ambiguous), `opened_by:'person'`. Writes `opEvent('item_created', {item, summary})` (33602) then `persist('ops_items', it)` (33603).
- `ccCaptureSave()` index.html:25949 (Capture sticky note). Fields (25959-25963): same shape plus `kind:'capture'`, `source:'capture'`, `created_by:a.name`, `created_by_email:a.email`, `opened_by:'person'`. `opEvent('captured')` (25965) then persist.
- `covOutcome` index.html:26666-26668 creates a `family_call` item with `opened_by:'loops'`, `created_by:a.email`, plus `opsOwnerHistory`.
- projects.js:457: `opened_by:'person'`, `created_by:a.email`, `created_by_email`.
- shift-flags.js:79: `created_by:a.name, created_by_email:a.email, opened_by:'person'`.
- caregivers-engine.js:2172: `created_by:'reference check', opened_by:'system'` (direct RPC, see 1).
- obligations.js:465: `opened_by:'system', created_by:'automation:'+src.key`.
- promise-engine.js:174/192: `opened_by:'system', created_by: PRODUCER`.
- referral-desk.js:228: `created_by:'partner desk', opened_by:'partner desk'`.
- caregivers-engine.js team-builder: `created_by:'team-builder'`.
- index.html:36708 / 36753: `opened_by: ME.name||ME.email` (a person's NAME in opened_by; inconsistent with the 'person' convention).
- Browser automation feeders (index.html:25377, 27852, 29982, 33032, 33285): `opened_by:'system'`.

### Desk / stand-up ways
- desk.js:723-737 `followUp(id)`: opens `ccCaptureOpen()` and watches for a new `kind:'capture'` item whose `created_by_email` is me; links the desk line to it. The desk itself (`DK.lines`) is personal and saved through `kind_word_decide`/desk RPCs, not ops_items.
- standup-board.js: `suCreate` (284-295) writes key `standup_notes` (SU_KEY, line 28) with `reported_by/_email`, `created_by`, `status:'open'`, `resolved`, `rev`; `suMutate` increments `rev` and appends `history[{at,by,by_email,what}]` (275-283) but has NO server-side version check (persist -> upsert_app_data_item). `noteOnCard` (152-156) appends `opsLog` to an ops item. Prepare Stand-Up (810-823) calls `opsSetOwner` and `persist('ops_items')` for due/notes. `tmMutate`/team_meetings (TM_KEY) same pattern (300-308, 712, 841). `source:'manual'` / `'prepare'` on meeting records (700, 841).

### Transitions (all end in `persist('ops_items', it)`; all append `opsLog` history unless noted)
| Function | Line | Fields changed | op_events verb |
|---|---|---|---|
| opsClaim(id) | 25811 | `claimed_by/_name/_at`; clears `escalation.cleared_at/why='taken'`; `owner` if empty; `sub_state='working'`, `started_at` | item_claimed / item_taken_over |
| opsRelease(id) | 25836 | clears claimed_*; `sub_state=null` if working | item_released |
| opsSetOwner(id,email,name,note) | 26226 | `owner`, `owner_name`; clears mismatched claim; `owner_history[{at,by,by_name,from,from_name,to,to_name,how:'assigned'|'handed'|'unassigned',note}]` | item_assigned / item_transferred / item_unassigned |
| opsSetDomain(id,code) | 26253 | `domain`; owner from domain if none | none |
| opsTakeIt(id) | 26609 | owner+claim in one; `owner_history how:'took'`; clears escalation; also updates lead `assigned_coordinator` + `comm_log` for `new_lead` items (26626-26632) | item_claimed / item_taken_over |
| opsTriage(id,what,quiet) | 27445 | `waiting`: `sub_state` toggle, clears `waiting_on`,`check_back`; `working`: `sub_state`, `started_at`, claim/release (+item_claimed/item_released); `ask_help`: `help_from`,`help_asked_at` (help_asked); `help_done`; `needs_samantha`: owner=domain escalation, `sub_state='escalated'` (item_escalated); `needs_doing`: `triage_state='needs_doing'`, owner=front door; close reasons `already_handled|duplicate|informational|stale`: `status='done'`, `triage_state`, `resolution_code`, `closed_at`, `closed_by=ME.email`, `close_note` (item_resolved). Also `reviewMaybeCreate` after done. | as listed |
| opsAssign(id,val) | 33348 | owner from coordinator_staff; clears claim | item_assigned / item_transferred / item_unassigned |
| opsCloseCommit(it,note,outcome) | 33424 | `outcome`, `status='done'`, `closed_at`, `closed_by=ME.email`, `close_note`; backfills `claimed_by/_name/_at` from closer | item_resolved; then reviewMaybeCreate |
| opsClose(id) | 33398 | UI popover -> opsCloseCommit; projects go to pjClose, journeys to the link | |
| mnEnter | 33375-33393 | `status='done'`, `closed_*`, `close_note` after missed-notes edge function | missed_note_entered (not item_resolved) |
| covOutcome / famCallDone | 26636 / 26677 | `status='done'`, `closed_at/by`, `close_note` + coverage_cases edits | item_resolved |
| Phone Done | phone-mode.js:225-228 | re-reads ops_items (`fresh()`, 178-182), refuses if `status!=='open'` (192), then `opsCloseCommit(x, note, null)`; Take -> `opsTakeIt`; Note -> opsLog + `opEvent('item_note')` + persist (231-236) | item_resolved / item_note |

### Lifecycle vocabulary found
- `status`: `'open'`, `'done'` (browser). Server late-alert also sets `'seen'` on its own notice record (late-alert/index.ts:220), not on ops_items. No `'resolved'`, `'snoozed'`, `'dismissed'` status on ops_items; "Resolved (server)" vs "Done (person)" is a stated distinction (index.html:26502-26510) but both use `status='done'` plus `closed_by`/`resolved_*` fields.
- `sub_state`: `'working'`, `'waiting'`, `'escalated'`, `null`.
- `triage_state`: `'needs_doing'`, or the close reason. `resolution_code`: `already_handled|duplicate|informational|stale`.
- Parked = `sub_state==='waiting' && check_back` in the future (`opsParked` 26513; server `parked` duty.ts:76).
- Claim: `claimed_by`, `claimed_by_name`, `claimed_at`; `started_at`.
- Owner: `owner`, `owner_name`, `owner_history[]` (how: `took|assigned|handed|unassigned|routed`), `routed{seat,person,source,at}` (server work-route:72).
- Help: `help_from`, `help_asked_at`.
- Escalation object (server-written, work-route/index.ts:88; lead-watch:230): `escalation{ to, to_name, seat:'owner_escalation', level:'urgent'|'overdue', why, at, cleared_at, cleared_why:'taken'|'no longer due' }`. Browser reads it (26563, 26790, 26960) and clears it on claim/take.
- Close: `closed_at`, `closed_by` (email), `close_note`, `outcome`.
- Seen: no `seen_at` on ops_items. `seen_at` exists on `hire_intake` rows (engine 2262, 4822) and on handoffs (`hlSeen` index.html:7921 sets `x.seen=true`; end-shift `ack_at/ack_by`, end-shift.js:149, 221). Server verb `item_seen` exists only in late-alert (222).
- Snooze: none. Closest are `check_back` (wake-up date) and `missed_clockin_paused_until` on calls (17949).
- Version: ops_items carry no `_rev`; every write is whole-item replace via upsert_app_data_item. `history[]` entries `{at, by:(ME.name||ME.email), text}` (opsLog 25764) and `last_activity_at`.
- Visibility: `sensitive` + `opsCanSee` (33240) using `created_by_email||created_by`.
- `urgency` browser: `urgent|today|normal|high|critical`; server adds `low`. OPS_URGENCY map (31045) knows only urgent/today/normal; `critical` bucketed at 30754.
- `kind`: full OPS_KINDS list at index.html:30982-31043 (missed_call, review, recurring, new_lead, discipline, request, client_issue, staffing_issue, capture, project, journey, pause_followup, sympathy, review_ask, partner_week, review_followup, ghe_unbooked, ghe_missed, visit_risk, visit_review, respite_limit, care_note, missed_note, late_notice, send_problem, offer_declined, offer_unsigned, offer_delivery, requirement_expired, oig_match_review, final_approval, axiscare_active_failed, hire_date_check, promise_update, promise_lapsed, journey_review, coverage_outcome, family_call, evv_review, evv_fix). Server also uses `coverage`, `staffing` (duty.ts:20).

## 3. Actor identity

- `let ME = { email:'', name:'', shift:'day' }` index.html:7080. Filled by `resolveMe()` 7263: email from `sb.auth.getSession()` (7265), name from `coordinator_staff` match or `navUserFirst` or email local part (7269), shift hard-coded manager for samantha@/zach@ (7270). Operating-layer fields (person_id) added later, not awaited (7284+).
- `ccActor()` index.html:7255: `{ email (lowercased), name, person_id }`. Comment says it is "THE one way new code answers which human did this" and warns against the legacy `by: ME.name||ME.email` pattern, which `opsLog` (25766), `opsAdd.created_by` (33599), `rtSave.updated_by` (36287), `opsCloseCommit.closed_by` (ME.email) still use.
- Engine side: `window._myEmail` caregivers-engine.js:4156; `logAttEvent` reads session email directly (2760).
- `opEvent(verb, o)` index.html:25777: inserts into `op_events` `{ actor_email:a.email, actor_name:a.name, verb, item_id, area, summary(400), data }` with `sb.from('op_events').insert(...)` using the signed-in client. Fire-and-forget, never awaited (25786-25788). Any browser code can write any actor_email string; the values come from the page, not the token.
- Could the server learn the same from the JWT? Yes. `_shared/staff-auth.ts:35-69 requireStaff()` resolves `admin.auth.getUser(jwt)` -> `auth_identities` -> `persons.full_name` -> `entity_memberships` -> `staff_roles`, returning `{person_id, name, email, roles}`. `app_data_items_apply` already reads `request.jwt.claims` for the actor it logs (safe_saves_2.sql:197-200). `upsert_app_data_item` (as stubbed) reads nothing from the JWT. No op_events DDL or RLS policy exists in either repo (only test stubs: ed_project_476_test.py:38, step0_refresh_proof.py:12), so whether `actor_email` is enforced against `auth.email()` cannot be confirmed from source; the browser insert path implies the authenticated role has INSERT.
- Server-side opEvent `_shared/events.ts:13-33`: defaults `actor_name:'Cara'`, `actor_email:''`. Routing shadow uses `actor_name:'system'` (routing.ts:134). Staff-initiated edge functions stamp `me.email`/`who.email` (onboarding-permissions:88, ghl-call-bridge:157, late-alert:222).

## 4. Origin / "AI noticed" vocabulary

- No single `source` field distinguishes machine from human. The browser infers it with a regex on two fields (index.html:10451-10452): `robot=/^automation:|^(attendance|coverage|timekeeper)-watch$|^timekeeper$|-run$|-sweep$|^cara$/i` tested against `created_by` and `opened_by`. Server `routable` uses "created_by contains no '@'" as the robot test (duty.ts:85-86).
- `opened_by` values. Browser: `'person'`, `'system'`, `'loops'`, `'quick-capture'` (read at 10457, never written in this tree), `'client-start'`, `'partner desk'`, a person's name (36708/36753). Server: `'system'`(12), `'timekeeper'`(6), `'loops'`(4), `'late-watch'`(4), `'callout'`(4), `'send-problems'`, `'review-moments'`, `'missed-notes'`, `'intake-import'`, `'eligibility-sweep'`, `'client care'`, `'caregiver-connect'`, `'care-note-flag'`, `'quiet-callout'`, `'phone'`, `'orientation-remind'`, `'ongoing-sweep'`, `'offer-cards'`, `'new-clients:'`, `'journey'`, `'flagged-visit-note'`, `'client-admission-scan'`, `'caregiver-journey'`, `'cara-flag-sms'`, `'cara-flag'`, `'campaign-auto'`, `'callout-escalation'`, `'booking-calendar'`, `'bg-review'`, `'axiscare-watch'`, `'attendance-threshold'`.
- `created_by` values. Browser: person name or email, `'reference check'`, `'automation:'+key`, `PRODUCER`, `'partner desk'`, `'team-builder'`. Server: `'timekeeper-watch'`(7), `'late-watch'`, `'coverage-watch'`, `'coverage-reply'`, `'call-disposition'`, `'review-moments'`, `'coverage-run'`, `'send-problems'`, `'missed-notes'`, `'intake-import'`, `'client care'`, `'cc-booking'`, `'caregiver-connect'`, `'care-notes'`, `'timekeeper-watch (office-linked form)'`, `'the Hub (missed notes)'`, `'routing-shadow'`, `'reference chase'`, `'orientation-remind'`, `'ongoing-sweep'`, `'offer-cards'`, `'notes-watch'`, `'lead-nurture'`, `'journey'`, `'client-start'`, `'client journey'`, `'caregiver-journey'`, `'bg-review'`, `'attendance-watch'`, `'assessment-intake'`, `AUTOMATION='automation:client-status'` (client-status-review:29), `'automation:launch-evidence'` (launch-evidence:43), plus `who.email`/`by` for staff-triggered.
- `history[].by`: `'Cara'` for server routing/escalation lines (work-route:68-69, 82; lead-watch:203-231); `owner_history.by:'cara', by_name:'Cara', how:'routed'` (work-route:67).
- `source` on items: browser `'capture'`, `'desk'`, `'work'`, `'shift_flag'`, `'orientation'`, `'exception'`, `'consultation'`, `'assessment'`, `'soc_handoff'`, `'setting'`, `'default'`; `source.type==='client_checkin'` object form (30979). Server: `'axiscare'`, `'self'`, `'schedule'`, `'journey'`, `'our_ai'`, `'call_disposition'`, `'shift_note'`, `'ghl'`, `'ghl_assessment'`, `'axiscare_webhook'`, `'axiscare_clock_in'` and more (not all are ops_items).
- Card labels: `opsKindLabel` (30978) shows the KIND label only; no "AI noticed" chip exists. The only automatic-vs-office label found is on message logs: `chip(x.automatic ? 'Automatic' : 'Office button')` (24260). `opsWhyHere` (26558) explains routing in words ("automatic staffing alerts come to you", "Escalated to you (Owner Escalation)") by regex on created_by/opened_by (26585-26586).
- op_events actor convention: `actor_name:'Cara'` + `actor_email:''` means automation (events.ts:18, 25-26); `'system'` for shadow diagnostics (routing.ts:134); CC_SINCE_NOISE hides `routing_shadow`, `record_started` from the human ledger (index.html:25995).

## 5. Routing settings and the alert ladder

- `op_routing` (app_data key, one row per area): row shape `rtRow` index.html:36206-36213: `{ id:<area code>, resp[], backup[], now[], daily[], esc:'', esc_when:'', esc_minutes:null, fallback:'' }`; entries are emails or `'staffing_coordinator'` or `'duty:staffing'`/`'duty:after_hours'` (RT_CORE 36174, RT_DUTY 36186). Saved by `rtSave` (36282-36289) with `updated_at`, `updated_by: ME.name||ME.email`, via `persist('op_routing')` -> audited as `config_changed` (7408-7416). Edit gated by `ccCan('manage_settings')` (36214). Server reads it in `_shared/routing.ts` (`routeFor`, `shadowRoute` 121) for shadow logging only; `routing_live` flag in ops_settings (work-route:41).
- Separate `ops_routing` TABLE (not app_data): `opsLoadRouting` 25427 reads `ops_routing(key, person_id)`, `domains(code,label,owner_person,escalation_person,entity)`, `persons`, `staff_roles`, `staff_role_types`. Used by `opsFrontDoor` (25522), `opsDomainOwner` (25511), `opsDomainEscalation` (25515).
- `duty_windows` (app_data key): row shape index.html:14919-14922: `{ id:'dw_..', area, person, from_position, status:'live'|'planned', active, recur{days,from,to}, backup_person, assigned_by: ME.email, created_at }`; one-offs use `start`/`end`; ended rows get `ended_at`, `ended_by` (15740). Reader `dutyCoversAt`/`dutyWindowsFor` (30296-30318). Server mirror `_shared/duty.ts covers/seatHolder/onDuty` (36-66): seats `'staffing'` and `'owner_escalation'`; fallback order schedule -> `ops_settings.duty_default_<area>` -> `coverage_alert_admins[0]` -> `'samantha@mo-care.com'` (62-66).
- Shared Admin pool rule: there is no explicit pool record. "Every admin sees it" is the fallthrough when an item has no owner and no domain owner (`opsWhyHere` 26564-26566). `coverage_alert_admins` in `ops_settings` (set in tkSave 14348, default `['samantha@mo-care.com','krystal@mo-care.com']` at 14181) is the texted admin list for missed clock-ins/call-ins and the duty fallback (duty.ts:63, end-shift.js:34). `opsAttentionAudience` (26492): owner always; domain escalation person at attention level >=3; nothing else.
- 4-level alert ladder (FYI/Action/Ack-required/Critical): NOT represented anywhere in code. What exists: attention levels 0-4 by lateness (`opsAttention` 26470: due today=1, late=2, 2+ days=3, 5+ days=4); server escalation `level:'urgent'|'overdue'` (duty.ts:102-116, ESCALATE={shiftSoonMin:60, shiftSoonAfterMin:5, urgentAfterMin:15}); lead-watch `level:'manager'` -> `escalation.level:'urgent'` (lead-watch:230, lead-rules.js:836); `urgency` field (urgent/today/normal/high/critical/low); `esc_minutes` "min unacknowledged" threshold on op_routing rows (36266-36270) described as "not decided" until approved. The word "FYI" appears only as a family-message tone (13521). "Critical" only as urgency option (2569) and the owner's URGENT bucket (30753-30777). No ack-required state exists on ops_items (ack_at/ack_by are on end-of-shift handoffs only).

## 6. Call-site counts for ops_items writes

Browser (/tmp/p0/cc-hub-live):
- `persist('ops_items', ...)` literal: 49 sites. index.html 35, referral-desk.js 3, end-shift.js 2, projects.js 2, shift-flags.js 2, standup-board.js 2, medicaid-plans.js 1, phone-mode.js 1, team-builder-2.js 1.
- Direct `upsert_app_data_item` with `target_key:'ops_items'` bypassing persist: 1 (caregivers-engine.js:2160).
- No browser `app_data_save`/`app_data_items_apply`/table upsert on ops_items.
- Browser total: 50 distinct write sites. (For scale, persist() is called with 56 literal keys overall; top keys: leads 56, ops_items 49, duty_windows 13, coverage_cases 13.)

Server (/tmp/p0/Staffing-Coordinator-Hub/supabase/functions):
- `target_key: 'ops_items'` literal: 77 sites across 37 files (top: coverage-watch 9, timekeeper-watch 6, client-journey 5, coverage-run 4, coverage-reply 4, care-notes 4, _shared/send-problems 3).
- Local `put('ops_items', ...)` wrappers (not caught by the literal grep): 15 (call-disposition 10, lead-watch 5).
- Server total: 92 write sites. Any `'ops_items'` literal (reads + writes): 149 across 43 files.
- RPC usage on the server: `upsert_app_data_item` 229 calls (all keys), `app_data_save` 1, `delete_app_data_item` 1; no server use of `app_data_items_apply`. Direct `app_data` table upserts exist for logs/locks/caches only (call_followup_log, coverage_run_lock, axiscare_call_note_log, call_disposition_log, calls-feed cache, identity-backfill, evidence-write).
- Server ops_items writes stamp `created_by`/`opened_by` job names (see 4) and `history[].by:'Cara'`; op_events via `_shared/events.ts` default to Cara. `work-route` applies changes to the newest copy (work-route:97-99) but still through whole-item replace, so a browser save racing it can be lost.
