# P1 · Action-contract survey of 13 Hub edge functions

Source: `/tmp/p0/Staffing-Coordinator-Hub/supabase/functions/<fn>/index.ts` plus `_shared/` helpers, read in full on 2026-10-10. Read-only; nothing edited.

Legend used below
- **Auth**: how the caller is admitted and where the actor identity comes from.
- **Reads first**: the server-side re-read before any write.
- **Writes**: tables / RPC names (with argument names) / AxisCare endpoints / GHL sends.
- **Audit**: a dedicated log row, or "stamps on the row" (which columns).
- **Switch**: the `ops_settings` key (read from `app_data` where `key='ops_settings'`, `data` JSON).
- **Once**: idempotency / dedupe guard. **Undo**: reversal path.
- **Free text**: request fields whose text reaches a message, and whether wording is fixed in code / from ops_settings / from the request.

---

## 1. client-fact (97 lines)

| | |
|---|---|
| Auth | `requireStaff(sb, req, OFFICE_ROLES)` (owner_admin / care_coordinator / staffing_coordinator, active person + active cc_ihs membership + hub_access). Actor = `staff.email`, passed as `p_recorded_by`. Never from the body. |
| Switch | none |
| Preview / practice | none |
| Messages | none ("Nothing here contacts anyone") |
| Wording | n/a |

| Action (`body.action`) | Body fields | Reads first | Writes | Audit | Once / Undo | Response |
|---|---|---|---|---|---|---|
| `record` (required literal; anything else than the two below is 400) | `episode_id` uuid **req**; `kind` str≤80; `layer` str≤20; `value` any (null if absent); `certainty` str≤20; `change_kind` str≤20; `supersedes_fact_id` uuid or null (invalid → 400); `reason` str≤2000; `said_by` ≤200; `said_by_relationship` ≤100; `said_how` ≤40; `said_at` ISO or null (invalid → 400); `words` ≤2000; `source_ref` ≤200 | none in the function; the RPC re-reads | RPC `client_fact_record(p_episode_id, p_kind, p_layer, p_value, p_certainty, p_change_kind, p_supersedes_fact_id, p_reason, p_said_by, p_said_by_relationship, p_said_how, p_said_at, p_words, p_source_ref, p_recorded_by)` | the fact row itself carries `recorded_by`; RPC owns the ledger | RPC refuses a stale save via `supersedes_fact_id`; after care began intake facts can only be corrected (RPC rule). No undo in the function. | RPC `data` returned unchanged (200); `{error:'not recorded: …'}` 500 |
| `record_person` | `episode_id` uuid **req**; `person_key` uuid/null; `supersedes_row_id` uuid/null; `permission_asked_at` ISO/null; `is_caller` bool; `name` ≤200; `relationship` ≤100; `organization` ≤200; `roles` string[]≤10; `phone` ≤40; `email` ≤200; `reach_way` ≤10; `reach_time` ≤200; `permission` ≤20; `permission_asked_by` ≤200; `change_kind` ≤20; `reason` | none | RPC `people_on_journey_record(p_episode_id, p_person_key, p_is_caller, p_name, p_relationship, p_organization, p_roles, p_phone, p_email, p_reach_way, p_reach_time, p_permission, p_permission_asked_by, p_permission_asked_at, p_change_kind, p_supersedes_row_id, p_reason, p_recorded_by)` | `p_recorded_by` | `supersedes_row_id` in RPC | RPC data; 500 on error |
| `care_began` | `episode_id` uuid **req** | RPC `care_began_for_episode(p_episode_id)` (read-only) | none | none | n/a | RPC data; on error `{began:null, reason:'could_not_check'}` **200** |

---

## 2. call-place (44 lines)

| | |
|---|---|
| Auth | `requireStaff` OFFICE_ROLES; actor = `staff.email` → `p_by` |
| Switch / preview / messages | none |

| Action | Body fields | Reads first | Writes | Audit | Once | Response |
|---|---|---|---|---|---|---|
| (no `action` field; one verb) | `call_ids` int[] 1..20 **req**; `decision` `'lead'|'client'|'not_ours'` **req**; `lead_id` str≤100 (used only when lead); `person_id` uuid (client); `axiscare_client_id` str (client); `note` str≤300 | none; RPC checks the inquiry/client exists and each line is unmatched and unplaced | RPC `call_record_place(p_ids, p_decision, p_lead, p_person, p_axiscare_client, p_by, p_note)` | the placed call_record rows (`p_by`, `p_note`) | RPC refuses an already-placed line | RPC data; **200 only if `data.outcome==='placed'`, else 400**; 500 `{error:'Could not place the call: …'}` |

---

## 3. client-journey (798 lines)

| | |
|---|---|
| Auth | Staff actions: `requireStaff` OFFICE_ROLES, `isOwner = roles.includes('owner_admin')`. `sweep` and `adopt`: `jobCaller(req)` = `x-cron-secret` header equals `HUB_JOB_SECRET` (constant-time) OR bearer is the service-role key / a key that can read `identity_door_audit`. Actor = `who.email` / `who.name`; automation uses `{email:'hub', name:'The Hub'}` or `'The move-over (484)'`. |
| Switch | `client_journey_live`. When false: every staff action after `care_*` returns 409 for non-owners; `open` allowed only with `is_test:true`; sweep puts away real journey cards and only stamps first shifts. **`said_yes` / `undo_yes` run BEFORE the switch check** (not gated). `is_test` journeys behave as live regardless. Also read: `client_journey_routing` (payer → CC email), `client_journey_default_cc`, `client_journey_staffing_default`. |
| Preview / practice | `is_test` flag on the journey (test journeys write My Work cards even when the switch is off; the bridge to `client_queue` never runs for them). No dry-run of `apply`. |
| Messages | none |
| Audit | every change inserts `client_journey_event {journey_id, step_key, actor_email, actor_name, kind, detail(json), reason}`; step rows carry `completed_by` (email), `completed_by_name`, `completed_at`, `version` (+1 per put) |
| Reads first (all staff actions) | `client_journey_step_def` catalog, staff roles/persons (`people()`), `ops_settings`; then `load()` = the open journey for `journey_id` / `axiscare_client_id` / `lead_id` (else latest) + all `client_journey_step` rows |

