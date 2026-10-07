/* =====================================================================================================================
   LEAD RULES: the one decision file for a family before they say yes (Leads intake desk, Stage 0, Samantha 2026-10-06:
   "design it like a home care intake desk, not a CRM"). Pure functions only: no page, no database. The Hub page and the
   server run this same file, so the board, My Work and the installers can never disagree about what a lead needs.

   What it owns:
     · desired start   {kind, date}  asap · by_date · this_week · this_month · planning   (replaces the old urgency radio;
                       the old value still reads, it is never written again)
     · schedule        {days[], times, hours_per_week}  the old free text still reads
     · why they called one line, from what was typed or what the AI summarised
     · waiting         {reason, since, check_back, note}  a waiting lead ALWAYS has a check-back date (her rule)
     · lost reasons    a fixed list; "other" needs a note; staffing reasons keep the schedule and town for the owners
     · required by stage   only what the stage needs: a brand-new lead is never flagged for six unasked questions
   ===================================================================================================================== */
(function(root){
  'use strict';

  /* ── desired start ───────────────────────────────────────────────────────────────────────────────────────────────── */
  const START_KINDS = ['asap', 'by_date', 'this_week', 'this_month', 'planning'];
  const START_LABEL = { asap:'As soon as possible', by_date:'By a date', this_week:'This week', this_month:'This month', planning:'Planning ahead' };
  /* the old urgency radio → the nearest kind. researching = planning ahead (a family looking, not a family in trouble). */
  const LEGACY_URGENCY = { today:'asap', '48hours':'asap', '7days':'this_week', researching:'planning' };
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function ymd(d){ return new Date(d).toLocaleString('sv-SE', { timeZone:'America/Chicago' }).slice(0, 10); }
  function addDays(day, n){ const [y, m, d] = String(day).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  function daysBetween(a, b){ return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }
  function isYmd(s){ return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function dayWords(day, today){
    const n = daysBetween(today, day), d = new Date(day + 'T12:00:00Z');
    if(n === 0) return 'today'; if(n === 1) return 'tomorrow'; if(n === -1) return 'yesterday';
    if(n > 1 && n < 7) return DAY_SHORT[d.getUTCDay()];
    return MONTH_SHORT[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  /* the desired start as stored, or as read from the old radio; null when nothing was asked */
  function desiredStart(l){
    const ds = l && l.desired_start;
    if(ds && START_KINDS.indexOf(ds.kind) > -1) return { kind:ds.kind, date:ds.kind === 'by_date' && isYmd(ds.date) ? ds.date : null, legacy:false };
    const k = l && LEGACY_URGENCY[l.urgency];
    return k ? { kind:k, date:null, legacy:true, urgency:l.urgency } : null;
  }
  /* the sentence on the board: "Needs care by Thursday", "Wants care this week", "Planning ahead" */
  function desiredStartWords(l, today){
    const ds = desiredStart(l); if(!ds) return '';
    today = today || ymd(new Date());
    if(ds.legacy && ds.urgency === 'today') return 'Needs care today';
    if(ds.kind === 'asap') return 'Needs care as soon as possible';
    if(ds.kind === 'by_date'){
      if(!ds.date) return 'Wants care by a date';
      const n = daysBetween(today, ds.date), w = dayWords(ds.date, today);
      if(n < 0) return 'Wanted care by ' + w;
      return (n <= 2 ? 'Needs care ' : 'Wants care ') + (n <= 1 ? w : 'by ' + w);
    }
    if(ds.kind === 'this_week') return 'Wants care this week';
    if(ds.kind === 'this_month') return 'Wants care this month';
    return 'Planning ahead';
  }
  /* how pressing: 0 today/tomorrow · 1 within 3 days · 2 within 2 weeks · 3 later / planning · 4 not asked */
  function startRank(l, today){
    const ds = desiredStart(l); if(!ds) return 4;
    today = today || ymd(new Date());
    if(ds.legacy && ds.urgency === 'today') return 0;
    if(ds.kind === 'asap') return 1;
    if(ds.kind === 'by_date' && ds.date){ const n = daysBetween(today, ds.date); return n <= 1 ? 0 : n <= 3 ? 1 : n <= 14 ? 2 : 3; }
    if(ds.kind === 'this_week') return 2;
    return 3;
  }

  /* ── schedule ────────────────────────────────────────────────────────────────────────────────────────────────────── */
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function schedule(l){
    const s = l && l.schedule;
    if(s && typeof s === 'object'){
      const days = Array.isArray(s.days) ? s.days.filter(d => DAYS.indexOf(d) > -1) : [];
      const hours = s.hours_per_week == null || s.hours_per_week === '' ? null : Number(s.hours_per_week);
      if(days.length || s.times || hours) return { days, times:String(s.times || '').trim(), hours_per_week:isNaN(hours) ? null : hours, legacy:false };
    }
    const dn = String(l && l.days_needed || '').trim(), tn = String(l && l.times_needed || '').trim(), hn = l && l.number_of_hours;
    if(!dn && !tn && !hn) return null;
    const h = hn == null || hn === '' ? null : Number(hn);
    return { days:[], days_text:dn, times:tn, hours_per_week:isNaN(h) ? null : h, legacy:true };
  }
  function daysWords(days){
    if(!days || !days.length) return '';
    const idx = days.map(d => DAYS.indexOf(d)).sort((a, b) => a - b);
    if(idx.join() === '0,1,2,3,4') return 'Mon–Fri';
    if(idx.join() === '0,1,2,3,4,5,6') return 'Every day';
    if(idx.join() === '5,6') return 'Weekends';
    let run = true; for(let i = 1; i < idx.length; i++) if(idx[i] !== idx[i - 1] + 1) run = false;
    if(run && idx.length > 2) return DAYS[idx[0]] + '–' + DAYS[idx[idx.length - 1]];
    return idx.map(i => DAYS[i]).join('/');
  }
  /* "Mon–Fri 9 am–1 pm · about 20 hrs/wk" */
  function scheduleWords(l){
    const s = schedule(l); if(!s) return '';
    const parts = [];
    const d = s.legacy ? s.days_text : daysWords(s.days);
    if(d || s.times) parts.push([d, s.times].filter(Boolean).join(' '));
    if(s.hours_per_week) parts.push('about ' + s.hours_per_week + ' hrs/wk');
    return parts.join(' · ');
  }

  /* ── why they called ─────────────────────────────────────────────────────────────────────────────────────────────── */
  function firstLine(s){ const t = String(s || '').trim().split(/\n+/)[0] || ''; return t.length > 140 ? t.slice(0, 137).replace(/\s+\S*$/, '') + '…' : t; }
  function whyCalled(l){
    if(!l) return '';
    if(String(l.why_called || '').trim()) return String(l.why_called).trim();
    const ai = firstLine(l.ai_needs_summary); if(ai) return ai;
    const n = firstLine(l.interest_notes);
    return /^website form submission/i.test(n) ? '' : n;
  }

  /* ── waiting ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
  /* reason → what the row says we're waiting on, and how long until we check back by default */
  const WAITING = {
    state:            { label:'The state (Medicaid authorization)', on:'The state', days:7,  note:'weekly check-in; at 21 days call DSDS' },
    va:               { label:'The VA', on:'The VA', days:14 },
    ltc:              { label:'The LTC insurer', on:'The LTC insurer', days:14 },
    family_decision:  { label:'The family deciding', on:'Family decision', days:7 },
    not_ready:        { label:'The family isn\'t ready yet', on:'Family not ready', days:30 },
    unable_to_reach:  { label:'Unable to reach them', on:'Unable to reach', days:14, note:'Day 14, Day 30, Day 60; then Lost' },
    discharge_changed:{ label:'The discharge plan changed', on:'Discharge plan changed', days:7 },
  };
  const WAITING_KEYS = Object.keys(WAITING);
  function defaultCheckBack(reason, since){ const w = WAITING[reason]; return w ? addDays(since, w.days) : null; }
  /* the waiting record, or one read from a running nurture sequence (the old way of parking a family) */
  function waiting(l){
    const w = l && l.waiting;
    if(w && WAITING[w.reason]) return { reason:w.reason, since:isYmd(w.since) ? w.since : null, check_back:isYmd(w.check_back) ? w.check_back : null, note:String(w.note || ''), legacy:false };
    if(l && l.nurture_sequence === 'not_ready' && l.nurture_started_at && !l.nurture_stopped_at){
      const since = ymd(l.nurture_started_at);
      return { reason:'not_ready', since, check_back:null, note:'not-ready drip running', legacy:true };
    }
    return null;
  }
  function waitingProblems(w){
    const out = [];
    if(!w) return out;
    if(!WAITING[w.reason]) out.push('Pick what we are waiting on.');
    if(!isYmd(w.check_back)) out.push('A waiting family always has a check-back date.');
    return out;
  }
  function checkBackDue(l, today){ const w = waiting(l); return !!(w && w.check_back && w.check_back <= (today || ymd(new Date()))); }

  /* ── lost reasons ────────────────────────────────────────────────────────────────────────────────────────────────── */
  const LOST = [
    ['could_not_staff', 'Could not staff the schedule', true],
    ['outside_area', 'Outside our service area', true],
    ['price', 'Price'],
    ['minimum_hours', 'Our minimum hours'],
    ['chose_agency', 'Chose another agency'],
    ['chose_facility', 'Chose a facility'],
    ['family_providing', 'Family or a friend is providing the care'],
    ['discharge_changed', 'The discharge plan changed'],
    ['medicaid_issue', 'Medicaid eligibility or program issue'],
    ['va_issue', 'VA authorization issue'],
    ['unable_to_reach', 'Unable to reach them'],
    ['no_longer_needs', 'No longer needs care'],
    ['hospice_deceased', 'Hospice or passed away'],
    ['other', 'Other (say what)'],
  ];
  const LOST_LABEL = {}; LOST.forEach(r => { LOST_LABEL[r[0]] = r[1]; });
  const LOST_STAFFING = LOST.filter(r => r[2]).map(r => r[0]);
  /* the old free-text reasons → keys, so reports can count the whole history */
  const LEGACY_LOST = { 'price':'price', 'chose another agency':'chose_agency', 'not ready yet / timing':'not_ready_legacy', 'went to a facility':'chose_facility',
    'passed away':'hospice_deceased', 'no response':'unable_to_reach', 'spam (not a real inquiry)':'spam' };
  function lostKey(l){
    if(!l) return null;
    if(l.lost_reason_key && (LOST_LABEL[l.lost_reason_key] || l.lost_reason_key === 'spam' || l.lost_reason_key === 'not_ready_legacy')) return l.lost_reason_key;
    const t = String(l.lost_reason || '').trim().toLowerCase();
    return t ? (LEGACY_LOST[t] || 'other') : null;
  }
  /* what to store when a reason is picked: { lost_reason (label), lost_reason_key, lost_detail?, lost_schedule? } */
  function lostRecord(l, key, note, today){
    if(!LOST_LABEL[key]) return null;
    if(key === 'other' && !String(note || '').trim()) return null;
    const out = { lost_reason:LOST_LABEL[key] + (note ? ': ' + String(note).trim() : ''), lost_reason_key:key, lost_at:new Date().toISOString() };
    if(String(note || '').trim()) out.lost_detail = String(note).trim();
    if(LOST_STAFFING.indexOf(key) > -1){
      const s = schedule(l);
      out.lost_schedule = { days:s && !s.legacy ? s.days : [], days_text:s && s.legacy ? s.days_text : '', times:s ? s.times : '', hours_per_week:s ? s.hours_per_week : null,
        city:String(l && l.client_city || '').trim(), zip:String(l && l.client_zip || '').trim() };
    }
    return out;
  }

  /* ── required by stage ───────────────────────────────────────────────────────────────────────────────────────────── */
  /* stages: new · reaching_out · connected · deciding · assessment · nurture (leadStage) · yes (about to say yes)
     New and reaching out need nothing: we have not spoken to them. Once reached, the three questions any first call
     answers. Once an assessment is booked, payer and schedule. At yes, all of it. */
  const REQ = {
    client:  { label:'Who needs care', has:l => !!String((l.client_first_name || '') + (l.client_last_name || '')).trim() || l.client_name_not_provided === true && false },
    why:     { label:'Why they called', has:l => !!whyCalled(l) },
    start:   { label:'When they want care to start', short:'start not asked', has:l => !!desiredStart(l) },
    payer:   { label:'How they will pay', short:'payer not asked', has:l => !!String(l.funding_source || '').trim() },
    schedule:{ label:'The schedule they need', short:'hours not asked', has:l => !!schedule(l) },
    town:    { label:'Their town', short:'town not asked', has:l => !!String(l.client_city || l.client_zip || '').trim() },
  };
  const REQ_BY_STAGE = { new:[], reaching_out:[], connected:['client', 'why', 'start'], deciding:['client', 'why', 'start', 'payer'], nurture:['client', 'why', 'start'],
    assessment:['client', 'why', 'start', 'payer', 'schedule', 'town'], yes:['client', 'why', 'start', 'payer', 'schedule', 'town'] };
  function missing(l, stage){
    const keys = REQ_BY_STAGE[stage] || [];
    return keys.filter(k => !REQ[k].has(l || {})).map(k => ({ key:k, label:REQ[k].label, short:REQ[k].short || REQ[k].label.toLowerCase() }));
  }

  /* ── the intake form ↔ the record ────────────────────────────────────────────────────────────────────────────────── */
  /* the form edits flat helper fields; the record keeps objects. toForm() flattens for filling, compose() rebuilds
     after reading. Helper keys never reach the saved lead. */
  const FORM_KEYS = ['desired_start_kind', 'desired_start_date', 'schedule_days', 'waiting_reason', 'waiting_check_back', 'waiting_note'];
  function toForm(l){
    l = l || {};
    const ds = desiredStart(l), s = schedule(l), w = waiting(l);
    return Object.assign({}, l, {
      desired_start_kind: ds ? ds.kind : '', desired_start_date: ds && ds.date ? ds.date : '',
      schedule_days: s && !s.legacy ? s.days : [],
      waiting_reason: w ? w.reason : '', waiting_check_back: w && w.check_back ? w.check_back : (w ? defaultCheckBack(w.reason, w.since || ymd(new Date())) : ''), waiting_note: w ? w.note : '',
    });
  }
  /* target = the lead being saved (already holding the old values); patch = what the form read. Returns target. */
  function compose(target, patch, today){
    today = today || ymd(new Date());
    patch = Object.assign({}, patch || {});
    if('desired_start_kind' in patch || 'desired_start_date' in patch){
      const kind = patch.desired_start_kind, date = patch.desired_start_date;
      if(START_KINDS.indexOf(kind) > -1) target.desired_start = { kind, date:kind === 'by_date' && isYmd(date) ? date : null, asked_at:(target.desired_start && target.desired_start.kind === kind && target.desired_start.asked_at) || new Date().toISOString() };
      else if(kind === '') target.desired_start = null;
    }
    if('schedule_days' in patch || 'times_needed' in patch || 'number_of_hours' in patch){
      const prev = schedule(target) || {};
      const days = Array.isArray(patch.schedule_days) ? patch.schedule_days.filter(d => DAYS.indexOf(d) > -1) : (prev.legacy ? [] : prev.days || []);
      const times = 'times_needed' in patch ? String(patch.times_needed || '').trim() : (prev.times || '');
      const hraw = 'number_of_hours' in patch ? patch.number_of_hours : (prev.hours_per_week == null ? '' : prev.hours_per_week);
      const h = hraw === '' || hraw == null ? null : Number(hraw);
      target.schedule = (days.length || times || h) ? { days, times, hours_per_week:isNaN(h) ? null : h } : null;
      if(days.length) patch.days_needed = daysWords(days);   /* the old field keeps reading right for anything not yet moved over */
    }
    if('waiting_reason' in patch){
      const reason = patch.waiting_reason;
      if(WAITING[reason]){
        const prev = waiting(target), since = prev && prev.reason === reason && prev.since ? prev.since : today;
        const cb = isYmd(patch.waiting_check_back) ? patch.waiting_check_back : defaultCheckBack(reason, since);
        target.waiting = { reason, since, check_back:cb, note:String(patch.waiting_note || '').trim() };
      } else if(waiting(target)){
        /* cleared: a stored wait records when it ended; a legacy drip is only "not waiting" (stopping the drip is its own button) */
        if(target.waiting) target.waiting_ended = { reason:target.waiting.reason, since:target.waiting.since, ended_at:new Date().toISOString() };
        target.waiting = null;
      }
    }
    FORM_KEYS.concat(['desired_start_kind']).forEach(k => { delete patch[k]; });
    Object.assign(target, patch);
    FORM_KEYS.forEach(k => { delete target[k]; });
    return target;
  }

  /* ── lead response hours and the first-attempt clock (Stage 1, her rules 2026-10-06) ─────────────────────────────
     A new inquiry inside our lead-response hours gets a first human attempt within 5 minutes. Outside them the family
     gets the acknowledgment at once and the clock starts when coverage opens, so a 9 pm inquiry is not red all night
     and reads "came in last night at 9:02 pm" at 8 am. The hours are a setting (ops_settings.lead_response_hours),
     never hard-coded here: { days:[1..5], start:'08:00', end:'18:00' } with days 0 = Sunday … 6 = Saturday. */
  const RESPONSE_HOURS_DEFAULT = { days:[1, 2, 3, 4, 5], start:'08:00', end:'18:00' };
  const FIRST_ATTEMPT_MINUTES = 5;
  const TZ = 'America/Chicago';
  function isHm(s){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '')); }
  function hmMin(s){ const [h, m] = String(s).split(':').map(Number); return h * 60 + m; }
  /* the setting, cleaned, else the default */
  function responseHours(settings){
    const h = settings && settings.lead_response_hours;
    if(!h || typeof h !== 'object') return Object.assign({ source:'default' }, RESPONSE_HOURS_DEFAULT);
    const days = Array.isArray(h.days) ? h.days.map(Number).filter(d => d >= 0 && d <= 6) : [];
    if(!days.length || !isHm(h.start) || !isHm(h.end) || hmMin(h.start) >= hmMin(h.end)) return Object.assign({ source:'default' }, RESPONSE_HOURS_DEFAULT);
    return { days:days.slice().sort(), start:h.start, end:h.end, source:'setting' };
  }
  /* the Chicago wall clock for an instant: { ymd, hm, min (since midnight), dow } */
  function chicago(iso){
    const d = new Date(iso);
    const p = {}; new Intl.DateTimeFormat('en-US', { timeZone:TZ, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'short' })
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    const hour = Number(p.hour) % 24;
    return { ymd:p.year + '-' + p.month + '-' + p.day, hm:String(hour).padStart(2, '0') + ':' + p.minute, min:hour * 60 + Number(p.minute),
      dow:['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
  }
  /* the instant for a Chicago wall-clock time (CDT or CST, whichever renders back to the same clock) */
  function chicagoInstant(day, hm){
    for(const off of ['-05:00', '-06:00']){ const t = Date.parse(day + 'T' + hm + ':00' + off); const c = chicago(t); if(c.ymd === day && c.hm === hm) return new Date(t).toISOString(); }
    return new Date(Date.parse(day + 'T' + hm + ':00-06:00')).toISOString();
  }
  function inResponseHours(iso, hours){
    const c = chicago(iso); return hours.days.indexOf(c.dow) > -1 && c.min >= hmMin(hours.start) && c.min < hmMin(hours.end);
  }
  /* the next moment coverage opens at or after iso (iso itself when we are open) */
  function nextOpening(iso, hours){
    if(inResponseHours(iso, hours)) return new Date(iso).toISOString();
    let c = chicago(iso), day = c.ymd;
    if(hours.days.indexOf(c.dow) > -1 && c.min < hmMin(hours.start)) return chicagoInstant(day, hours.start);
    for(let i = 1; i <= 8; i++){ day = addDays(day, 1); const dow = new Date(day + 'T12:00:00Z').getUTCDay(); if(hours.days.indexOf(dow) > -1) return chicagoInstant(day, hours.start); }
    return chicagoInstant(addDays(c.ymd, 1), hours.start);
  }
  function clockStart(lead, hours){ return lead && lead.created_at ? nextOpening(lead.created_at, hours) : null; }
  function firstAttemptDue(lead, hours){ const s = clockStart(lead, hours); return s ? new Date(Date.parse(s) + FIRST_ATTEMPT_MINUTES * 60000).toISOString() : null; }
  function clockWords(iso){ const c = chicago(iso); const h = Number(c.hm.slice(0, 2)), m = c.hm.slice(3); return ((h % 12) || 12) + (m === '00' ? '' : ':' + m) + ' ' + (h < 12 ? 'am' : 'pm'); }
  /* "came in 12 min ago" · "came in at 9:02 am" · "came in last night at 9:02 pm" · "came in Sat at 10:15 am" */
  function cameInWords(createdIso, nowIso){
    const now = nowIso || new Date().toISOString(), c = chicago(createdIso), n = chicago(now);
    const mins = Math.round((Date.parse(now) - Date.parse(createdIso)) / 60000);
    if(c.ymd === n.ymd) return mins < 60 ? 'came in ' + Math.max(0, mins) + ' min ago' : 'came in at ' + clockWords(createdIso);
    if(addDays(c.ymd, 1) === n.ymd) return (c.min >= 17 * 60 ? 'came in last night at ' : 'came in yesterday at ') + clockWords(createdIso);
    const back = daysBetween(c.ymd, n.ymd);
    return 'came in ' + (back < 7 ? DAY_SHORT[c.dow] : dayWords(c.ymd, n.ymd)) + ' at ' + clockWords(createdIso);
  }
  /* "we open at 8 am" · "we open Monday at 8 am", for the after-hours acknowledgment */
  function openingWords(iso, hours){
    const o = nextOpening(iso, hours), c = chicago(iso), oc = chicago(o);
    const DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if(oc.ymd === c.ymd) return 'we open at ' + clockWords(o);
    if(oc.ymd === addDays(c.ymd, 1)) return 'we open tomorrow at ' + clockWords(o);
    return 'we open ' + DAYNAME[oc.dow] + ' at ' + clockWords(o);
  }
  /* everything the card and the board say about a new lead's clock */
  function firstAttemptState(lead, hours, nowIso){
    const now = nowIso || new Date().toISOString();
    if(!lead || !lead.created_at) return null;
    const start = clockStart(lead, hours), due = firstAttemptDue(lead, hours);
    const afterHours = start !== new Date(lead.created_at).toISOString();
    const attempted = !!lead.first_human_attempt_at;
    const running = Date.parse(now) >= Date.parse(start);
    const openMin = running ? Math.round((Date.parse(now) - Date.parse(start)) / 60000) : 0;
    const overdue = !attempted && running && Date.parse(now) > Date.parse(due);
    return { start, due, after_hours:afterHours, attempted, running, open_minutes:openMin, overdue, late_minutes:overdue ? openMin - FIRST_ATTEMPT_MINUTES : 0,
      came_in:cameInWords(lead.created_at, now), ack:lead.ack_sent_at ? 'auto-acknowledged ' + (afterHours ? 'immediately' : 'at ' + clockWords(lead.ack_sent_at)) : 'no acknowledgment went out',
      starts_words:running ? '' : 'the clock starts ' + (chicago(start).ymd === chicago(now).ymd ? 'at ' : dayWords(chicago(start).ymd, chicago(now).ymd) + ' at ') + clockWords(start) };
  }
  /* minutes from the clock start to the first human attempt, for the inquiries whose clock started today (an overnight
     inquiry counts on the morning the office had it); null with no data */
  function medianFirstAttemptMinutes(leads, hours, todayYmd){
    const t = todayYmd || ymd(new Date());
    const xs = (leads || []).filter(l => l && l.created_at && l.first_human_attempt_at && chicago(clockStart(l, hours)).ymd === t)
      .map(l => Math.max(0, Math.round((Date.parse(l.first_human_attempt_at) - Date.parse(clockStart(l, hours))) / 60000))).sort((a, b) => a - b);
    if(!xs.length) return null;
    const mid = Math.floor(xs.length / 2); return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
  }

  /* ── the move-over (installer): what an old lead gets, as a patch, or null when nothing is missing ─────────────── */
  function migrationPatch(l, today){
    const p = {}; today = today || ymd(new Date());
    const ds = desiredStart(l);
    if(ds && ds.legacy) p.desired_start = { kind:ds.kind, date:null, asked_at:l.created_at || null, from:'urgency:' + ds.urgency };
    const s = schedule(l);
    if(s && s.legacy) p.schedule = { days:[], times:s.times, hours_per_week:s.hours_per_week, days_text:s.days_text, from:'intake text' };
    const w = waiting(l);
    if(w && w.legacy){ const cb = defaultCheckBack('not_ready', w.since); p.waiting = { reason:'not_ready', since:w.since, check_back:cb < today ? addDays(today, 7) : cb, note:'moved over from the not-ready drip', from:'nurture' }; }
    if(l && l.status === 'Lost' && l.lost_reason && !l.lost_reason_key){ const k = lostKey(l); if(k) p.lost_reason_key = k; }
    return Object.keys(p).length ? p : null;
  }

  const api = { START_KINDS, START_LABEL, LEGACY_URGENCY, DAYS, WAITING, WAITING_KEYS, LOST, LOST_LABEL, LOST_STAFFING, REQ_BY_STAGE, FORM_KEYS,
    RESPONSE_HOURS_DEFAULT, FIRST_ATTEMPT_MINUTES,
    ymd, addDays, daysBetween, dayWords, desiredStart, desiredStartWords, startRank, schedule, daysWords, scheduleWords, whyCalled,
    waiting, waitingProblems, defaultCheckBack, checkBackDue, lostKey, lostRecord, missing, toForm, compose, migrationPatch,
    responseHours, chicago, chicagoInstant, inResponseHours, nextOpening, clockStart, firstAttemptDue, clockWords, cameInWords, openingWords,
    firstAttemptState, medianFirstAttemptMinutes };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LeadRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
