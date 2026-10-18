/* verbs.js · ONE VOCABULARY for the event record (Phase 1, Slice 1, 2026-10-10).
   The same file is served to the Hub page (cc-hub-live/verbs.js) and imported by the server (_shared/verbs.js); no
   import or export statements, so it is valid as both. Every verb the record carries is listed here with the words a
   person reads, the area it belongs to, how loud it is, and whether it is a diagnostic that stays out of
   "Since You Left". A verb that is not listed still records (the record never refuses history), but the tests flag it.
   severity: fyi | action | ack | critical    area: work | leads | clients | scheduling | caregivers | recruiting | admin | comms */
(function (root) {
  var V = {
    /* work items */
    item_created:        { label: 'raised',                 area: 'work',       severity: 'fyi' },
    item_claimed:        { label: 'took it',                area: 'work',       severity: 'fyi' },
    item_taken_over:     { label: 'took it over',           area: 'work',       severity: 'fyi' },
    item_released:       { label: 'let it go',              area: 'work',       severity: 'fyi' },
    item_assigned:       { label: 'assigned',               area: 'work',       severity: 'fyi' },
    item_transferred:    { label: 'handed to',              area: 'work',       severity: 'fyi' },
    item_unassigned:     { label: 'unassigned',             area: 'work',       severity: 'fyi' },
    item_waiting:        { label: 'parked, waiting on',     area: 'work',       severity: 'fyi' },
    item_escalated:      { label: 'escalated',              area: 'work',       severity: 'ack' },
    item_resolved:       { label: 'resolved',               area: 'work',       severity: 'fyi' },
    item_seen:           { label: 'seen',                   area: 'work',       severity: 'fyi' },
    item_note:           { label: 'added a note',           area: 'work',       severity: 'fyi' },
    help_asked:          { label: 'asked for help',         area: 'work',       severity: 'action' },
    item_helped:         { label: 'helped with',            area: 'work',       severity: 'fyi' },   /* lead turns (2026-10-18): helping never moves the work */
    item_updated:        { label: 'updated',                area: 'work',       severity: 'fyi' },
    claim_stale:         { label: 'claim went stale',       area: 'work',       severity: 'fyi' },
    captured:            { label: 'captured',               area: 'work',       severity: 'fyi' },
    handoff_seen:        { label: 'read the handoff',       area: 'work',       severity: 'fyi' },
    shift_ended:         { label: 'ended their shift',      area: 'work',       severity: 'fyi' },
    project_changed:     { label: 'changed a project',      area: 'work',       severity: 'fyi' },
    /* settings and config */
    config_changed:      { label: 'changed a setting',      area: 'admin',      severity: 'fyi' },
    setting_changed:     { label: 'changed a switch',       area: 'admin',      severity: 'fyi' },
    onboarding_permission_changed: { label: 'changed an onboarding permission', area: 'admin', severity: 'fyi' },
    cov_wording_reset:   { label: 'reset call-off wording', area: 'admin',      severity: 'fyi' },
    cov_wording_edited:  { label: 'edited call-off wording',area: 'admin',      severity: 'fyi' },
    fresh_start:         { label: 'fresh start',            area: 'admin',      severity: 'fyi' },
    /* leads and clients */
    lead_inquiry:        { label: 'new inquiry',            area: 'leads',      severity: 'action' },
    lead_connected:      { label: 'connected with the lead',area: 'leads',      severity: 'fyi' },
    lead_attempted:      { label: 'tried the lead',         area: 'leads',      severity: 'fyi' },
    lead_rung:           { label: 'speed-to-lead rung',     area: 'leads',      severity: 'fyi' },
    lead_opted_out:      { label: 'lead opted out',         area: 'leads',      severity: 'fyi' },
    lead_authorized:     { label: 'lead authorized',        area: 'leads',      severity: 'fyi' },
    lead_reply_received: { label: 'lead replied',           area: 'leads',      severity: 'action' },
    lead_consult_booked: { label: 'consultation booked',    area: 'leads',      severity: 'action' },
    soc_ready:           { label: 'ready for staffing',     area: 'clients',    severity: 'action' },
    launch_complete:     { label: 'launch complete',        area: 'clients',    severity: 'fyi' },
    callin_plan_updated: { label: 'updated the call-in plan',area: 'clients',   severity: 'fyi' },
    care_packet_saved:   { label: 'saved a caregiver packet', area: 'clients',  severity: 'fyi' },
    care_packet_link:    { label: 'made a caregiver packet link', area: 'clients', severity: 'fyi' },
    care_packet_understood: { label: 'confirmed the caregiver packet', area: 'clients', severity: 'fyi' },
    care_packet_sent:    { label: 'texted a caregiver packet', area: 'clients', severity: 'fyi' },
    care_packet_auto_set: { label: 'set a caregiver packet to send automatically or by hand', area: 'clients', severity: 'fyi' },
    care_packet_acks_carried: { label: 'kept caregiver packet confirmations after a small fix', area: 'clients', severity: 'fyi' },
    care_packet_send_refused: { label: 'caregiver packet text not sent', area: 'clients', severity: 'fyi' },
    care_topic_saved:    { label: 'saved a care how-to topic', area: 'admin',   severity: 'fyi' },
    care_topic_reviewed: { label: 'approved or removed a Care Library item', area: 'admin', severity: 'fyi' },
    /* scheduling */
    coverage_opened:     { label: 'opened a call-off case', area: 'scheduling', severity: 'action' },
    coverage_interest_opened: { label: 'opened a new-client ask', area: 'scheduling', severity: 'fyi' },
    coverage_claimed:    { label: 'took the call-in',       area: 'scheduling', severity: 'fyi' },
    coverage_asked:      { label: 'asked caregivers',       area: 'scheduling', severity: 'fyi' },
    coverage_closed:     { label: 'closed the case',        area: 'scheduling', severity: 'fyi' },
    coverage_backed_out: { label: 'caregiver backed out',   area: 'scheduling', severity: 'ack' },
    coverage_reopened:   { label: 'reopened the case',      area: 'scheduling', severity: 'action' },
    coverage_held_check: { label: 'checked a held visit',   area: 'scheduling', severity: 'fyi' },
    wave_sent:           { label: 'sent a wave',            area: 'scheduling', severity: 'fyi' },
    open_hours_sent:     { label: 'texted the team open hours', area: 'scheduling', severity: 'fyi' },
    yes_received:        { label: 'a caregiver said yes',   area: 'scheduling', severity: 'action' },
    follow_up_sent:      { label: 'sent a follow-up',       area: 'scheduling', severity: 'fyi' },
    visit_changed:       { label: 'changed a visit',        area: 'scheduling', severity: 'fyi' },
    visit_change_refused:{ label: 'visit change refused',   area: 'scheduling', severity: 'fyi' },
    team_ask_sent:       { label: 'texted a caregiver about shifts', area: 'scheduling', severity: 'fyi' },
    team_ask_refused:    { label: 'caregiver text refused', area: 'scheduling', severity: 'fyi' },
    late_seen:           { label: 'seen (running late)',    area: 'scheduling', severity: 'fyi' },
    late_eta:            { label: 'set an ETA',             area: 'scheduling', severity: 'fyi' },
    late_family:         { label: 'told the family',        area: 'scheduling', severity: 'fyi' },
    late_skip:           { label: 'skipped the family text',area: 'scheduling', severity: 'fyi' },
    late_arrived:        { label: 'arrived',                area: 'scheduling', severity: 'fyi' },
    late_coverage:       { label: 'opened coverage from a late notice', area: 'scheduling', severity: 'action' },
    missed_note_entered: { label: 'entered a missed note',  area: 'scheduling', severity: 'fyi' },
    message_sent:        { label: 'sent a message',         area: 'comms',      severity: 'fyi' },
    kind_tell_sent:      { label: 'told a caregiver kind words', area: 'caregivers', severity: 'fyi' },
    kind_tell_refused:   { label: 'kind words text refused',area: 'caregivers', severity: 'fyi' },
    /* caregivers and recruiting */
    applicant_review_cleared: { label: 'cleared a review',  area: 'recruiting', severity: 'fyi' },
    prehire_doc_filed:   { label: 'filed a document',       area: 'recruiting', severity: 'fyi' },
    profile_media_hidden:{ label: 'hid profile media',      area: 'caregivers', severity: 'fyi' },
    profile_media_shown: { label: 'showed profile media',   area: 'caregivers', severity: 'fyi' },
    profile_links_sent:  { label: 'sent profile links',     area: 'caregivers', severity: 'fyi' },
    profile_video_optional_told: { label: 'told caregivers the video is optional', area: 'caregivers', severity: 'fyi' },
    profile_gate_override:{ label: 'went ahead without a published profile', area: 'caregivers', severity: 'ack' },
    /* calls */
    call_bridge:         { label: 'placed a call',          area: 'comms',      severity: 'fyi' },
    call_bridge_failed:  { label: 'call could not be placed',area: 'comms',     severity: 'fyi' },
    /* actions behind the door (Slice 3) */
    fact_recorded:       { label: 'recorded a fact',        area: 'clients',    severity: 'fyi' },
    person_recorded:     { label: 'recorded a person on the Journey', area: 'clients', severity: 'fyi' },
    call_placed:         { label: 'placed a call on a profile', area: 'comms',  severity: 'fyi' },
    authority_changed:   { label: 'changed who may do what',area: 'admin',      severity: 'ack' },
    /* diagnostics: never shown as "what happened while you were out" */
    routing_shadow:      { label: 'routing shadow',         area: 'admin',      severity: 'fyi', diagnostic: true },
    record_started:      { label: 'record started',         area: 'admin',      severity: 'fyi', diagnostic: true },
    action_refused:      { label: 'was refused',            area: 'admin',      severity: 'fyi', diagnostic: true },
    care_packet_watch_run: { label: 'checked caregiver packets before shifts', area: 'clients', severity: 'fyi', diagnostic: true },
    action_failed:       { label: 'could not finish',       area: 'admin',      severity: 'fyi', diagnostic: true }
  };
  var api = {
    VERBS: V,
    label: function (verb) { var v = V[verb]; return v ? v.label : String(verb || '').replace(/_/g, ' '); },
    area: function (verb) { var v = V[verb]; return v ? v.area : ''; },
    severity: function (verb) { var v = V[verb]; return v ? v.severity : 'fyi'; },
    isDiagnostic: function (verb) { var v = V[verb]; return !!(v && v.diagnostic); },
    known: function (verb) { return Object.prototype.hasOwnProperty.call(V, verb); },
    list: function () { return Object.keys(V); }
  };
  root.CC_VERBS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
