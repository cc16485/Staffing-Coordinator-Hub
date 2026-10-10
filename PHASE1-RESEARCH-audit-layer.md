# P1 · The audit layer as it exists today (read-only inventory, 2026-10-10)

Repos read: `/tmp/p0/Staffing-Coordinator-Hub` (server), `/tmp/p0/cc-hub-live` (browser), `/tmp/p0/team-hub` (Owners Hub admin page). The op_events DDL is not in any repo; it lives in the Desktop installer `~/Desktop/159 - The Event Record.command` (run 2026-09-18, the day commit 9691eae / da60dfd added the emitters).

---

## 1. `op_events` (the append-only record)

**DDL** `~/Desktop/159 - The Event Record.command:74-105`

| column | type | default |
|---|---|---|
| id | bigint generated always as identity | primary key |
| at | timestamptz not null | now() |
| actor_email | text not null | '' |
| actor_name | text not null | '' |
| verb | text not null | (none) |
| item_id | text not null | '' |
| area | text not null | '' |
| summary | text not null | '' |
| data | jsonb not null | '{}' |

- Index: `op_events_at_idx on (at desc)` only (line 85). No index on item_id, verb or actor.
- No CHECK on verb, no FK, no length cap in the DB (the writers slice summary to 400 chars themselves).
- RLS enabled (line 87). Policies (92-97): `op_events_insert_auth` FOR INSERT TO authenticated WITH CHECK (true); `op_events_select_auth` FOR SELECT TO authenticated USING (true). Deliberately **no update/delete policy**.
- Grants (101-105): revoke all from anon and public; revoke update, delete, truncate from authenticated; `grant select, insert to authenticated`; `grant all to service_role`.
- No append-only trigger (unlike axiscare_change_log / client_journey_event / contact_optout, which have `before update or delete ... raise exception` guards). service_role can therefore update/delete/truncate it.
- Seed row: verb `record_started`, actor 'system' (159:141-143).
- Who may insert: **any signed-in staff account from the browser** (any verb, any actor_email string: the actor is self-reported by the page, not derived from the JWT); **every edge function** via the service key.
- Who may read: any signed-in account, every row. anon: nothing.
- Only one later installer touches it: `163 - Routing Reality.command:210-214` reads verb counts (diagnostic).

---

## 2. Writers of `op_events`

### 2a. Browser

**`opEvent(verb, o)`** `cc-hub-live/index.html:25777-25792`
- Fire-and-forget: `sb.from('op_events').insert({...}).then(...)`, never awaited, errors only `console.warn('[op_events] not recorded')`.
- Actor: `ccActor()` (`index.html:7255-7262`) = `{ email: ME.email lowercased, name: ME.name || email local part, person_id }`; ME is set by `resolveMe()` from `sb.auth.getSession()` + `coordinator_staff`. `person_id` is NOT written to op_events.
- Row: `actor_email, actor_name, verb, item_id: o.item_id || o.item.id, area: o.area || o.item.domain, summary (sliced 400), data: o.data || {}`.
- Comment block 25770-25776: "a RECORD, not a mechanism: nothing operational reads it to decide anything".

**`persist()` auto-audit** `index.html:7391-7440`. Lines 7407-7416: when `key==='op_routing'` or `key==='duty_windows'`, emits `opEvent('config_changed', { item_id, area, summary })` before the `upsert_app_data_item` rpc. Those are the ONLY two keys auto-audited; every other `persist()` is silent. Note persist refuses `candidates` (7394) and routes `caregivers` to `ccCaregiverPut` → `app_data_items_apply` (7442-7470), neither of which emits an op_event.

**Distinct verbs written from the browser** (counts = call sites)