| Action | Body fields | Writes | Once / Undo | Response |
|---|---|---|---|---|
| `get` | one of `journey_id`, `axiscare_client_id`, `lead_id` | none (also reads `client_journey_event` latest 300) | n/a | `{journey, steps, events, defs, ref, names, is_owner, ctx, office[{email,name,roles}]}` or `{journey:null, defs}` |
| `list` | `include_active` bool | none (reads journeys + steps, `loadQuiet`, `client_pause` open) | n/a | `{quiet[], paused[], journeys[{journey_id, ref, client_name, payer, status, stage, stage_label, target_start, assigned_cc, is_test, lead_id, axiscare_client_id, launch_id, closed_reason, next{key,title,status,why,owner,shifts,shift_words}, stopped}]}` |
| `open` | `lead_id` or `axiscare_client_id` **req one**; `payer`; `client_name`; `assigned_cc` email; `is_test` bool | `openOne`: insert `client_journey {lead_id, axiscare_client_id, client_name, payer, assigned_cc, assigned_how, created_by: who.email, is_test}`; event `created`; if payer known: upsert step `intake.payer` complete + event `completed`; then `settle()` (below) | existing journey → `{outcome:'exists', journey_id}` (no second row). CDS payer → 422 `cds`. | `{outcome:'created', journey_id, ref, stage, assigned_cc, how}` (200) / `no_name` 400 / `off` 409 / `error` 500 |
| `apply` | `step_key` **req**; `op` ∈ `complete|wait|block|unblock|reopen|not_needed|exception|assign` **req**; `expected_version` int (optional optimistic lock); `reason` str; per op: `answer{}`, `files[]` (paths under `journey_id/step_key/`), `note` ≤2000, `manual_reason` ≤500 (complete); `check_back` YYYY-MM-DD + `waiting_on` ≤200 (wait); `unblock` ≤300, `unblock_role` ∈ owner/care_coordinator/staffing_coordinator (block); `kind` ∈ R.EXCEPTION_KINDS (exception); `email` (assign) | `client_journey_step` upsert via `putStep` (version+1, `updated_at`); `client_journey_event` insert (kind = completed / confirmed_by_hand / waiting / blocked / unblocked / back_from_waiting / reopened / not_needed / owner_exception / step_assigned); `complete` may also update `client_journey.payer/payer_other`, re-route `assigned_cc` by payer (event `reassigned_cc` by HUB) and `target_start`; storage `list()` verifies each proof file exists; then `settle()` | `expected_version` mismatch → 409 `changed_meanwhile`; `complete` on a done step → 409 `already`. **Undo = `op:'reopen'`** (reason required; an owner exception only by an owner). Owner-only: `exception`, `not_needed` on a required step, reopening an exception. | `{outcome:'saved', next{key,title,status}, stage, complete, status, cards{open,wrote,closed}}`; refusals `{outcome:'refused', error}` 422/403 |
| `assign_cc` | `email` **req** (must hold an office role); `reason` | update `client_journey {assigned_cc, assigned_how:'chosen', updated_at}`; event `reassigned_cc {from,to}` reason; `settle({verify:false})` | same person → `{outcome:'same'}` | `{outcome:'assigned', cards}` |
| `set_start` | `date` YYYY-MM-DD or '' | update `client_journey.target_start`; event `target_start {from,to}`; `settle({verify:false})` | none | `{outcome:'saved'}` |
| `upload_url` | `step_key` (must be in catalog), `name` (sanitised, last 80 chars) | `storage.from('client-journey-files').createSignedUploadUrl('<journey_id>/<step_key>/<ts>-<name>')` | n/a | `{path, token, url}` |
| `file_url` | `path` (must start with `<journey_id>/`) | `createSignedUrl(path, 600)` | n/a | `{url}` |
| `refresh` | (journey locator) | `settle()` | n/a | `{outcome:'ok', changed, cards}` |
| `said_yes` | `lead_id` **req**; `is_test` | opens a journey if none; completes `intake.payer` if needed; refuses on `view.stop` or step `later`; upserts step `signed.yes` complete `{evidence:{confirmed:{by,at}}}`; event `said_yes`; lead (`app_data.leads` via RPC `upsert_app_data_item(target_key:'leads', item)`) gets `said_yes_at/by/by_name/prev_status`, status `Converted`, comm_log line; `settle()` | `lead.said_yes_at` set → 409 `already` | `{outcome:'yes', ref, journey_id, stage, live, next}` / `missing` 422 / `stopped` 422 / `refused` 422 |
| `undo_yes` | `lead_id` **req**; `reason` ≤300 | step `signed.yes` back to open, event `said_yes_undone`; lead `said_yes_*` cleared + `said_yes_undone{at,by,was_at}`, status restored, comm_log line, `converted_at` cleared if no AxisCare id | within 24h anyone in office; later owners only (403); refused (422) if a later step was completed by hand | `{outcome:'undone', status}` |
| `sweep` (job) | none | `stampFirstShifts` (AxisCare GET `/api/visits?clientIds&startDate&endDate` paged; writes `leads.first_shift_at/_source/_checked_at` + comm_log); `autoOpenClose` (opens ≤10 journeys for contacted leads; closes journeys of Lost/archived leads); `closeEnded` (role 'former' → close + complete `client_queue` launch); `pauseDue` (ops_items pause cards); `settle()` every open/active journey | n/a | `{ok, journeys, card_changes, launch_changes, care_ended, pause_due, first_shifts, opened, closed}` or `{ok, live:false, cards_put_away, first_shifts}` |
| `adopt` (job) | `people[]` ≤50 of `{lead_id?, axiscare_client_id?, payer?, client_name?}` | `openOne` per person | existing → `exists` | `{ok, adopted[{…, outcome, journey_id}]}` |
| `care_*` | delegated to `./care.ts` (`careAction`) — not in scope of this read | | | |

`settle()` (runs after every write): stamps `ready_since` on newly-ready steps; runs `VERIFY` checks for `proof:'verified'` steps (reads `app_data.leads`, AxisCare GET `/api/clients/{id}`, `/api/visits?…`) and completes them as `completed_by:'hub'` with event `verified`; stamps `leads.first_shift_at` (`first_shift_source:'journey'`) + event `first_shift_stamped`; flips `client_journey.status` to `active` + event `became_active`; `bridge()` → RPC `upsert_client_launch({p:{client_name, payer, axiscare_client_id, start_date, source:'journey', created_by:'client journey'}})` / `client_queue` complete, events `launch_linked|launch_completed|launch_failed`; `refreshCards()` → RPC `upsert_app_data_item(target_key:'ops_items', item)` one `ops_jr_<journey12>_<ownerhash>` card per owner, closes the `ops_lead_<id>` inquiry card.

---

## 4. axiscare-note (98 lines)

| | |
|---|---|
| Auth | `requireStaff` OFFICE_ROLES; actor `staff.email` → `p_by` |
| Switch / preview / once / undo | none. Every call posts a fresh note; no dedupe. |
| Audit | RPC `axiscare_change_record(p_kind, p_subject, p_client, p_caregiver, p_outcome 'sent'|'refused', p_summary '<kind words>, N characters', p_detail errText|null, p_by, p_via:'axiscare-note')` on every outcome incl. refusals. **Note text is never logged, only its length.** |
| Free text | `note` (1..6000 chars) goes to AxisCare verbatim. Wording = from the request. |

| Action | Body fields | Reads first | Writes (AxisCare) | Response |
|---|---|---|---|---|
| `client_note` | `axiscare_client_id` digits **req**; `note` **req**; `kind` `'care_plan_note'|'client_note'` (default client_note) | none | `POST https://<site>.axiscare.com/api/notes/client/{id}` `{note, important:true}` | `{outcome:'sent', recorded}` / `{outcome:'refused', detail, recorded}` |
| `caregiver_note` | `axiscare_caregiver_id` digits **req** (never a name); `note` **req** | `GET /api/caregivers/{id}` (404 or empty → refused, recorded) | `POST /api/notes/caregiver/{id}` `{note, important:true}` | `{outcome:'sent', caregiver{axiscare_id,name}, recorded}` / `{outcome:'no_such_caregiver', detail}` / `{outcome:'refused', detail, recorded}` |