| verb | sites | where |
|---|---|---|
| item_resolved | 4 + 2 | index.html 26661, 26686, 27519, 33436; end-shift.js:128; shift-flags.js:115 |
| item_created | 1 + 2 | index.html:33601 (opsAdd); projects.js:503; team-builder-2.js:125 |
| item_claimed | 1 + 2 cond. | 27464; 25825 and 26622 (`before ? 'item_taken_over' : 'item_claimed'`) |
| item_taken_over | 2 cond. | 25825, 26622 |
| item_released | 2 | 25843, 27469 |
| item_assigned / item_transferred / item_unassigned | 2 cond. | 26245, 33357 (`it.owner ? (was==='nobody' ? 'item_assigned' : 'item_transferred') : 'item_unassigned'`) |
| item_waiting | 1 | 27214 |
| item_escalated | 1 | 27492 |
| help_asked | 1 | 27482 |
| item_note | 1 | phone-mode.js:233 |
| config_changed | 2 | 7411 (persist), 10742 |
| setting_changed | 1 + 3 | index.html:14334; team-hub/admin.html:494, 685, 1007 (direct inserts, area 'team'/'admin', item_id 'ops_settings') |
| captured | 1 + 1 | 25965; shift-flags.js:81 |
| lead_connected / lead_opted_out / lead_authorized | 1 each | 9346, 9377, 10157 |
| soc_ready | 1 | 16131 |
| fresh_start | 1 | 17400 |
| late_seen, late_eta, late_family, late_skip, late_arrived, late_coverage | 1 (template) | 17985 `'late_'+action` |
| applicant_review_cleared | 1 | 23144 |
| missed_note_entered | 1 | 33394 |
| coverage_opened / coverage_interest_opened | 1 cond. | 36756 |
| coverage_closed / coverage_backed_out / coverage_reopened | 1 each | 36855, 36888, 36898 |
| wave_sent | 1 | 37057 |
| follow_up_sent | 1 | 37427 |
| cov_wording_reset / cov_wording_edited | 1 each | 37488, 37513 |
| callin_plan_updated | 1 | 38213 |
| launch_complete | 1 | 40236 |
| shift_ended / handoff_seen | 1 each | end-shift.js:153, 223 |
| project_changed | 1 | projects.js:74 |
| profile_media_hidden / profile_media_shown | 1 cond. | caregiver-profile-panel.js:415 |
| profile_links_sent / profile_video_optional_told | 1 each | caregiver-profile-panel.js:787, 830 |
| profile_gate_override | 1 direct insert | caregiver-profile-panel.js:645 (awaited; if it fails the user is asked "Go ahead anyway?") |

Roughly 50 distinct browser verbs; no shared vocabulary file, each site spells its own.

### 2b. Server

**`_shared/events.ts`** `Staffing-Coordinator-Hub/supabase/functions/_shared/events.ts:13-33`: `opEvent(sb, { verb, summary, actor_name?, actor_email?, item_id?, area?, data? })`; defaults `actor_name` to **'Cara'**, `actor_email` to ''; summary sliced to 400; try/catch swallows errors ("an observer, never a dependency").

Importers (18): work-route, lead-watch, ghl-attach-doc, cc-booking, timekeeper-watch, coverage-reply, coverage-run, clockin-alert, lead-intake, lead-nurture, team-ask, coverage-watch, late-alert, kind-tell, visit-change, callin-alert, call-disposition (care-level imports client-events.ts, not events.ts).

Direct `from('op_events').insert` (bypassing events.ts):
- `_shared/routing.ts:134` verb `routing_shadow`, actor 'system' (diagnostic shadow of the routing playbook).
- `_shared/ghl-call-bridge.ts:157` verb `call_bridge`, `:164` `call_bridge_failed`. **This is the one place the record IS a dependency**: the insert is awaited and if it errors the call is refused ("Could not record the call, so nothing was changed"). Also reads op_events at `:120` as a rate limiter (`verb='call_bridge' and actor_email=me`).
- `onboarding-permissions/index.ts:88` verb `onboarding_permission_changed` (after an `app_data_save` with version check).

Server verbs by function (file:line):