---

## 5. visit-change (197 lines)

| | |
|---|---|
| Auth | `requireStaff` OFFICE_ROLES; actor `who.name` + `who.email` |
| Switch | `visit_change_live` — reads (`reasons`, `get`) always; `change`/`undo` → 409 `{outcome:'off'}` when false |
| Preview | none (the `get` answer is what the person "saw" and must be echoed back as `expect`) |
| Messages | none |
| Audit (per change/undo) | (1) RPC `upsert_app_data_item(target_key:'visit_changes', item{id, visit_id, client, client_id, at, by: who.name, by_email, reason_id, reason_name, before{caregiver_id,caregiver,date,start,end}, after{…}, confirmed, undo_of, words})`; (2) RPC `axiscare_change_record(p_kind 'visit_caregiver'|'schedule', p_subject 'client', p_client, p_caregiver, p_outcome 'sent_confirmed', p_summary, p_detail 'Reason: …', p_by: who.name||email, p_via 'Live Schedule (visit-change)')`; (3) `opEvent {verb:'visit_changed', actor_name, actor_email, item_id: visit_id, area:'scheduling', data{change_id, before, after, reason, undo_of}}`. AxisCare refusal → `opEvent visit_change_refused`. |

| Action | Body fields | Reads first | Writes (AxisCare) | Once / Undo | Response |
|---|---|---|---|---|---|
| `reasons` | none | `GET /api/visits/modification-reasons` | none | | `{live, reasons[{id,name}]}` (disabled filtered) |
| `get` | `visit_id` **req** | `GET /api/visits/{id}`; `app_data.visit_changes` | none | | `{live, visit{visit_id, client, client_id, caregiver_id, caregiver, date, start, end, started, verified, removed}, undo[{change_id, words, by, at}]}` (same-day, un-undone, still matching) |
| `change` | `visit_id` **req**; `expect{caregiver_id,date,start,end}` **req**; `set{caregiver_id?|null, date?, start?, end?}`; `reason_id` number **req**; `change_id` client-made id `/^[a-z0-9-]{8,64}$/i` **req** | visit_changes list (dedupe); reasons (must be active); `GET` visit: refused if removed / started / verified; `key4(cur) !== key4(expect)` → 409 `changed_meanwhile` | `PATCH /api/visits/{id}` `{caregiverId?, visitDate?, startTime?, endTime?, modificationReason}` (only that visit); `GET` read-back → `confirmed` | `change_id` already in list → `{outcome:'already_done'}`; `expect` is the optimistic lock | `{outcome:'changed', confirmed, change_id, before, after, words, reason, warning?}`; `off` 409, `refused` 422/409, `axiscare_refused` 422 |
| `undo` | `change_id` **req** | change row (not itself an undo, not already undone, same Chicago day); visit must still equal `change.after`; reason = active AxisCare reason matching /office error/ or /administrative/ | same PATCH with `before` values; new row `id:'u-'+change_id, undo_of`; original row gets `undone_at`, `undone_by` | `already_undone`; `too_late` 409 | same `{outcome:'changed', …}` shape |

Wording: no messages. Change reasons come from AxisCare's own list.

---

## 6. coverage-assign (108 lines)

| | |
|---|---|
| Auth | `ownerCaller(req)` (service-role bearer, or a key that can read `identity_door_audit`) → `byName="the owner's server key"`, `byEmail=''`; else `requireStaff` OFFICE_ROLES → `byName = who.name || who.email`, `byEmail`. |
| Switch | none in this function. The courtesy admin texts honour `callin_after_hours` (`textCaseAdmins anyHour:true` → emergency only if that switch allows) and office quiet hours otherwise. |
| Preview / practice | none |
| Reads first | `readCase()` = `app_data` key `coverage_cases`, item by `id` |
| Audit | RPC `upsert_app_data_item(target_key:'automation_log', item{id:'auto_srv_…', at, automation:'coverage-assign:<confirm|close|assign>', ran_by:'server', ok, dry:false, case_id, outcome, detail≤300})`; stamps on the case (`confirmed_by` = display name, `confirmed_at`, `resolved_*`, `axiscare_assignment{status, detail, visit_id, caregiver_id, verified, at, by:'coverage-assign'}`); RPC `axiscare_change_record(p_kind 'visit_caregiver', p_subject 'client', p_client, p_caregiver, p_outcome 'sent_confirmed'|'sent'|'refused', p_summary, p_detail, p_by: byName, p_via 'coverage-assign')` from `assignInAxis`. **No `op_events` row here** (callin-alert writes one for the same operations). |

| Action | Body fields | Writes | Once / Undo | Response |
|---|---|---|---|---|
| `confirm` | `case_id` **req**; `covered_by` str≤80 **req**; `not_chosen` `{silent:true}` or `{msg}` ≤400 | `confirmFill`: RPC `coverage_case_patch(p_id, p_patch{status:'done', resolved_how:'covered', covered_by, resolved_at, confirmed_by: byName, confirmed_at, reopened_from:null, not_chosen_silent/not_chosen_msg}, p_expect{status:'open'})`; then `assignInAxis`: AxisCare `GET /api/visits/{id}` (or `GET /api/visits?clientIds&startDate&endDate` when the case has no visit id; must be exactly one unassigned), `PATCH /api/visits/{id} {caregiverId}` only if the visit is the caller-off's or nobody's, `GET` read-back; `patchCase(axiscare_assignment)`; GHL SMS "Filled by <first>: … No more texts about this call-in." to other admins who got the call-in text (`textCaseAdmins`, via `textAdmin` → `contactForOutbound(urgent_internal, audience staff)` + `ghlSendChecked(sender 'staff-alert')`) | one winner via `p_expect{status:'open'}` → conflict returns `already`. No undo. | `{outcome:'filled', covered_by, axiscare{status:'assigned'|'already'|'by_hand'|'failed', detail, visit_id?, caregiver_id?, verified?}}` 200 / `{outcome:'already', status, covered_by, confirmed_by, resolved_how, at}` 200 / `not_found` 404 / `bad_request` 400 / `error` 200 |
| `close` | `case_id`; `how` ∈ `uncovered|other_way|client_cancelled` **req**; `note` ≤300 | `coverage_case_patch` `{status:'done', resolved_how: 'uncovered'|'covered_other_way'|'client_cancelled', covered_by:null, resolved_at, confirmed_by, confirmed_at, close_note, reopened_from:null}` expect open; admin courtesy text | one winner | `{outcome:'closed'}` / `{outcome:'already', …}` / 404 / 400 |
| `assign` (default when no action) | `case_id` | requires `covered_by` and `resolved_how==='covered'`; `assignInAxis`; `patchCase(axiscare_assignment)` | AxisCare `already` when the caregiver is on the visit | `AxisResult` as above |