| function | verbs |
|---|---|
| work-route:108 | item_escalated |
| lead-watch:127,147,233 | lead_connected / lead_attempted (cond.), item_taken_over, lead_rung |
| ghl-attach-doc:70 | prehire_doc_filed (with actor from the caller) |
| cc-booking:392 | lead_consult_booked |
| timekeeper-watch:594 | item_created |
| coverage-reply:233,289,313,345,379 | item_created x3, yes_received x2 |
| coverage-run:1558,1620 | item_created, claim_stale |
| clockin-alert:218,227,282 | coverage_opened, item_resolved, message_sent |
| lead-intake:113,232 | lead_inquiry x2 (actor_name = referral partner name on 113) |
| lead-nurture:177 | lead_reply_received |
| team-ask:186,220 | team_ask_refused, team_ask_sent (actor = caller) |
| coverage-watch:301,324,432 | coverage_held_check, coverage_opened x2 |
| late-alert:132,222,294 | message_sent, item_seen, coverage_opened (actor = caller) |
| kind-tell:109,124 | kind_tell_refused, kind_tell_sent (actor = caller) |
| visit-change:107,178 | visit_changed (data carries before/after/reason/undo_of), visit_change_refused |
| callin-alert:134,148,159,185 | coverage_claimed, coverage_closed x2, coverage_asked (actor = caller) |
| call-disposition:248,267,738 | lead_opted_out, lead_reply_received, lead_connected |
| routing.ts:134 | routing_shadow |
| ghl-call-bridge.ts:157,164 | call_bridge, call_bridge_failed |
| onboarding-permissions:88 | onboarding_permission_changed |

~30 distinct server verbs. Verb overlap with the browser: item_created, item_resolved, item_escalated, item_taken_over, coverage_opened, coverage_closed, lead_connected, lead_opted_out. Only visit-change puts a before/after in `data`.

---

## 3. The other audit-shaped stores