Free text: `not_chosen.msg` (caller wording, stored on the case and sent later by coverage-run to the not-chosen caregivers), `note` (stored). The admin "Filled by" line is fixed in code (`filledLine`).

---

## 7. team-ask (225 lines)

| | |
|---|---|
| Auth | `requireStaff` OFFICE_ROLES; actor `who.name`, `who.email` |
| Switch | `team_ask_live` — `send` → 409 `{outcome:'off'}` when false; `draft` always |
| Reads first (both) | `app_data.staffing_plans` (plan by `plan_id`), `app_data.caregivers` roster (`rosterFind` by AxisCare id else unique name), `ops_settings` |
| Preview | `draft` |
| Audit | `opEvent {verb:'team_ask_sent'|'team_ask_refused', actor_name, actor_email, item_id: plan_id, area:'scheduling', data{ask_id, plan_id, caregiver_axiscare_id, cells, message}}`; plan row gets `asks[]` entry `{id, caregiver, caregiver_axiscare_id, cells, channel:'sms', text, sent_at, by: who.name, by_email, ghl_contact_id}` and each cell `{status:'asked', at, by, ask_id, ask_channel}` |

| Action | Body fields | Writes | Once | Response |
|---|---|---|---|---|
| `draft` | `plan_id` **req**; `caregiver_axiscare_id` or `caregiver_name` **req one** | none (reads `team_build_link_current`, `journey_episode`, `person_identity`, `person_source_id`, `start_contract_current`, `app_data.client_care_blurbs`; `optOutCheck(sms, viaGhl:false)`) | n/a | `{live, caregiver{first, on_roster, phone_last4, opt_out[]}, client{first, town, start_target, care_line, linked}, template, asked_before[{id,cells,sent_at,by}]}` |
| `send` | + `ask_id` client id `/^[a-z0-9-]{8,64}$/i` **req**; `message` str ≤640 **req**; `cells` string[] `'day|slot'` **req** | `contactForOutbound(sb, ghl, {phone, firstName, lastName}, 'urgent_internal', {audience:'caregiver', channel:'sms', sender:'team-ask', humanInitiated:true, onOptOut})`; **raw** `fetch POST https://services.leadconnectorhq.com/conversations/messages {type:'SMS', contactId, message}` (NOT `ghlSendChecked` → a GHL refusal returns 502 but raises no Needs Attention card); fresh re-read of the plan, merge, RPC `upsert_app_data_item(target_key:'staffing_plans', item)` | `ask_id` already in `plan.asks` → `{outcome:'already_sent', plan}`; every cell must still name this caregiver with status ∈ penciled/asked/no/maybe/no_reply else 409 `board_changed` | `{outcome:'sent', ask, plan, warning?}`; `no_phone` 422; `refused` 422 (opt-out / untrusted number / GHL silent); `failed` 502 |

Free text: **the entire SMS body comes from the request** (`message`). Template default is in code (`DEFAULT_TEMPLATE`) or `ops_settings.team_ask_msg`; the person edits it in the browser.

---

## 8. applicant-decision-msg (125 lines)

| | |
|---|---|
| Auth | `requireStaff` OFFICE_ROLES; actor `who.name || who.email` → `decision_msg_by` |
| Switch | none. Hours: `maySend('reactive_external')` (8am–6pm Central) → held. |
| Reads first | `job_applicants` row `(id, first_name, last_name, phone, email, sms_consent, status, decision_msg_at, decision_msg_kind, decision_msg_held_at)`; `status` must equal `kind` (409) |
| Preview | `action:'preview'` (default) |
| Audit | stamps on `job_applicants`: `decision_msg_at`, `decision_msg_kind`, `decision_msg_by`, `decision_msg_held_at`. Refusals/GHL failures → Needs Attention `send_problem` card via `ghlSendChecked` / `contactForOutbound` (sender `'send-candidate-message (applicant decision)'`). No op_events. |
| Wording | fixed in code (`BODY[kind]` + " Reply STOP to opt out."; email `DECISION_SUBJECT`, `decisionHtml`). The Hub's reason is never sent. No free text. |

| Action | Body fields | Writes | Once / Undo | Response |
|---|---|---|---|---|
| `preview` | `id` uuid **req**; `kind` `'declined'|'pool'` **req** | none | | `{ok, preview:true, text, email{subject,html}|null, no_text_why, already_sent, label}` |
| `send` | same | text if `phone && sms_consent===true` else email if `email`: `contactForOutbound(... 'reactive_external', {humanInitiated, audience:'applicant', sender, channel:'sms'|'email', onOptOut})` → `ghlSendChecked(db, H, SENDER, {channel, contactId, address, who}, {message} | {subject, html})`; if anything went: update `{decision_msg_at, decision_msg_kind, decision_msg_by, decision_msg_held_at:null}`; outside hours: update `{decision_msg_held_at: now}` | once per decision: `decision_msg_at && decision_msg_kind===kind` → `{ok, already_sent:true}`. No undo. | `{ok, texted, emailed, not_sent[]}` / `{ok, held}` / `{ok, texted:false, emailed:false, not_sent:[…]}` / `{ok, error:'Texting is not set up…'}` |
| `skip` | `id` | update `{decision_msg_held_at:null}` | | `{ok, skipped:true}` |

---

## 9. applicant-noshow (138 lines)

| | |
|---|---|
| Auth | `requireStaff` OFFICE_ROLES; actor `who.name || who.email` → `noshow_by`, `noshow_excused_by` |
| Switch | none. Hours `maySend('reactive_external')`: the mark still happens, the message waits (no held stamp; the profile offers "Send"). |
| Reads first | `job_applicants` `(id, first_name, last_name, phone, email, sms_consent, status, noshow_at, noshow_msg_at)` |
| Preview | `preview` (default) |
| Audit | stamps on `job_applicants` (`status`, `noshow_at`, `noshow_by`, `seen_at`, `noshow_msg_at`, `noshow_excused_at/_by`, `noshow_excuse_reason`); `interview_bookings` (`status:'noshow'`, `outcome_at`, `noshow_notified_at`); send-problem cards via helpers (sender `'applicant-noshow'`). No op_events. |
| Wording | fixed in code (her words, `noshowText`/`noshowHtml`). Free text: `reason` (excuse) stored only. |

| Action | Body fields | Writes | Once / Undo | Response |
|---|---|---|---|---|
| `preview` | `id` uuid **req** | none | | `{ok, preview:true, text, email, no_text_why, already_sent}` |
| `mark` | `id` | if status ∈ partial/new/reviewing/interview/noshow: update `job_applicants {status:'noshow', noshow_at, noshow_by, seen_at}`; `interview_bookings` update where `applicant_id` & `status='booked'`; delete `coordinator_busy` where `source='interview'` & `source_id=id`; then the send path below | marking is state-guarded (already noshow → no re-stamp); message once via `noshow_msg_at` | `{ok, marked:true, texted, emailed, not_sent[]}` / `{ok, marked, already_sent}` / `{ok, marked, held}` |
| `send` | `id` | requires status `noshow`; text (phone + `sms_consent`) and email via `contactForOutbound('reactive_external', {audience:'applicant', humanInitiated, sender:'applicant-noshow', channel})` + `ghlSendChecked`; stamp `noshow_msg_at` if anything went | `noshow_msg_at` → `already_sent` | same |
| `excuse` | `id`; `reason` ≤500 **req** | update `{status:'reviewing', noshow_excused_at, noshow_excused_by, noshow_excuse_reason, seen_at}` `.eq('status','noshow')` | this is the undo of `mark` (reason required) | `{ok, excused:true}` |

---

## 10. welcome-call (193 lines)

| | |
|---|---|
| Auth | `requireStaff` OFFICE_ROLES; `staff = who.name || who.email` → `invited_by`, `done_by` |
| Switch | none. Text hours `inTextHours()` 8–18 Central any day (text-consent.ts); emails any time. Text consent = `latestTextConsent(db, phone)` (latest `job_applicants` row with that number; `sms_consent===false` refuses; no application = allowed). |
| Gate | `invite` only: `caregiverGate(db, {candidate_id}, 'cg.approve.advance')` (caregiver journey step must be complete / not_needed / exception, when the candidate has an offer on the new path) → 409 `{error, gate}` |
| Preview | `preview` (`first` only; link placeholder) |
| Audit | stamps on `welcome_calls` (`invited_by`, `updated_at`, `status`, `closed_reason`, `done_at`, `done_by`); send-problem cards via `ghlSendChecked` (sender `'welcome-call'`). **No op_events, no once-per guard: every press of invite / reschedule / noshow / now re-sends.** |
| Send path (`deliver`) | uses `ghlContactIfAllowed(db, ghl, 'welcome-call', {channel, phone, email, firstName, lastName})` **directly** (not `contactForOutbound`, so no audience gate / outreach class) then `ghlSendChecked(... {message} | {subject, html})` |
| Wording | fixed in code (`inviteMessages`, `rescheduleMessages`, `nowMessages`, `noshowMessages`, all `withStop`). Free text: none in the body, but for `invite` the **name, phone and email come from the request** (`first`, `last`, `phone`, `email`), so "Hi {first}" is caller-supplied. |

| Action | Body fields | Reads first | Writes | Response |
|---|---|---|---|---|
| `preview` | `first` ≤40 | none | none | `{ok, text, subject, html}` |
| `invite` | `candidate_id` ≤40 **req**; `first` ≤40; `last` ≤60; `phone` ≤30; `email` ≤120 (phone or email **req**) | `caregiverGate`; latest open `welcome_calls` (status invited/booked/noshow) for the candidate | update that row `{first_name,last_name,phone,email,updated_at}` or insert `{candidate_id, …, invited_by: staff}`; text + email | `{ok, id, link:'https://cc.mo-care.com/welcome.html?w=<id>', reused, texted, emailed, not_sent[]}` |
| `reschedule` | `id` uuid **req**; `reason` `'step2'|'other'` | `welcome_calls` by id | update `{status:'invited', starts_at:null, ends_at:null, closed_reason:'Step 2 not done'|'moved by the office', updated_at}`; delete `coordinator_busy` (`source='welcome_call'`, `source_id=id`); text+email | `{ok, texted, emailed, not_sent}` |
| `noshow` | `id` | row | update `{status:'noshow', starts_at:null, ends_at:null, closed_reason:'missed the call'}`; free busy; text+email | same |
| `now` | `id` | row (status must be invited/booked/noshow); `coordinator_busy` clash in next 15 min (409); `scheduling_settings.welcome_meet_url` | **no row change**; text+email with the Meet link | `{ok, meet, texted, emailed, not_sent}` |
| `done` | `id` | row | update `{status:'done', done_at, done_by: staff, updated_at}`; free busy | `{ok, done:true}` |

---

## 11. clockin-alert (288 lines)

| | |
|---|---|
| Auth | **Signed link only**: body `{c:'tk_…', a:<16-hex adminKey(email)>, e:<epoch exp>, t:<HMAC b64url>}` checked by `checkLink(HUB_JOB_SECRET, b)` (constant-time, expiry end of next day); then `a` must match an admin in `adminRecipients(ops_settings.coverage_alert_admins, default Samantha+Krystal; names/phones from app_data.coordinator_staff)`. Actor = `me {email, name, first}` from that list. No Supabase JWT. |
| Switch | `timekeeper_admin_loop_live` (`loopLive`: when false `view.practice:true` and no "Resolved by" texts); `missed_clockin_after_hours` (`afterHoursAllowed`); `office_quiet_start/end` (`officeQuiet`) |
| Reads first | `ops_settings`; `app_data.timekeeper_cases` item `id===c` with `kind!=='clock_out'` (404). Re-read again before resolve/evv ("first one wins"). |
| Write primitive | RPC `upsert_app_data_item(target_key:'timekeeper_cases', item)` |
| Audit | stamps on the ladder (`resolved_at`, `resolved_how 'admin'|'coverage_case'`, `resolved_by` email, `resolved_by_name` first, `resolved_reason`, `resolved_note`, `coverage_case_id`, `evv_sent_at`, `evv_sent_by`, `evv_prefilled`, `admin_loop.snooze[adminKey]`); ops_items `ops_tk_<id>` set `status:'resolved'` with `owner: me.email`, `detail`; `opEvent` verbs `item_resolved`, `coverage_opened`, `message_sent` — **without `actor_name`/`actor_email` (defaults to actor 'Cara')**, the person is only in the summary text. |
| Wording | fixed in code ("Resolved by {first} ({what}): {reason}. {note}. No more reminders."; EVV text). Free text: `note` ≤300 flows into the "Resolved by" admin SMS, the ops_items detail and the coverage case note. |