| store | kind | columns | writers | actor | approval | before/after | append-only guard | browser read |
|---|---|---|---|---|---|---|---|---|
| **automation_log** | app_data key (JSON array), via `upsert_app_data_item` | per-row ad hoc, typical: `id 'auto_srv_…', at, automation, ran_by:'server', ok, dry, duration_ms, rows_seen, candidates, created, summary, errors, error` (coverage-run:2362-2366, caregiver-journey:355) | ~17 functions: client-start-run:201, obligations-run:301, carematch-watch:300, promise-run:196, coverage-assign:103, timekeeper-watch:942, coverage-run:1029/1098/2362, client-status-review:270, coverage-watch:1164, axiscare-call-note.ts:104, shift-confirm:221, call-disposition:441, caregiver-journey:355, launch-evidence:310 | 'server' | no | no | none (RLS of app_data; service_role can rewrite the array) | loaded in DATA (index.html:7077, 7206); read by automation-watchdog:79-86 |
| **axiscare_change_log** | table | `id bigserial, at, kind (CHECK list, extended by supabase/slice5-approve-work.sql:25-28 to add caregiver_status, prn_team_classes), subject ('client'/'caregiver'), axiscare_client_id, axiscare_caregiver_id, outcome ('sent_confirmed','sent','refused','practice'), summary ≤200, detail ≤300, by_who, via` (axiscare-change-log.sql:20-36) | rpc `axiscare_change_record` (security definer, execute to service_role only, :46-58, :66-67) from client-convert:39, family-circles:31, care-level:23, schedule-push:27, missed-notes:96, prn-team:42, axiscare-caregiver.ts:47, axiscare-note:50, coverage-fill.ts:40, axiscare-call-note.ts:87 | `by_who` free text + `via` | no | no (summary only, "no health details") | yes: trigger raises on update/delete/truncate (:39-42) | select to authenticated gated by `can_access_data_key('leads'/'caregivers')` (:63-65). Note missed-notes:96 passes kind 'care_note', which is not in the CHECK list → the rpc returns `{outcome:'refused'}`. |
| **client_journey_event** | table | `id, journey_id uuid FK, step_key, at, actor_email not null, actor_name, kind, detail jsonb, reason, is_test` (client-journey/client-journey.sql:70-81) | client-journey/index.ts:169, caregiver-journey/index.ts:94, _shared/caregiver-journey.ts:27 (service_role only; `grant select, insert to service_role`, :105-109) | actor_email/name from caller or 'hub'/'The Hub' | kind strings (e.g. 'started','expired'; approve kinds exist in the function) | `detail` jsonb, free-form | yes: trigger `client_journey_event_keep` refuses update/delete except delete of is_test rows (:87-102) | no direct browser read; served through the journey function (index.ts:666, caregiver-journey:421); exported by caregiver-export:134 |
| **app_data_item_change** | table (trigger-fed) | `id, at, key, record_id, change ('added','removed','changed','trigger_error'), fields_changed text[], bulk_removed, actor (jwt email/sub or 'server'), role, origin, names, error` (app_data_history.sql:43-56) | trigger `app_data_item_change_capture` AFTER insert/update/delete on app_data for keys **candidates, caregivers only** (:70-129) | yes, from JWT claims + request origin | no | field NAMES only, never values (:14-18) | no trigger guard, but authenticated has select only; service_role has full DML (:133-137) | select to authenticated via `can_access_data_key(key)` (:139-140) |
| **app_data_conflict_log** | table | `id, at, key, actor, ids text[], reason ('version','conflict','gone','duplicate_id','bulk_remove_refused','bulk_remove_allowed'), detail jsonb` (safe_saves_2.sql:162-171) | `app_data_items_apply` on every refusal and on allowed bulk removes (:250, 281, 291, 333) | yes (jwt email/sub) | n/a | no | select-only for authenticated; no guard for service_role | policy `can_access_data_key(key)` (:179-180) |
| **admin_audit** | app_data key (JSON array) | `id 'aa_…', at, by (caller email), by_person, action, target, hub, result` (hub-access/index.ts:238-246) | hub-access only, via `upsert_app_data_item` (:247), swallowed on failure | yes | no | no | none | not loaded by the Hub (not in the 7206 key list); appears in Desktop "unmapped-keys.txt" |
| **identity_door_audit** | table | `id, at, op ('resolve_or_create','attach_source'), workflow, acting_staff, system, entity_type, source_id, outcome (6 values), person_id uuid, evidence, detail` (identity-door.sql:38-52) | the two identity functions `person_resolve_or_create` / `person_attach_source` (service_role execute only, :286-289), every call incl. refusals | `acting_staff` text | no | no | revoke update/delete/truncate/references/trigger from service_role; insert+select only (:55-62); authenticated: nothing | none (no browser grant) |
| **contact_send_refusal** (written by rpc `contact_send_refusal_log`) | table | `id, sender, channel ('sms','email'), address (normalised), reasons jsonb array, at` (contact-optout.sql:72-79) | `_shared/optout.ts:112` → rpc (security invoker, execute to service_role only, :122-125, :142); 26 functions import optout.ts | sender name only (no human actor) | no | no | guard trigger exists for contact_optout (:83-85); contact_send_refusal has select-only for authenticated, insert for service_role (:130-137) | policy `contact_send_refusal_read` using(true) (:139) |
| **send problems** | NOT a table: ops_items cards | `_shared/send-problems.ts:135-203` → `upsert_app_data_item('ops_items', { id 'ops_send_'+hash(sender|channel|address), kind:'send_problem', domain, status:'open', urgency, title, detail, sender, channel, address, who, what, problem (code), reasons[≤5], count, last_at, due, closed_*, created_by:'send-problems', opened_by:'send-problems' })`; overflow card `ops_send_many` after 40 open (:160-184) | every checked send (`ghlSendChecked`, :206) | none | no | no | none (ops_items array) | yes, as Needs Attention cards; `work-route` skips `ops_send_*` ids (work-route:60) |

Summary of the gap: five different storage styles (append-only tables with guard triggers, trigger-fed table, JSON arrays inside app_data, cards). Only op_events and client_journey_event carry both an actor name and email; only visit_changed events and client_journey_event.detail carry before/after; no store records an approval.

---

## 4. The app_data write doors