| Action | Body fields | Reads | Writes | Once | Response |
|---|---|---|---|---|---|
| `view` (default) | link fields | roster (`app_data.caregivers` by `caregiver_axiscare_id`), AxisCare `GET /api/clients?clientIds=`, `ghlClientLink` ×2 (read-only GHL lookups), `late_notices` by `visit_id` | none | | `{ok, me, late_call{line, quote, kind, practice, closed, paused_until, resumed_after, late_link, family_ok, family_why, family_told}|null, caregiver_first, client_first, shift_date, shift_time, minutes_past_start, texted_at, caregiver_phone, client_phone, client_ghl, caregiver_ghl, practice, reasons{}, replies[], open, resolved{at,how,by,reason,note}|null, snoozed_until, evv_sent_at, evv_prefilled, coverage_case}` |
| `bridge` | `target` `'client'|'caregiver'` | contact numbers as view | `ghlCallBridge(sb, ghl, settings, {email, name, via:'clockin-link'}, {…})` (GHL: assign contact to the admin's GHL user + tag; DB call record) | bridge gap enforced inside helper (`too_soon`) | `BridgeOut` `{ok:true,…}` / `{ok:false, why:'no_user'|'not_set_up'|'too_soon'|'no_workflow'|'error', …}` |
| `snooze` | — | ladder | `admin_loop.snooze[myKey] = now+10min` | per-admin | `{ok, …status}` |
| `resolve` | `reason` ∈ `on_the_way|forgot_clock_in|calling_off|not_happening|other` **req**; `note` ≤300 | fresh ladder; `resolved_at` → `{ok, already:true}` | ladder stamps; ops_items `ops_tk_<id>` resolved; `opEvent item_resolved`; `textAdmin` "Resolved by…" to other admins who were texted (`admin_loop.texts_to`), only if `loopLive`, the loop actually sent, and not quiet (or after-hours allowed → `emergency`) | first one wins | `{ok, others_told, others_not_texted?:'office quiet hours', …status}` |
| `coverage` | `note` | as resolve + `app_data.coverage_cases` open case for `visit_id`; AxisCare `GET /api/visits/{id}` for end time / client name | if none: RPC `upsert_app_data_item('coverage_cases', {id:'cov_tk_<visit>', client, client_axiscare_id, axiscare_visit_id, shift_date, shift_time, calling_off, calling_off_id, reason:'call_off', note, status:'open', asked:[], opened_at, opened_by: me.name, …})` + `opEvent coverage_opened`; then the resolve stamps with `resolved_how:'coverage_case'`, `coverage_case_id` | existing open case reused | as resolve |
| `evv` | — | fresh ladder; roster phone; AxisCare `GET /api/visits/{id}`; `makePrefill` (evv-prefill) | `contactForOutbound(... 'urgent_internal', {audience:'caregiver', channel:'sms', sender:'clockin-alert (EVV form, sent by <first>)'})`; **raw** `fetch POST conversations/messages` (no send-problem card on refusal; 502); stamps `evv_sent_at/_by/_prefilled`; `opEvent message_sent` | `evv_sent_at` → `{ok, already_sent:true}`; allowed on a resolved alert | `{ok, …status}` |

---

## 12. late-alert (303 lines)

| | |
|---|---|
| Auth | **Dual**: if `b.c` present → signed link `{c:'ln_<id>', a, e, t}` via `late-links.checkLink(HUB_JOB_SECRET)` + admin list → `me`, `viaLink=true`, `noticeId = Number(c.slice(3))`; else `requireStaff` OFFICE_ROLES with `b.id` (number) → `me = {email, name, first}`. |
| Switch | `late_watch_live && late_admin_live` (`adminLive`: admin "Seen by"/coverage texts), `late_family_min` (0–120, default 10), templates `late_msg_family`, `late_msg_family_update`, `late_msg_arrived` (defaults in late-notice.ts), `late_watch_live`/`late_call_live` via `holdOptsOf`, office quiet hours (admin texts only). Practice = `late_notices.status === 'practice'` → `family`, `arrived`, `coverage` refused 409; view says why. |
| Reads first | `ops_settings`; `late_notices` row by id (404) |
| Write primitive | `sb.from('late_notices').update({…, updated_at}).eq('id')` |
| Audit | stamps on `late_notices` (`seen_at`, `seen_by` first name, `status`, `eta`, `eta_by` first, `sure`, `family[]{at, by: me.name, what, count, text}`, `family_skipped_at/_by`, `coverage_case_id`, `closed_at`, `closed_how`); `opEvent` **with `actor_name`/`actor_email`** (`item_seen`, `message_sent`, `coverage_opened`, `item_id:'ops_late_<id>'`, `area:'coverage'`); ops_items `ops_late_<id>` resolved after `arrived`; send-problem cards via `ghlSendChecked` (sender `'late-alert'`). |
| Wording | admin texts fixed in code; **family text = request `text`** (≤600), server prefixes "Hi {member first}, "; the draft shown in `view` is filled from `ops_settings.late_msg_family*` or defaults. `arrived` text = request or template. |

| Action | Body fields | Reads | Writes | Once | Response |
|---|---|---|---|---|---|
| `view` (default) | link fields or `id` | roster, AxisCare `GET /api/clients?clientIds=`, `ghlClientLink` ×2, `care_circles` (active, by `axiscare_client_id`, must be exactly one) → `circle_contacts` → `eligibleMembers` | none | | `{ok, me, via_link, practice, admin_texts_live, call{line,quote,at,by,direction,missed_clockin_paused_until}|null, source, kind, status, caregiver_first, client_first, shift_date, shift_time, said[], eta, eta_hhmm, eta_by, sure, seen{by,at}, closed{how,clock_in}, caregiver_phone, client_phone, client_ghl, caregiver_ghl, family{can, why, members, first_names[], draft, is_update, hours_ok, hours, sent[], skipped, arrived_can, arrived_draft}, coverage_case}` |
| `bridge` | `target` `'client'|'caregiver'` | | `ghlCallBridge(... via: viaLink ? 'late-link' : 'hub')` | | `BridgeOut` |
| `seen` | — | | update `{seen_at, seen_by: me.first, status:'seen' if open}`; `tellOthers` ("Seen by {first}: … No more reminders.") via `textAdmin` if `adminLive` && rounds were sent && not quiet; `opEvent item_seen` | `seen_at` → `{ok, already:{by}}` | `{ok, others_told}` |
| `eta` | `hhmm` `'H:MM'` **req** (within −3h/+8h of start) | | update `{eta, eta_by: me.first, sure:true}` (+seen stamps if first); tellOthers if first | | `{ok, eta}` |
| `skip` | — | | update `{family_skipped_at, family_skipped_by}` | | `{ok}` |
| `family` | `text` ≤600 **req** | circle members | per member `contactForOutbound(sb, ghl, {phone, firstName, lastName}, 'timely_external' (6am–9pm), {audience:'family', humanInitiated:true, channel:'sms', sender:'late-alert'})` → `ghlSendChecked(... {message:'Hi {first}, '+text})`; update `family[]` (+seen); `opEvent message_sent` | not once: a second tap sends the "update" wording (`what:'update'`); refused if practice / closed / `familyEligible` fails | `{ok, count}` / 409 `{error}` |
| `arrived` | `text` (optional) | | requires `closed_how==='clocked_in'` and family told; `sendFamily('arrived')`; RPC `upsert_app_data_item('ops_items', {id:'ops_late_<id>', kind:'late_notice', status:'resolved', …})` | `family[]` has `arrived` → `{ok, already:true}` | `{ok, count}` |
| `coverage` | — | `app_data.coverage_cases` open case for `visit_id`; AxisCare `GET /api/visits/{id}` | if none: `upsert_app_data_item('coverage_cases', {id:'cov_ln_<id>', …, note:'Opened from the running-late alert by {name}.', opened_by: me.name})` + `opEvent coverage_opened`; update notice `{coverage_case_id, seen…, status:'closed', closed_at, closed_how:'coverage_case'}`; tellOthers | existing open case reused | `{ok, coverage_case, others_told}` |

---

## 13. callin-alert (190 lines)

| | |
|---|---|
| Auth | **Signed link only** `{c:<case id>, a, e, t}` via `callin-links.checkLink(HUB_JOB_SECRET)` + admin list (`coverage_alert_admins`) → `me`. |
| Switch | `coverage_send_live` (reported in `view`/`candidates`; enforced inside coverage-run for `ask`), `callin_after_hours` (admin courtesy texts any hour), `coverage_msg_not_chosen` (default wording shown to the admin) |
| Reads first | `ops_settings`; `readCase(sb, c)` from `app_data.coverage_cases` (404). Non-open case → every mutating action answers `{ok, already:{how, covered_by, by}}`. |
| Audit | `opEvent` **with actor** (`coverage_claimed`, `coverage_closed`, `coverage_asked`, `item_id: caseId`, `area:'coverage'`); stamps on the case via `coverage_case_patch` (`claimed_by` email, `claimed_by_name` first, `claimed_at`, and the confirm/close fields from coverage-fill with `confirmed_by: me.name`); `axiscare_change_record` from `assignInAxis` (`p_by: me.name`, `p_via 'coverage-assign'`). **No automation_log row** (unlike coverage-assign for the same confirm/close). |
| Wording | admin texts fixed in code (`filledLine`, claim line); caregiver "ask" texts are coverage-run's (its own template/night rule). Free text: `not_chosen.msg`, `note`. |

| Action | Body fields | Reads | Writes | Once | Response |
|---|---|---|---|---|---|
| `view` (default) | link fields | `readPlan` (callin-plan: must-cover), AxisCare `GET /api/clients?clientIds=`, roster | none | | `{ok, me, status, open, kind, client, what, shift_date, shift_time, mins_to_start, must_cover, calling_off, called_in_at, claimed{by,at,me}|null, yes[{id,name,at,reply}], asked[{id,name,state,at,replied_at,can_call}], filled{how,covered_by,by,at,note,axiscare{status,detail}}|null, can_call{caller,client}, not_chosen_default, send_live}` |
| `bridge` | `target` `'caller'|'client'|<ask id>` | | `ghlCallBridge(... via:'hub')` | | `BridgeOut` |
| `claim` | `take_over` bool | | RPC `coverage_case_patch(p_id, p_patch{claimed_by: me.email, claimed_by_name: me.first, claimed_at}, p_expect{status:'open'})`; `opEvent coverage_claimed`; `textCaseAdmins` (except me, onlyAlerted, anyHour) "{first} has the call-in for {what}" | claimed by another and no `take_over` → `{ok, claimed_by_other{by,at}}`; patch conflict → `{ok, already:true}` | `{ok, others_told}` |
| `confirm` | `covered_by` **req** (must match a name in `case.asked`); `not_chosen` `{silent:true}|{msg}` | | `confirmFill` (see coverage-assign: patch expect open → AxisCare GET/PATCH/GET → `axiscare_assignment`); `opEvent coverage_closed`; `textCaseAdmins(filledLine)` | one winner | `{ok, filled{covered_by, axiscare}, others_told}` / `{ok, already{…}}` / 409 |
| `close` | `how` ∈ `uncovered|other_way|client_cancelled` **req**; `note` | | `closeCase`; `opEvent coverage_closed`; courtesy text | one winner | `{ok, closed:<mapped how>, others_told}` |
| `candidates` | — | server-to-server `POST <SUPABASE_URL>/functions/v1/coverage-run {action:'candidates', case_id}` with the service key | none | | `{ok, groups[{key,label,people[{name,why,working_then,town,miles}]}], send_live}` |
| `ask` | `recipients` string[] ≤25 names ≤80 **req** | | `POST coverage-run {action:'send_selected', case_id, recipients, asked_by: me.name}` (coverage-run does eligibility, wording, night rule, one ask per person); `opEvent coverage_asked` | inside coverage-run (`already_asked`) | `{ok, sent[], failed[], already_asked[], not_eligible[]}` |

---

## Common shapes

### What they already share

1. **Transport skeleton** (all 13): `Deno.serve`; `OPTIONS → 'ok'`; non-POST → 405; body = `await req.json().catch(() => ({}))` (visit-change / team-ask / client-journey return 400 'bad request' on a parse failure instead); `const json = (b, s=200) => new Response(JSON.stringify(b), {status, headers:{...cors, 'Content-Type':'application/json'}})`. The `cors` const is the same three headers everywhere (`Access-Control-Allow-Origin: *`, `-Headers: authorization, x-client-info, apikey, content-type`, `-Methods: POST, OPTIONS`); client-journey adds `x-cron-secret`; coverage-assign inlines the headers twice instead of a const.
2. **Service-role client**: `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`; module-level in client-fact / call-place / axiscare-note / coverage-assign, per-request elsewhere, `auth:{persistSession:false}` in about half.
3. **Staff auth**: 10 of 13 call `requireStaff(sb, req, OFFICE_ROLES)` and refuse with `json({error}, status)`; the actor is always `who.email` / `who.name` (never from the body). Link pages (clockin-alert, callin-alert) use the HMAC link + `adminRecipients` admin list instead; late-alert accepts either; coverage-assign and client-journey additionally accept the owner's server key (`ownerCaller`) / cron secret (`jobCaller`).
4. **ops_settings read**: identical one-liner `sb.from('app_data').select('data').eq('key','ops_settings').maybeSingle()` → `st.data ?? {}` in 7 functions (visit-change, team-ask, coverage-assign, clockin-alert, late-alert, callin-alert, client-journey). Per-function live flags: `visit_change_live`, `team_ask_live`, `client_journey_live`, `timekeeper_admin_loop_live`, `late_watch_live`+`late_admin_live`, `coverage_send_live`; shared modifiers: `coverage_alert_admins`, `callin_after_hours`, `missed_clockin_after_hours`, `office_quiet_start/end`, message templates (`team_ask_msg`, `late_msg_*`, `coverage_msg_not_chosen`).
5. **Outbound messaging**: GHL creds from env (`GHL_TOKEN || GHL_API_KEY`, `GHL_LOCATION_ID`); header set `{Authorization: Bearer, Version:'2021-07-28', Content-Type}`. Contact resolution through `contactForOutbound(sb, ghl, person, class, {audience, channel, sender, humanInitiated, onOptOut, emergency})` → `{contactId, phone} | null` (team-ask, applicant-decision-msg, applicant-noshow, clockin-alert evv, late-alert family, and every staff text via `textAdmin`). Outreach classes in use: `reactive_external` (applicants, 8–18), `timely_external` (family, 6–21), `urgent_internal` (caregiver/staff, any hour, staff texts still held by office quiet hours unless `emergency`). welcome-call bypasses it and calls `ghlContactIfAllowed` directly (hours via `inTextHours`, consent via `latestTextConsent`).
6. **Send-problems**: `ghlSendChecked(db, H, sender, {channel, contactId, address, who}, body)` raises a Needs Attention `send_problem` card (ops_items via RPC `upsert_app_data_item`) on any non-2xx; `contactForOutbound` / `ghlContactIfAllowed` / `textAdmin` raise cards for refusals (`reportSendProblem`, `logRefusal` → RPC `contact_send_refusal_log(p_sender, p_channel, p_address, p_reasons)`). Sender names are keys into `SENDER_WORDS`.
7. **app_data documents as state**: coverage_cases, timekeeper_cases, visit_changes, staffing_plans, leads, ops_items, automation_log are JSON arrays in `app_data`, written through RPC `upsert_app_data_item(target_key, item)`; coverage cases additionally use RPC `coverage_case_patch(p_id, p_patch, p_expect)` for a locked, expect-state patch. The "fresh read, merge, write" idiom appears in team-ask, clockin-alert and client-journey.
8. **Append-only event**: `opEvent(sb, {verb, summary≤400, actor_name?, actor_email?, item_id?, area?, data?})` → `op_events` (visit-change, team-ask, clockin-alert, late-alert, callin-alert). `axiscare_change_record(p_kind, p_subject, p_client, p_caregiver, p_outcome, p_summary, p_detail, p_by, p_via)` for anything that touches AxisCare (axiscare-note, visit-change, coverage-fill).
9. **AxisCare client**: a private `axisCreds()`/`creds()`/`axFetcher()` copy in 7 files, base `https://<site>.axiscare.com`, header `X-AxisCare-Api-Version: 2023-10-01`, "never trust a bare 200: read it back" in visit-change and coverage-fill.
10. **Refusal vocabulary**: "Nothing was changed." / "Nothing was sent." suffixes; `outcome` words `off`, `already`, `already_sent`, `already_done`, `changed_meanwhile`, `board_changed`, `refused`, `failed`, `not_found`, `bad_request`.

### What differs (the things a standard wrapper would have to normalise)

| Dimension | Variants seen |
|---|---|
| Actor field name on the written record | `p_recorded_by` (client-fact), `p_by` (call-place, axiscare-note, axiscare_change_record), `by` + `by_email` (visit_changes, plan.asks), `confirmed_by` = display name only (coverage case), `resolved_by` email + `resolved_by_name` first name (timekeeper), `seen_by` / `eta_by` / `family[].by` first name or full name (late_notices), `invited_by` / `done_by` = name‖email (welcome_calls), `decision_msg_by` / `noshow_by` = name‖email (job_applicants), `created_by` email + `completed_by` email + `completed_by_name` (client_journey), `opened_by` name (coverage case), `actor_email`/`actor_name` (op_events). Automation actors: `'hub'`/`'The Hub'`, `'Cara'` (opEvent default), `'coverage-assign'`, `'journey'`, `'the owner's server key'`. |
| Who-am-I source | JWT via requireStaff (10), HMAC link + admin list (3), owner key (2), cron secret (1), server-to-server service key (callin-alert → coverage-run) |
| Logging | automation_log (coverage-assign only); op_events (5; clockin-alert omits the actor fields); axiscare_change_log (3); client_journey_event (1); stamps only (applicant-*, welcome-call); RPC-owned ledger (client-fact, call-place). callin-alert and coverage-assign perform the same confirm/close but log differently. |
| Response envelope | `{outcome:'…'}` family (client-fact RPC, call-place RPC, coverage-assign, visit-change, team-ask, client-journey, axiscare-note); `{ok:true, …}` family (applicant-*, welcome-call, clockin/late/callin pages); raw RPC data (call-place, client-fact). `already` is 200 `{ok, already:true}` on link pages and applicant-*, 409 `{outcome:'already'}` in client-journey, 200 `{outcome:'already'}` in coverage-assign, 200 `{outcome:'already_sent'}` in team-ask. "Switched off" is 409 `{outcome:'off'}` (visit-change, team-ask, journey open) or 409 `{error}` (journey other actions). |
| Idempotency mechanism | client-made id in the body (`change_id`, `ask_id`); stamp columns (`decision_msg_at`+kind, `noshow_msg_at`, `evv_sent_at`, `seen_at`, `said_yes_at`); expect-state patch (`coverage_case_patch p_expect {status:'open'}`); optimistic version (`expected_version` vs `step.version`; `expect{…}` vs live AxisCare visit); RPC-internal (`supersedes_fact_id`, unplaced call lines); **none** (welcome-call invite/reschedule/noshow/now, axiscare-note). |
| Undo | explicit action (`visit-change undo`, same day; `client-journey apply reopen` / `undo_yes` with reason + 24h/owner rule; `applicant-noshow excuse`; `applicant-decision-msg skip` for a held one); none for sends (team-ask, welcome-call, late-alert family), coverage confirm/close, axiscare-note, call-place, client-fact. |
| Preview / practice | `preview` action (applicant-*, welcome-call), `draft` (team-ask), `get` + `expect` echo (visit-change); practice by data state (`late_notices.status='practice'`, `is_test` journeys, `timekeeper_admin_loop_live` → `practice:true` label only); nothing for coverage-assign, call-place, client-fact, axiscare-note. |
| Message wording source | fixed in code (applicant-*, welcome-call, clockin-alert, admin courtesy lines); ops_settings template with code default (team-ask template, late-alert family drafts, not-chosen default); **from the request verbatim** (team-ask `message`, late-alert `text`, coverage `not_chosen.msg` deferred to coverage-run, axiscare-note `note`); request-supplied fragments inside fixed text (clockin-alert `note`, welcome-call `first/last/phone/email`). |
| GHL send call | `ghlSendChecked` (card on failure) vs raw `fetch` to `/conversations/messages` (team-ask send, clockin-alert evv: no card, caller told via 502). |
| Hours door | `maySend('reactive_external')` (applicants), `inTextHours()` (welcome-call), `maySend('timely_external')` inside contactForOutbound (family), `urgent_internal` + `officeQuietNow`/`afterHoursAllowed` (staff), none (AxisCare-only functions). |
| Body validation style | regex-typed helpers (client-fact `uuidOrNull`/`instantOrNull`/`textOrNull` with max lengths), ad-hoc `String(b.x || '')` + regex elsewhere, `clean()` sanitiser (welcome-call). |
| Error status for "not allowed by state" | 409 (most), 422 (team-ask no_phone/refused, journey refusals, visit-change plan refusals), 403 (owner-only), 400 (missing fields), 200 with `error` text (applicant-* "Texting is not set up"). |

### Minimal contract a wrapper could standardise around
- `actor`: `{email, name, first, via: 'jwt'|'link'|'owner_key'|'cron'|'server'}` resolved once up front (requireStaff / checkLink+adminRecipients / jobCaller), stamped as `actor_email` + `actor_name` on every record and every `op_events` row (clockin-alert currently loses it).
- `switch`: one `ops_settings` key per function, read once, same `{outcome:'off'}` 409 answer.
- `once`: a caller-supplied `request_id` (as `change_id` / `ask_id` already do) checked against the audit record before any side effect, returning the first answer.
- `preview: true` on any mutating action returning the exact plan (text, recipients, AxisCare body) without side effects.
- Uniform envelope `{outcome, …, warning?, error?}` with the existing outcome words, and `already` always 200.
- Every external send through `contactForOutbound` + `ghlSendChecked` (never raw fetch), every AxisCare write through `axiscare_change_record` with a read-back `verified` flag.