The deployed bodies of `upsert_app_data_item` and `delete_app_data_item` are not in any repo as SQL; they are quoted from live `pg_get_functiondef` in `~/Desktop/one-door-security-proof.txt:32-66` (2026-09-20) and `~/Desktop/app-data-hardening-report.txt:103-125` (2026-08-12). The newest DDL that touches app_data saving is `Staffing-Coordinator-Hub/safe_saves_2.sql` (421) and `people_lock.sql` (442, 2026-10-04).

| function | file:line | security | version check | history/event row | notes |
|---|---|---|---|---|---|
| `upsert_app_data_item(target_key text, item jsonb)` | one-door-security-proof.txt:33-66 (identical in SCRIPT-216-REPORT.txt:15-47) | **INVOKER**, owner postgres, language plpgsql | none; last write wins on the whole array (`jsonb_set` at the found index or append) | none itself; the app_data triggers fire (version bump; item_change capture only for candidates/caregivers) | requires non-empty `item.id`; inserts an empty row for a new key; browser (authenticated) and service_role both call it. The RLS policy "Hub-scoped read/write" (cmd ALL, `auth.role()='authenticated' and can_access_data_key(key)`) is what gates it for browsers (one-door proof :70-76). |
| `delete_app_data_item(target_key text, item_id text)` | app-data-hardening-report.txt:103-121 | **INVOKER** (confirmed by `35 - Harden app_data.command:150`) | none | none | filters the array with `elem->>'id' != item_id`; relies on the caller's direct UPDATE privilege. |
| `app_data_save(p_key, p_data, p_expected_version)` | safe_saves_2.sql:341-379 | **INVOKER**; requires role 'authenticated' (so edge functions using the service key cannot call it unless they pass a user JWT; onboarding-permissions:84 does call it); refuses candidates/caregivers; `can_access_data_key` | yes: `p_expected_version` must equal `app_data.version` else `{ok:false, reason:'version', data: current}` | none | whole-value save for non-people keys. |
| `app_data_items_apply(p_key, p_changes, p_expected)` | safe_saves_2.sql:183-339 | **DEFINER** (needed because people_lock's restrictive policies block authenticated direct writes), requires jwt role 'authenticated', keys limited to candidates/caregivers, `can_access_data_key` | per-record `base_rev` vs `_rev` (:271-274) and optional whole-list `p_expected.version` (:244-249); `select … for update` with 3s lock_timeout | writes `app_data_conflict_log` on refusals (:250, 281, 291) and on allowed bulk removes (:333); the app_data triggers then write `app_data_item_change` | ops: put / remove / add / allow_bulk_remove; refuses >2 removes without allow_bulk; stamps `_rev` via `app_data_version_bump` trigger (:93-117). |
| trigger `app_data_version_bump` | safe_saves_2.sql:93-117 | DEFINER | n/a | bumps `app_data.version` on every data change; stamps `_rev` for candidates/caregivers | fires for ALL keys, so `upsert_app_data_item` also bumps version (but never checks it). |
| policies `app_data_people_lock_{ins,upd,del}` | people_lock.sql:17-22 | RESTRICTIVE, to authenticated + anon | n/a | n/a | refuse any direct insert/update/delete of keys candidates/caregivers from a signed-in page, which also blocks `upsert_app_data_item` for those keys (it runs as the caller). Server (service_role) unaffected. |

Grants (safe_saves_2.sql:382-388): `app_data_items_apply` and `app_data_save` execute → authenticated only (revoked from public/anon); helper functions revoked from authenticated.

Net: the door most of the Hub and ~40 edge functions use (`upsert_app_data_item`) has no version check, no actor capture, no event row, and runs as the caller; concurrency safety and history exist only for candidates/caregivers.

---

## 5. `ops_items` (work items)

**Where**: app_data key `'ops_items'` (one JSON array). Browser: `DATA.ops_items` (index.html:7077), saved per item through `persist('ops_items', it)` → `upsert_app_data_item`. Server: `read('ops_items')` then `upsert_app_data_item` on the newest copy (work-route:24-27, 100-105). Open-tab refresh `ccOpsRefresh()` (index.html:26055-26074) re-reads the array when nothing local is ahead.

**Item shape** (fields observed; nothing enforces them):

| field | set by | meaning |
|---|---|---|
| id | `'ops_'+Date.now().toString(36)` (opsAdd:33596); server ids like `ops_tk_<id>`, `ops_late_<id>`, `ops_send_<hash>`, `ops_famcall_<case>` | |
| kind | opsAdd select; server kinds e.g. send_problem, family_call, staffing, new_lead, missed_call, discipline | |
| domain | server/browser; feeds routing/escalation (`opsDomainEscalation(it.domain)`, 27474) | op_events `area` defaults to it |
| title, detail, about | | |
| status | 'open' / 'done' (the two statuses the queues test: `.status==='open'` 56 sites, `'done'` 17); send-problems also treats 'resolved' as closed (:149) | |
| sub_state | 'working' / 'waiting' / 'escalated' / null (26-ish sites) | claim/parked/escalated |
| urgency | 'urgent' / 'today' / 'normal' | |
| due, created_at, started_at, last_activity_at | | |
| owner, owner_name | responsibility (25805-25810 comment: "owner = whose RESPONSIBILITY; claimed_by = who is actively handling it RIGHT NOW") | |
| claimed_by, claimed_by_name, claimed_at | opsClaim 25811-25834 / opsRelease 25836-25845 / working toggle 27461-27470 | |
| owner_history[] (≤30) | `opsOwnerHistory` 26590-26594 `{at, by (email), by_name, from, from_name, to, to_name, how ('took','assigned','handed','unassigned','routed'), note}`; work-route:69-71 appends `how:'routed', by:'cara'` | |
| routed | work-route:74 `{seat:'staffing', person, source, at}` | |
| escalation | work-route:88 `{to, to_name, seat:'owner_escalation', level ('urgent'/'overdue'), why, at, cleared_at?, cleared_why ('taken'/'no longer due')}`; browser 'needs_samantha' instead reassigns owner + sub_state 'escalated' (27488-27492) | |
| waiting_on, check_back | 27210-27212 | parked with a wake-up |
| help_from, help_asked_at | 27478-27479 | ask without moving ownership |
| history[] | `opsLog(it, text)` 25764-25768 `{at, by: ME.name||ME.email, text}` (name-first, the pattern ccActor's comment warns against) | the item's own narrative |
| closed_at, closed_by (email), close_note, triage_state, resolution_code | 27514-27516, 26660, 26684 | |
| resolved_at, resolved_by | 35 / 1 mentions; send-problems reads `resolved_at` | not set by the browser close paths above |
| seen_at, ack_at | not ops_items fields (they belong to applications/interviews rows) | no seen/ack on work items |
| created_by | opsAdd: `ME.name` (name, not email!) 33599; server: function name ('send-problems', 'loops') or 'cara'. `routable()` (duty.ts:85-86) decides "made by a job" by `!created_by.includes('@')`, so a browser-made item with a name-only created_by also counts as job-made. | |
| opened_by | 'person' / function name | |
| source | `{type:'status_review'|'returning'|'journey', …ids}` on server-made items (26857-26880) | link back to the originating record |
| case_id / coverage_case_id, phone, problem, count, sender, channel, address, reasons | per-kind extras | |

**Browser `opsAdd()`** `index.html:33577-33615`: builds the item (status 'open', created_by = ME.name, opened_by 'person'), pushes to DATA, `opEvent('item_created', {item, summary: about||title + ' — raised, for owner_name'})` at 33601, then `await persist('ops_items', it)`. (Event is emitted before the save and even if the save later fails.)

**State transitions and their events** (browser): claim → item_claimed / item_taken_over (25825, 26622, 27464); release → item_released (25843, 27469); working toggle → claim/release events (27461-27470); wait → item_waiting (27214); ask_help → help_asked (27482); needs_samantha → item_escalated (27492); triage close → item_resolved (27519); coverage answers → item_resolved (26661, 26686); assign/transfer → item_assigned / item_transferred / item_unassigned (26245, 33357). All of these ALSO append `history[]` via opsLog, so the same fact is written twice in two shapes.

**Server `work-route`** `supabase/functions/work-route/index.ts` (every 2 min, flag `ops_settings.routing_live`): routes open job-made staffing items (`routable()` duty.ts:79-87) to the Staffing seat (writes owner, owner_name, owner_history 'routed', history line, `routed`), escalates to the Owner Escalation seat (writes `escalation` + history line), clears stale escalations; per-item `upsert_app_data_item` on the freshest copy (:100-105) and one `opEvent('item_escalated')` per new escalation (:108). Routing itself emits NO op_event (only the item's history line). Heartbeat to app_data `automation_heartbeats` (:112-114).

**Server-side ops_items writers** (39 files; `op_event_calls` = any opEvent/op_events insert anywhere in that file, not necessarily tied to the item write): cg-connect.ts, intake-import.ts, orient-remind.ts, routing.ts(1 ev), send-problems.ts(3 writes, 0 ev), assessment-intake(2,0), bg-review(2,0), call-disposition(10,3), call-followup(1,0), campaign-auto(1,0), care-notes(4,0), caregiver-journey(2,0), client-journey/care.ts(1,0), client-journey/index.ts(5,0), client-start-run(1,0), client-status-review(2,0), clockin-alert(1,3), coverage-reply(4,5), coverage-run(4,2), coverage-watch(9,3), eligibility-sweep(1,0), ghe-reminders(1,0), issues-run(2,0), late-alert(1,3), late-watch(2,0), lead-followup(2,0), lead-intake(1,2), lead-nurture(1,1), lead-watch(5,3), medicaid-visits(2,0), missed-notes(2,0), obligations-run(2,0), ops-escalate(2,0), promise-run(2,0), reference-chase(1,0), references-run(1,0), review-moments(1,0), timekeeper-watch(6,1), work-route(1,1). So 25 of 39 server writers of ops_items never emit an op_event; `item_created` on the server is emitted only by timekeeper-watch, coverage-reply (x3) and coverage-run.

---

## 6. How humans read `op_events` back

| reader | file:line | what | filters |
|---|---|---|---|
| **Since You Left** (`ccSinceFetch` → `renderSinceYouLeft`) | index.html:25983-26016, 26189-26224 | rows with `at > localStorage cc_seen_<email>`, ascending, limit 200; shown inside the Dashboard "Updates & While You Were Out" card (#sylSlot, 10493-10495) as `time · actor_name · summary`; last 30 shown; `item_escalated` rows collapsed to one line per escalatee ("Cara · escalated N items to X") | drops `CC_SINCE_NOISE = ['routing_shadow','record_started']` (25992) and the viewer's own rows (26005). "Seen" stamp moves only on real pointer/key activity (26022-26028); "mark as seen" link clears the list. |
| **Recent movement** (`ccRecentFetch` / `ccRecentFor`) | index.html:26039-26052 | last 24h, `at,verb,item_id`, newest per item_id, limit 200; feeds the "no movement Xm" chip on claimed cards and Being-Handled freshness on Today | none (any verb counts as movement, incl. diagnostics) |
| call-bridge limiter | _shared/ghl-call-bridge.ts:120 | counts `call_bridge` rows for the caller (server) | verb = call_bridge |
| Desktop 163 | `163 - Routing Reality.command:210-218` | counts of lead_* verbs (diagnostic) | |

There is **no per-item or per-person history/ledger/timeline view** of op_events in the Hub: item history shown on cards comes from `it.history[]` and `opsOwnerTrail(it.owner_history)` (26596-26606), not from op_events. op_events is read only as "since you left" (team-wide, verb-agnostic) and as a freshness signal. The phone pages (`phone_needs_me_look.py`, `phone_end_shift_look.py`) reference op_events only in tests. The Owners Hub admin page writes `setting_changed` rows but does not read them.
