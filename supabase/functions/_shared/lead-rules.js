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
      /* clean-up 6.4 (2026-10-07): the old days_needed text is history now; nothing writes it (schedule() still reads it when there is no new shape) */
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
    const prevState = target.state_status;
    Object.assign(target, patch);
    if('state_status' in patch) markAuthorized(target, prevState);
    FORM_KEYS.forEach(k => { delete target[k]; });
    return target;
  }

  /* ── lead response hours and the first-attempt clock (Stage 1, her rules 2026-10-06) ─────────────────────────────
     A new inquiry inside our lead-response hours gets a first human attempt within 5 minutes. Outside them the family
     gets the acknowledgment at once and the clock starts when coverage opens, so a 9 pm inquiry is not red all night
     and reads "came in last night at 9:02 pm" at 8 am. The hours are a setting (ops_settings.lead_response_hours),
     never hard-coded here: { days:[0..6], start:'08:00', end:'18:00' } with days 0 = Sunday … 6 = Saturday. Her default
     (2026-10-07): every day of the week, 8 am to 6 pm; only the evenings are off. */
  const RESPONSE_HOURS_DEFAULT = { days:[0, 1, 2, 3, 4, 5, 6], start:'08:00', end:'18:00' };
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
  /* a time as the booking page writes it, in words with no year ("Monday, October 12 at 9:00 AM (Central)"), read as
     Chicago time in the year that puts it nearest today. Anything else that isn't a date is null (2026-10-07: one worded
     booking used to stop the whole Leads board drawing). */
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function wordsWhen(v, nowMs){
    const m = /([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:\s*(?:at|,|@)?\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?)?/i.exec(String(v || ''));
    if(!m) return null;
    const mi = MONTHS.findIndex(x => x.indexOf(m[1].toLowerCase()) === 0 && m[1].length >= 3); if(mi < 0) return null;
    let h = m[4] ? Number(m[4]) % 12 + (/p/i.test(m[6] || '') ? 12 : 0) : 9; const mm = m[5] || '00';
    const pad = n => String(n).padStart(2, '0'), day = y => y + '-' + pad(mi + 1) + '-' + pad(Number(m[2]));
    const now = nowMs == null ? Date.now() : nowMs, base = new Date(now).getUTCFullYear();
    const years = m[3] ? [Number(m[3])] : [base - 1, base, base + 1];
    let best = null;
    for(const y of years){ const t = Date.parse(chicagoInstantSafe(day(y), pad(h) + ':' + mm)); if(isNaN(t)) continue; if(best === null || Math.abs(t - now) < Math.abs(best - now)) best = t; }
    return best === null ? null : new Date(best).toISOString();
  }
  function chicagoInstantSafe(dayS, hm){
    for(const off of ['-05:00', '-06:00']){ const t = Date.parse(dayS + 'T' + hm + ':00' + off); if(isNaN(t)) continue;
      const p = {}; new Intl.DateTimeFormat('en-US', { timeZone:TZ, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
      if(p.year + '-' + p.month + '-' + p.day === dayS && String(Number(p.hour) % 24).padStart(2, '0') + ':' + p.minute === hm) return new Date(t).toISOString(); }
    const t = Date.parse(dayS + 'T' + hm + ':00-06:00'); return isNaN(t) ? '' : new Date(t).toISOString();
  }
  /* any stored time (an ISO stamp, a Date, a number, or the booking page's words) as an ISO string, or null */
  function whenISO(v, nowMs){
    if(v === null || v === undefined || v === '') return null;
    const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : (/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? Date.parse(String(v)) : NaN);
    if(!isNaN(t)) return new Date(t).toISOString();
    return wordsWhen(v, nowMs);
  }
  function chicago(iso){
    let d = new Date(iso);
    if(isNaN(d.getTime())){ const w = whenISO(iso); d = new Date(w || 0); if(!w) return { ymd:'', hm:'', min:0, dow:-1, bad:true }; }
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
  /* "after 8 am" · "tomorrow after 8 am" · "Saturday after 8 am": when the coordinator will call, for her acknowledgment */
  function callBackWords(iso, hours){
    const o = nextOpening(iso, hours), c = chicago(iso), oc = chicago(o);
    const DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if(oc.ymd === c.ymd) return 'after ' + clockWords(o);
    if(oc.ymd === addDays(c.ymd, 1)) return 'tomorrow after ' + clockWords(o);
    return DAYNAME[oc.dow] + ' after ' + clockWords(o);
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

  /* ── ONE NEXT (clean-up 6.2, 2026-10-07): the one date a lead carries with the family ─────────────────────────────────
     The record still holds the fields the Hub always had (promised_callback_at, follow_up_due + time + note, waiting.check_back),
     but there is ONE reader, leadNext(), and ONE writer, setNext(). A promise (they asked us to call at a time) outranks a
     check-back (we parked them until a date), which outranks a plain follow-up. The board, My Work and the journey card all
     read leadNext(); nothing else decides what the next date is. */
  function leadNext(l, nowIso){
    const now = nowIso || new Date().toISOString(); if(!l) return null;
    const fin = (o) => { o.due = Date.parse(o.at) <= Date.parse(now); o.late_minutes = o.due ? Math.round((Date.parse(now) - Date.parse(o.at)) / 60000) : 0; o.day = chicago(o.at).ymd; return o; };
    if(l.promised_callback_at){
      const p = new Date(l.promised_callback_at).toISOString(), h = lastHumanOut(l);
      if(!(h && h.at >= p)) return fin({ kind:'promise', at:p, why:'they asked us to call then' });
    }
    const w = waiting(l);
    if(w && w.check_back) return fin({ kind:'check_back', at:chicagoInstant(w.check_back, '09:00'), why:WAITING[w.reason].on, reason:w.reason, note:w.note || '' });
    const fu = String(l.follow_up_due || '').slice(0, 10);
    if(isYmd(fu)) return fin({ kind:'follow_up', at:chicagoInstant(fu, isHm(l.follow_up_time) ? l.follow_up_time : '09:00'), timed:isHm(l.follow_up_time), why:String(l.follow_up_note || '').trim() });
    return null;
  }
  /* "Call back: we said Tue 9 am (1 h 10 min late)" · "Check back day: the state" · "Follow up: Did Genworth send the policy?" */
  function nextWords(nx, nowIso){
    if(!nx) return ''; const now = nowIso || new Date().toISOString();
    if(nx.kind === 'promise') return 'Call back: we said ' + whenWords(nx.at, now) + (nx.due && nx.late_minutes > 0 ? ' (' + minsWords(nx.late_minutes) + ' late)' : '');
    if(nx.kind === 'check_back') return (nx.due ? 'Check back day: ' : 'Check back ' + dayWords(nx.day, chicago(now).ymd) + ': ') + String(nx.why).toLowerCase() + (nx.note ? ' · ' + nx.note : '');
    return 'Follow up' + (nx.due ? '' : ' ' + dayWords(nx.day, chicago(now).ymd) + (nx.timed ? ' ' + clockWords(nx.at) : '')) + (nx.why ? ': ' + nx.why : '');
  }
  /* the one writer. kind: follow_up | promise | check_back | clear. day YYYY-MM-DD, time HH:MM (optional), why (a few words). */
  function setNext(l, o, nowIso){
    const now = nowIso || new Date().toISOString(); o = o || {};
    if(o.kind === 'clear'){ l.follow_up_due = null; l.follow_up_time = null; l.follow_up_note = null; return l; }
    if(!isYmd(o.day)) throw new Error('setNext needs a day (YYYY-MM-DD)');
    const time = isHm(o.time) ? o.time : null, why = String(o.why || '').trim() || null;
    if(o.kind === 'promise'){ l.promised_callback_at = o.day + 'T' + (time || '09:00') + ':00'; l.follow_up_due = o.day; l.follow_up_time = time; if(why) l.follow_up_note = why; return l; }
    if(o.kind === 'check_back'){ if(!l.waiting || !WAITING[l.waiting.reason]) throw new Error('a check-back needs a waiting record'); l.waiting.check_back = o.day; if(why) l.waiting.note = why; return l; }
    /* follow_up */
    l.follow_up_due = o.day; l.follow_up_time = time; l.follow_up_note = why;
    if(l.waiting && WAITING[l.waiting.reason]) l.waiting.check_back = o.day;   /* a follow-up on a waiting family IS its check-back */
    return l;
  }

  /* ── ONE STATUS WRITER (clean-up 6.7, 2026-10-07): the stored status is a consequence of what happened ───────────────
     lead.status stays stored (the server reads it), but nothing sets it by hand any more: a logged conversation makes it
     Contacted, a booking makes it Assessment Scheduled, They said yes / an AxisCare client makes it Converted, a reason makes
     it Lost. Every change goes through setStatus(), which keeps status_history (who, when, why) and stamps the dates. */
  const STATUSES = ['New', 'Contacted', 'Assessment Scheduled', 'Converted', 'Lost'];
  function setStatus(l, to, o){
    o = o || {}; if(!l) return false;
    if(STATUSES.indexOf(to) < 0) throw new Error('not a lead status: ' + to);
    const from = String(l.status || 'New'); if(from === to) return false;
    const at = o.at || new Date().toISOString();
    l.status = to;
    l.status_history = (Array.isArray(l.status_history) ? l.status_history : []).concat([{ at, from, to, by:String(o.by || ''), why:String(o.why || '') }]).slice(-50);
    if(to === 'Converted' && !l.converted_at) l.converted_at = at;
    if(to === 'Lost' && !l.lost_at) l.lost_at = at;
    if(from === 'Lost' && to !== 'Lost') l.lost_undone_at = at;
    return true;
  }
  /* the status a lead had before it was Lost (for "not lost after all") */
  function statusBeforeLost(l){
    const h = Array.isArray(l && l.status_history) ? l.status_history : [];
    for(let i = h.length - 1; i >= 0; i--) if(h[i].to === 'Lost' && STATUSES.indexOf(h[i].from) > -1 && h[i].from !== 'Lost') return h[i].from;
    return l && l.first_human_contact_at ? 'Contacted' : 'New';
  }

  /* ── the board (Stage 2, her brief 2026-10-06: "who needs me right now, and what exactly do I need to do") ──────────
     One row per family before they say yes, in one of three groups:
       now      Need you now: anything a person has to do now, most urgent first (a rank per reason)
       later    Scheduled: a real time or day that has not come yet, in order
       waiting  Waiting: something outside the office has to happen first; always with a check-back date
     ctx = { now, today, hours, stage (leadStage word), name, assessments:[{visit_date,status}], journey_next:{title,why}|null,
             payer_label }. Pure: the page only draws what comes back. */
  const PAYER_WORDS = { private:'Private pay', ltc:'LTC insurance', va:'VA', cds:'CDS', medicaid:'Medicaid IHS', other:'Other payer' };
  function minsWords(m){ m = Math.max(0, Math.round(m)); if(m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + r + ' min' : ''); }
  function whenWords(iso, now){ const c = chicago(iso), n = chicago(now); if(c.ymd === n.ymd) return clockWords(iso); const back = daysBetween(c.ymd, n.ymd); return (back > 1 && back < 7 ? DAY_SHORT[c.dow] : dayWords(c.ymd, n.ymd)) + ' ' + clockWords(iso); }
  function dayCap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function evts(l){ return Array.isArray(l && l.contact_events) ? l.contact_events : []; }
  function lastWhere(l, pred){ const e = evts(l); for(let i = e.length - 1; i >= 0; i--) if(pred(e[i])) return e[i]; return null; }
  function lastHumanOut(l){ return lastWhere(l, e => e && e.actor === 'human' && e.direction === 'out'); }
  function replyPending(l){
    if(!l || !l.family_last_reply_at) return false;
    const after = lastWhere(l, e => e && e.actor === 'human' && e.direction === 'out' && e.at > l.family_last_reply_at);
    return !after;
  }
  /* "Last: voicemail Tue 8:12 am" · "Last: 14-min call Thu 3:40 pm" · "They texted Tue 10:47 am" */
  function lastEventWords(l, now){
    const h = lastHumanOut(l), f = lastWhere(l, e => e && e.direction === 'in' && e.actor === 'family' && e.outcome !== 'inquiry');
    const pick = (h && f) ? (h.at > f.at ? h : f) : (h || f);
    if(!pick) return '';
    if(pick === f) return 'They ' + (f.channel === 'call' ? 'called' : f.channel === 'email' ? 'emailed' : 'texted') + ' ' + whenWords(f.at, now);
    const o = String(h.outcome || '').replace('_', ' ');
    const dur = h.duration_s ? Math.round(h.duration_s / 60) + '-min ' : '';
    const what = o === 'connected' ? dur + 'call, we talked' : o === 'requested callback' ? 'they asked us to call back' : o === 'sent' ? (h.channel === 'sms' ? 'we texted' : 'we emailed') : o;
    return 'Last: ' + what + ' ' + whenWords(h.at, now) + (h.note ? ' · "' + String(h.note).slice(0, 80) + '"' : '');
  }
  function attemptsWords(l){ const n = evts(l).filter(e => e && e.actor === 'human' && e.direction === 'out' && e.channel === 'call' && (e.outcome === 'voicemail' || e.outcome === 'no_answer')).length || Number(l && l.contact_attempts) || 0; return n ? (n + ' ' + (n === 1 ? 'try' : 'tries') + ', not reached') : ''; }
  function asmtNext(ctx){
    const t = ctx.today, list = (ctx.assessments || []).slice();
    const booked = list.filter(a => a && a.status === 'Scheduled' && a.visit_date && a.visit_date >= t).sort((a, b) => a.visit_date.localeCompare(b.visit_date))[0];
    if(booked) return { kind:'booked', day:booked.visit_date, iso:chicagoInstant(booked.visit_date, '09:00') };
    const at = ctx.lead && ctx.lead.assessment_at ? whenISO(ctx.lead.assessment_at, Date.parse(ctx.now)) : null;
    if(at && at >= ctx.now) return { kind:'booked', day:chicago(at).ymd, iso:at, timed:true };
    if(at && !list.length && at < ctx.now) return { kind:'plan', day:chicago(at).ymd };
    const done = list.find(a => a && (a.status === 'Completed — Awaiting Plan' || (a.status === 'Scheduled' && a.visit_date && a.visit_date < t)));
    if(done) return { kind:'plan', day:done.visit_date || t };
    return null;
  }
  /* ── Stage 4: authorization is an EVENT, and the state has a clock ──────────────────────────────────────────────────
     The Payer tab setting "where the state is" to authorized stamps authorization_received_at once (markAuthorized). Until a
     person has reached out after it, the family is "Authorized today · call the family" at the top of the board and on My
     Work. The 10/21-day DSDS rule the old State Submissions list kept (amber at 10 days, red at 21) lives on the waiting row:
     at 21 days with the state the row comes up as "call DSDS", and "Called DSDS" restarts that clock. */
  function markAuthorized(l, prevStatus, nowIso){
    const now = nowIso || new Date().toISOString();
    if(!l || l.state_status !== 'authorized' || prevStatus === 'authorized' || l.authorization_received_at) return false;
    l.authorization_received_at = now;
    l.comm_log = Array.isArray(l.comm_log) ? l.comm_log : [];
    l.comm_log.push({ body:'Authorization received from the state', at:now, kind:'authorization_received' });
    return true;
  }
  function authorizationPending(l){
    if(!l || !l.authorization_received_at) return false;
    const after = lastWhere(l, e => e && e.actor === 'human' && e.direction === 'out' && e.at > l.authorization_received_at);
    return !after;
  }
  const DSDS_AMBER_DAYS = 10, DSDS_RED_DAYS = 21;
  /* days the state has had it, counted from the submission (or the waiting record's since), restarted by "Called DSDS" */
  function stateDays(l, w, today){
    const since = (l.dsds_called_at && chicago(l.dsds_called_at).ymd) || (w && w.since) || (l.state_submitted ? String(l.state_submitted).slice(0, 10) : null);
    return since && isYmd(since) ? Math.max(0, daysBetween(since, today)) : null;
  }
  function boardRow(l, ctx){
    ctx = Object.assign({ now:new Date().toISOString() }, ctx || {}); ctx.lead = l;
    const now = ctx.now, today = ctx.today || chicago(now).ymd, stage = ctx.stage || 'new', hours = ctx.hours || responseHours({});
    const name = ctx.name || String((l.client_first_name || '') + ' ' + (l.client_last_name || '')).trim() || String((l.first_name || '') + ' ' + (l.last_name || '')).trim() || '(no name)';
    const caller = String((l.first_name || '') + ' ' + (l.last_name || '')).trim(), callerFirst = (l.first_name || '').trim() || 'them';
    const clientFirst = (l.client_first_name || '').trim();
    const why = whyCalled(l) || (l.relationship ? dayCap(String(l.relationship).toLowerCase()) + ' calling' + (clientFirst && clientFirst !== caller ? ' about ' + clientFirst : '') : (caller && caller !== name ? caller + ' called' : ''));
    const pay = l.funding_source ? (ctx.payer_label || PAYER_WORDS[l.funding_source] || l.funding_source) : '';
    const need = [desiredStartWords(l, today), pay, scheduleWords(l), String(l.client_city || '').trim()].filter(Boolean);
    const src = [l.source, ctx.referral || l.referral_source_name].filter(Boolean).join(' · ');
    const last = [lastEventWords(l, now), src, l.phone].filter(Boolean).join(' · ');
    const chips = missing(l, stage).map(m => ({ text:m.short, tone:'missing' }));
    const fl = flags(l, ctx); fl.forEach(f => chips.unshift({ text:f.text, tone:f.tone, key:f.key }));
    if(l.do_not_contact) chips.unshift({ text:'do not contact', tone:'bad' });
    const aw = attemptsWords(l); if(aw && stage === 'reaching_out') chips.push({ text:aw, tone:'warn' });
    const fa = firstAttemptState(l, hours, now), w = waiting(l), jn = ctx.journey_next, asm = asmtNext(ctx);
    const R = (group, rank, sort, when, next, primary, secondary, reason) => ({ group, rank, sort, when, next, primary, secondary:secondary || [], reason,
      name, why, need:need.join(' · '), last, chips, owner:String(l.assigned_coordinator || '').trim() });
    const CALL = { kind:'call', label:'Call' }, LOG = { kind:'log', label:'Log call' }, FU = { kind:'followup', label:'Set follow-up' }, SCH = { kind:'schedule', label:'Schedule assessment' };
    /* ── Need you now ── */
    if(stage === 'new' && fa && fa.running && !fa.attempted){
      const big = 'NEW · ' + minsWords(fa.open_minutes);
      if(fa.overdue) return R('now', 0, now, { big, sub:'OVERDUE: first call was due at 5 minutes', tone:'red' }, { text:'Call ' + callerFirst + ': first attempt', sub:dayCap(fa.came_in) + ' · ' + fa.ack }, CALL, [LOG], 'new_overdue');
      return R('now', 1, now, { big, sub:'first call due in ' + Math.max(0, FIRST_ATTEMPT_MINUTES - fa.open_minutes) + ' min', tone:'red' }, { text:'Call ' + callerFirst + ': first attempt', sub:dayCap(fa.came_in) + ' · ' + fa.ack }, CALL, [LOG], 'new_running');
    }
    if(replyPending(l)){
      const mins = Math.round((Date.parse(now) - Date.parse(l.family_last_reply_at)) / 60000);
      const big = 'Replied ' + (mins < 60 ? mins + ' min ago' : chicago(l.family_last_reply_at).ymd === chicago(now).ymd ? 'at ' + clockWords(l.family_last_reply_at) : whenWords(l.family_last_reply_at, now));
      return R('now', 2, l.family_last_reply_at, { big, sub:'waiting for a person to answer', tone:'red' }, { text:'Answer ' + callerFirst, sub:last }, { kind:'text', label:'Text back' }, [CALL, LOG], 'replied');
    }
    if(l.promised_callback_at){
      const p = new Date(l.promised_callback_at).toISOString(), h = lastHumanOut(l);
      const kept = h && h.at >= p;
      if(!kept && p <= now){
        const late = Math.round((Date.parse(now) - Date.parse(p)) / 60000);
        return R('now', 3, p, { big:'Call promised ' + whenWords(p, now), sub:minsWords(late) + ' late', tone:'red' }, { text:'Call ' + callerFirst + ' back: we said ' + whenWords(p, now), sub:last }, CALL, [LOG, SCH], 'promise_late');
      }
      if(!kept && p > now) return R('later', 0, p, { big:clockWords(p), sub:'callback we promised', tone:'navy' }, { text:'Call ' + callerFirst + ' back', sub:last }, CALL, [LOG], 'promise_future');
    }
    if(authorizationPending(l)){
      const d = chicago(l.authorization_received_at).ymd;
      return R('now', 4, l.authorization_received_at, { big:'Authorized ' + dayWords(d, today), sub:'the state said yes: call the family', tone:'green' },
        { text:'Call ' + callerFirst + ': authorized, pick a start week', sub:last }, CALL, [LOG], 'authorized');
    }
    if(ctx.drafts && ctx.drafts.length) return R('now', 6.5, now, { big:'Draft ready', sub:'an AI follow-up is waiting for your approval', tone:'amber' },
      { text:'Review the draft, then send or drop it', sub:last }, { kind:'draft', label:'Review draft', id:ctx.drafts[0] }, [CALL, LOG], 'draft_ready');
    if(asm && asm.kind === 'plan') return R('now', 6, asm.day, { big:'Assessment done ' + dayWords(asm.day, today), sub:'plan not written', tone:'amber' }, { text:'Write the care plan', sub:last }, { kind:'open_asmt', label:'Open assessment' }, [CALL], 'asmt_plan');
    if(asm && asm.kind === 'booked'){
      const big = asm.timed ? clockWords(asm.iso) : dayCap(dayWords(asm.day, today));
      return R('later', 1, asm.iso, { big, sub:'assessment at the home', tone:'navy' }, { text:'Do the assessment, then the outcome', sub:last }, { kind:'open_asmt', label:'Open assessment' }, [CALL], 'asmt_booked');
    }
    const urgent = startRank(l, today) <= 1;
    if(urgent && !w && ['reaching_out', 'connected', 'deciding', 'assessment'].indexOf(stage) > -1){
      const words = desiredStartWords(l, today), disch = fl.find(f => f.key === 'urgent_discharge');
      return R('now', disch ? 4.5 : 5, now, { big:words, sub:disch ? (disch.text.split(':')[0].toLowerCase() + ', assessment not booked') : 'assessment not booked yet', tone:disch ? 'red' : 'amber' }, { text:'Book the assessment' + (/by /.test(words) ? ' before ' + words.split('by ')[1] : ' now'), sub:last }, SCH, [CALL, LOG], 'urgent_start');
    }
    /* item 5: 45 days with the state (the case manager call and the bridge-hours offer) outranks the 21-day DSDS call */
    const ml = medicaidLong(l, ctx);
    if(ml) return R('now', 7.5, w && w.since || today, { big:'With the state ' + ml.days + ' days', sub:ml.bridge_offered ? 'bridge hours offered; call the case manager' : 'call the case manager, offer private bridge hours', tone:'red' },
      { text:'Call the case manager about ' + (clientFirst || 'the authorization') + ', then ' + callerFirst + (ml.bridge_offered ? '' : ': offer private hours while the state decides'), sub:(w && w.note) || last }, CALL, [{ kind:'case_manager', label:'Called the case manager' }].concat(ml.bridge_offered ? [] : [{ kind:'bridge', label:'Offered bridge hours' }]), 'medicaid_45');
    if(w && w.check_back && w.check_back <= today){
      const lateDays = daysBetween(w.check_back, today), on = WAITING[w.reason].on;
      const nextText = w.reason === 'state' ? 'Check Fusion, then call the family' : w.reason === 'family_decision' ? 'Call ' + callerFirst + ': have they decided?' : w.reason === 'unable_to_reach' ? 'One more try, then the next step' : 'Check in with ' + callerFirst;
      return R('now', 8, w.check_back, { big:lateDays ? 'Check back ' + lateDays + (lateDays === 1 ? ' day' : ' days') + ' late' : 'Check back today', sub:on + ' since ' + dayWords(w.since || today, today), tone:lateDays ? 'red' : 'amber' }, { text:nextText, sub:(w.note || last) }, CALL, [LOG, FU], 'check_back_due');
    }
    if(w){
      const sd = w.reason === 'state' ? stateDays(l, w, today) : null;
      if(sd != null && sd >= DSDS_RED_DAYS) return R('now', 8, w.since || today, { big:'With the state ' + sd + ' days', sub:'call DSDS (the 21-day rule)', tone:'red' },
        { text:'Call DSDS about the authorization, then ' + callerFirst, sub:(w.note || last) }, CALL, [{ kind:'dsds', label:'Called DSDS' }, LOG], 'dsds_21');
      const sub = (w.since ? 'since ' + dayWords(w.since, today) : '') + (sd != null && sd >= DSDS_AMBER_DAYS ? ' · ' + sd + ' days, follow up soon' : '');
      return R('waiting', 0, w.check_back || '9999', { big:WAITING[w.reason].on, sub, tone:sd != null && sd >= DSDS_AMBER_DAYS ? 'amber' : 'muted' },
        { text:(w.check_back ? 'Next check ' + dayCap(dayWords(w.check_back, today)) : 'Set a check-back date'), sub:(w.note || last) }, w.check_back ? { kind:'open', label:'Open' } : FU, w.reason === 'state' ? [{ kind:'dsds', label:'Called DSDS' }, CALL] : [CALL], 'waiting');
    }
    if(stage === 'new' && fa && !fa.running) return R('later', 0, fa.start, { big:clockWords(fa.start), sub:'first call · ' + fa.came_in, tone:'navy' }, { text:'Call ' + callerFirst + ' when we open', sub:fa.ack }, CALL, [LOG], 'new_before_open');
    const fu = String(l.follow_up_due || '').slice(0, 10);
    if(fu && fu < today){
      const d = daysBetween(fu, today);
      return R('now', 7, fu, { big:'Follow-up ' + d + (d === 1 ? ' day' : ' days') + ' late', sub:'was due ' + dayWords(fu, today), tone:'red' }, { text:jn ? jn.title : 'Follow up with ' + callerFirst, sub:last }, CALL, [LOG, FU], 'followup_late');
    }
    if(fu && fu >= today){
      const iso = chicagoInstant(fu, String(l.follow_up_time || '09:00'));
      return R('later', 2, iso, { big:l.follow_up_time ? clockWords(iso) : (fu === today ? 'Today' : dayCap(dayWords(fu, today))), sub:'follow-up' + (l.follow_up_note ? ': ' + String(l.follow_up_note).slice(0, 60) : l.follow_up_time ? '' : ' (no time set)'), tone:'navy' }, { text:l.follow_up_note ? String(l.follow_up_note) : (jn ? jn.title : 'Follow up with ' + callerFirst), sub:last }, CALL, [LOG, FU], 'followup_future');
    }
    if(l.funding_source === 'medicaid' && ['submitted', 'assessed'].indexOf(String(l.state_status || '')) > -1){
      const sd = stateDays(l, null, today);
      if(sd != null && sd >= DSDS_RED_DAYS) return R('now', 8, String(l.state_submitted).slice(0, 10), { big:'With the state ' + sd + ' days', sub:'call DSDS (the 21-day rule)', tone:'red' },
        { text:'Call DSDS about the authorization, then ' + callerFirst, sub:last }, CALL, [{ kind:'dsds', label:'Called DSDS' }, FU], 'dsds_21');
      return R('waiting', 1, '9999', { big:'The state', sub:(l.state_submitted ? 'since ' + dayWords(String(l.state_submitted).slice(0, 10), today) : 'submitted') + (sd != null && sd >= DSDS_AMBER_DAYS ? ' · ' + sd + ' days, follow up soon' : ''), tone:sd != null && sd >= DSDS_AMBER_DAYS ? 'amber' : 'muted' }, { text:'Set a check-back date', sub:last }, FU, [CALL], 'waiting_state_nodate');
    }
    /* item 5: the assessment is overdue for how soon they need care; a decision with no reason after 7 days */
    const ao = assessmentOverdue(l, ctx);
    if(ao) return R('now', 5.5, now, { big:'Assessment overdue', sub:ao.days + ' days since we talked; target ' + ao.target, tone:'amber' }, { text:'Book the assessment with ' + callerFirst + ', or say what we are waiting on', sub:last }, SCH, [CALL, { kind:'waiting', label:'Waiting on…' }], 'asmt_overdue');
    const ds = decisionStale(l, ctx);
    if(ds) return R('now', 6.8, now, { big:'Deciding ' + ds.days + ' days', sub:'over ' + DECISION_DAYS + ': it needs a reason', tone:'amber' }, { text:'What are we waiting on with ' + callerFirst + '? Give it a reason, or mark it lost', sub:last }, { kind:'waiting', label:'Waiting on…' }, [CALL, { kind:'lost', label:'Mark lost…' }], 'decision_stale');
    if(stage === 'reaching_out'){
      const cn = cadenceNext(l, ctx);
      if(cn && cn.step === 'park') return R('now', 9, now, { big:'No next step', sub:aw || 'tried, not reached', tone:'amber' }, { text:cn.words, sub:last }, { kind:'waiting', label:'Waiting on…' }, [CALL, LOG], 'no_next_step');
      return R('now', 9, now, { big:'No next step', sub:aw || 'tried, not reached', tone:'amber' }, { text:cn ? cn.words : 'Try ' + callerFirst + ' again, or set a follow-up', sub:last }, CALL, [cn ? { kind:'followup', label:'Set follow-up', suggest:{ day:cn.day, time:cn.time } } : FU, LOG], 'no_next_step');
    }
    return R('now', 9, now, { big:'No next step', sub:'nothing scheduled', tone:'amber' }, { text:jn ? jn.title : 'Set the next step with ' + callerFirst, sub:last }, FU, [CALL, LOG], 'no_next_step');
  }
  /* the group order and the within-group order */
  function boardSort(a, b){
    const g = { now:0, later:1, waiting:2 };
    return (g[a.group] - g[b.group]) || (a.group === 'now' ? (a.rank - b.rank) || String(a.sort).localeCompare(String(b.sort)) : String(a.sort).localeCompare(String(b.sort)) || (a.rank - b.rank));
  }
  /* "Today" · "Tomorrow" · "Thursday" · "Oct 20": the Scheduled group's day headers */
  function dayHeader(sortIso, today){
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(sortIso)) ? String(sortIso) : chicago(sortIso).ymd;
    const n = daysBetween(today, d); if(n <= 0) return 'Today'; if(n === 1) return 'Tomorrow';
    if(n < 7) return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(d + 'T12:00:00Z').getUTCDay()];
    return MONTH_SHORT[new Date(d + 'T12:00:00Z').getUTCMonth()] + ' ' + new Date(d + 'T12:00:00Z').getUTCDate();
  }

  /* ── the owners' numbers (Stage 5): what the Owners Hub shows about lead response and losses ───────────────────────
     Counts only, from facts the earlier stages write; no names leave this function except the owners' first names.
     A period = inquiries that came in during it (spam never counts). Speed is measured from the clock start (lead
     response hours), never from a 9 pm form post. */
  function median(xs){ const a = xs.filter(x => x != null && !isNaN(x)).sort((p, q) => p - q); if(!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); }
  function hoursOf(l){ const s = schedule(l); if(l && l.lost_schedule && l.lost_schedule.hours_per_week) return Number(l.lost_schedule.hours_per_week) || 0; return s && s.hours_per_week ? Number(s.hours_per_week) || 0 : 0; }
  function periodNumbers(leads, hours, from, to, now, opts){
    const inP = iso => iso && String(new Date(iso).toISOString()) >= from && String(new Date(iso).toISOString()) < to;
    const real = (leads || []).filter(l => l && !(l.spam && l.spam.at));
    const came = real.filter(l => inP(l.created_at));
    const mins = l => { const st = clockStart(l, hours); return st && l.first_human_attempt_at ? Math.max(0, Math.round((Date.parse(l.first_human_attempt_at) - Date.parse(st)) / 60000)) : null; };
    const attempted = came.filter(l => l.first_human_attempt_at);
    const reached24 = came.filter(l => l.first_human_contact_at && (Date.parse(l.first_human_contact_at) - Date.parse(clockStart(l, hours))) <= 24 * 36e5);
    const stale = came.filter(l => !l.first_human_attempt_at && !l.said_yes_at && l.status !== 'Lost' && (Date.parse(now) - Date.parse(clockStart(l, hours))) > 24 * 36e5);
    const bucket = m => m == null ? 'never' : m <= 5 ? '≤5 min' : m <= 15 ? '5–15 min' : m <= 60 ? '15–60 min' : m <= 240 ? '1–4 h' : 'over 4 h';
    const buckets = { '≤5 min':0, '5–15 min':0, '15–60 min':0, '1–4 h':0, 'over 4 h':0, 'never':0 };
    came.forEach(l => { buckets[bucket(mins(l))]++; });
    const yes = real.filter(l => inP(l.said_yes_at || (l.status === 'Converted' ? l.converted_at : null)));
    const toYes = yes.map(l => l.created_at ? daysBetween(chicago(l.created_at).ymd, chicago(l.said_yes_at || l.converted_at).ymd) : null);
    /* started = first shift happened in the period (first_shift_at, stamped by the client journey when AxisCare shows the first clock-in) */
    const started = real.filter(l => inP(l.first_shift_at));
    const yesToShift = started.map(l => (l.said_yes_at || l.converted_at) ? daysBetween(chicago(l.said_yes_at || l.converted_at).ymd, chicago(l.first_shift_at).ymd) : null);
    /* referral partners (the Hub's referral_orgs, by id; else the typed referral name) */
    const orgs = (opts && opts.orgs) || {};
    const partners = {};
    came.forEach(l => { const key = l.referral_org_id ? 'org:' + l.referral_org_id : (String(l.referral_source_name || '').trim() ? 'name:' + String(l.referral_source_name).trim().toLowerCase() : null); if(!key) return;
      const o = orgs[l.referral_org_id] || {}; const r = partners[key] = partners[key] || { key, name:o.name || String(l.referral_source_name || '').trim(), type:o.type || '', sent:0, reached_24h:0, assessed:0, said_yes:0, started:0, days_to_start:[], hours:0 };
      r.sent++; if(reached24.indexOf(l) > -1) r.reached_24h++; if(l.assessment_at || (l.status && l.status !== 'New' && l.status !== 'Contacted' && l.status !== 'Lost')) r.assessed++; if(l.said_yes_at || l.status === 'Converted') r.said_yes++;
      if(l.first_shift_at){ r.started++; r.hours += hoursOf(l); r.days_to_start.push(daysBetween(chicago(l.created_at).ymd, chicago(l.first_shift_at).ymd)); } });
    const lost = real.filter(l => l.status === 'Lost' && inP(l.lost_at || (inP(l.created_at) ? l.created_at : null)));
    const lostAfterYes = lost.filter(l => l.said_yes_at || l.said_yes_undone === undefined && l.converted_at && l.lost_at && l.converted_at < l.lost_at);
    const byReason = {};
    lost.forEach(l => { const k = lostKey(l) || 'other'; const r = byReason[k] = byReason[k] || { key:k, label:LOST_LABEL[k] || (k === 'spam' ? 'Spam' : k === 'not_ready_legacy' ? 'Not ready yet (older reason)' : 'Other'), count:0, hours:0, towns:{} };
      r.count++; r.hours += hoursOf(l); const town = String((l.lost_schedule && l.lost_schedule.city) || l.client_city || '').trim(); if(town && LOST_STAFFING.indexOf(k) > -1) r.towns[town] = (r.towns[town] || 0) + 1; });
    /* item 4 (2026-10-07): the funnel for this period's inquiries, by source, and the team columns (late at 5, misses at 30, backup takes) */
    const assessed = l => !!(l.assessment_at || (l.status && ['New', 'Contacted', 'Lost'].indexOf(l.status) < 0) || (Array.isArray(l.contact_events) && false));
    const won = l => !!(l.said_yes_at || l.status === 'Converted');
    const funnel = { inquiries:came.length, contacted:came.filter(l => l.first_human_contact_at).length, assessed:came.filter(assessed).length, won:came.filter(won).length, started:came.filter(l => l.first_shift_at).length };
    const sources = {};
    came.forEach(l => { const src = String(l.source || 'Other').trim() || 'Other'; const sub = src === 'Referral' ? (SUBTYPE_LABEL[l.referral_subtype] || (opts && opts.orgs && l.referral_org_id && SUBTYPE_LABEL[referralSubtype(l, opts.orgs[l.referral_org_id])]) || '') : '';
      const k = src + (sub ? ' · ' + sub : ''); const r = sources[k] = sources[k] || { source:k, inquiries:0, contacted:0, won:0, started:0, hours:0 };
      r.inquiries++; if(l.first_human_contact_at) r.contacted++; if(won(l)) r.won++; if(l.first_shift_at){ r.started++; r.hours += hoursOf(l); } });
    const owners = {};
    came.forEach(l => { const o = String(l.assigned_coordinator || '').trim().split(/\s+/)[0] || 'Nobody'; const r = owners[o] = owners[o] || { owner:o, inquiries:0, mins:[], reached_24h:0, never_attempted:0, said_yes:0, late:0, misses:0, took:0 };
      r.inquiries++; const m = mins(l); if(m != null) r.mins.push(m); if(reached24.indexOf(l) > -1) r.reached_24h++; if(stale.indexOf(l) > -1) r.never_attempted++; if(l.said_yes_at) r.said_yes++;
      if(l.rungs && l.rungs.owner_at) r.late++; });
    /* a miss is counted against the owner at the time (speed_miss.owner is their email; fold back to a first name through opts.names {email:name}); a backup who took an inquiry gets the take */
    const nameOf = e => { const n = opts && opts.names && opts.names[String(e || '').toLowerCase()]; const f = (n ? String(n) : String(e || '').split('@')[0]).split(/\s+/)[0]; return f.charAt(0).toUpperCase() + f.slice(1); };
    came.forEach(l => { if(l.speed_miss && l.speed_miss.owner){ const o = nameOf(l.speed_miss.owner); const r = owners[o] = owners[o] || { owner:o, inquiries:0, mins:[], reached_24h:0, never_attempted:0, said_yes:0, late:0, misses:0, took:0 }; r.misses++; }
      (Array.isArray(l.comm_log) ? l.comm_log : []).forEach(n => { if(n && n.kind === 'owner' && /took this inquiry/.test(String(n.body || ''))){ const o = String(n.body).split(' ')[0]; const r = owners[o] = owners[o] || { owner:o, inquiries:0, mins:[], reached_24h:0, never_attempted:0, said_yes:0, late:0, misses:0, took:0 }; r.took++; } }); });
    return { from, to, inquiries:came.length, attempted:attempted.length, median_first_attempt_min:median(came.map(mins)), reached_24h:reached24.length,
      reached_24h_pct:came.length ? Math.round(reached24.length / came.length * 100) : null, never_attempted:stale.length, buckets,
      said_yes:yes.length, inquiry_to_yes_median_days:median(toYes), started:started.length, yes_to_first_shift_median_days:median(yesToShift), lost:lost.length, lost_after_yes:lostAfterYes.length,
      by_partner:Object.values(partners).map(r => ({ key:r.key, name:r.name, type:r.type, sent:r.sent, reached_24h:r.reached_24h, assessed:r.assessed, said_yes:r.said_yes, started:r.started, days_to_start_median:median(r.days_to_start), hours:r.hours })).sort((a, b) => b.sent - a.sent || b.started - a.started),
      lost_hours_week:lost.reduce((a, l) => a + hoursOf(l), 0), by_reason:Object.values(byReason).sort((a, b) => b.hours - a.hours || b.count - a.count),
      funnel, by_source:Object.values(sources).sort((a, b) => b.inquiries - a.inquiries),
      by_owner:Object.values(owners).map(o => ({ owner:o.owner, inquiries:o.inquiries, median_first_attempt_min:median(o.mins), reached_24h:o.reached_24h, never_attempted:o.never_attempted, said_yes:o.said_yes, late:o.late, misses:o.misses, took:o.took })).sort((a, b) => b.inquiries - a.inquiries) };
  }
  function ownerNumbers(leads, hours, opts){
    opts = opts || {}; const now = opts.now || new Date().toISOString(), days = Number(opts.days) || 30;
    const to = now, from = new Date(Date.parse(now) - days * 864e5).toISOString(), before = new Date(Date.parse(from) - days * 864e5).toISOString();
    return { days, now:periodNumbers(leads, hours, from, to, now, opts), prior:periodNumbers(leads, hours, before, from, now, opts) };
  }

  /* item 4 (2026-10-07): the Medicaid pipeline right now: who is waiting on the state, who heard from us this week, who is
     over 45 days (the case-manager call), who was offered private bridge hours, and the hours a week waiting */
  const MEDICAID_LONG_DAYS = 45;
  function medicaidPipeline(leads, today, nowIso){
    today = today || ymd(new Date()); const now = nowIso || new Date().toISOString();
    const real = (leads || []).filter(l => l && !(l.spam && l.spam.at) && !l.archived && l.funding_source === 'medicaid' && !l.said_yes_at && !l.first_shift_at && String(l.status || '') !== 'Lost');
    const waitingL = real.filter(l => { const w = waiting(l); return (w && w.reason === 'state') || ['submitted', 'assessed'].indexOf(String(l.state_status || '')) > -1; });
    const weekAgo = new Date(Date.parse(now) - 7 * 864e5).toISOString();
    const touched = l => evts(l).some(e => e && e.actor === 'human' && e.direction === 'out' && e.at >= weekAgo) || (Array.isArray(l.partner_msgs) && l.partner_msgs.some(m => m && m.at >= weekAgo));
    const days = l => stateDays(l, waiting(l), today);
    const over = waitingL.filter(l => { const d = days(l); return d != null && d >= MEDICAID_LONG_DAYS; });
    return { waiting:waitingL.length, checked_in_week:waitingL.filter(touched).length, over_45:over.length, bridge_offered:waitingL.filter(l => l.bridge_hours_offered_at).length,
      hours_week:waitingL.reduce((a, l) => a + hoursOf(l), 0), median_days:median(waitingL.map(days)), long_days:MEDICAID_LONG_DAYS };
  }
  /* "N missing required": across the working inquiries, how many are missing something their stage needs (the manager chip) */
  function missingRequired(leads, stageOf){
    const real = (leads || []).filter(l => l && !(l.spam && l.spam.at) && !l.archived && !l.said_yes_at && ['Lost', 'Converted'].indexOf(String(l.status || '')) < 0);
    const stage = l => (typeof stageOf === 'function' && stageOf(l)) || (l.assessment_at ? 'assessment' : l.first_human_contact_at ? 'deciding' : 'new');
    const rows = real.map(l => ({ id:l.id, owner:String(l.assigned_coordinator || '').trim().split(/\s+/)[0] || 'Nobody', missing:missing(l, stage(l)) })).filter(r => r.missing.length);
    const byOwner = {}; rows.forEach(r => { byOwner[r.owner] = (byOwner[r.owner] || 0) + 1; });
    return { count:rows.length, by_owner:byOwner, rows };
  }

  /* ── THE SMALL RULES (item 5 of her design, 2026-10-07) ─────────────────────────────────────────────────────────────────
     decision over 7 days needs a reason · the assessment is overdue by how soon they need care · 45 days with the state
     means a call to the case manager and an offer of private bridge hours · the contact cadence is a SUGGESTED next try
     on the owner's desk (today, later today, Day 1, Day 3, Day 7, then park as unable to reach), never a message ·
     at the yes: what carried forward, and what goes out now as drafts. */
  const ASMT_TARGET_DAYS = { 0:1, 1:2, 2:5, 3:14, 4:14 };   /* days from the first real conversation to a booked assessment, by how soon they need care */
  const DECISION_DAYS = 7;
  function daysSinceContact(l, today){ return l && l.first_human_contact_at ? daysBetween(chicago(l.first_human_contact_at).ymd, today) : null; }
  /* talked, nothing booked, not waiting, and past the target for their urgency */
  function assessmentOverdue(l, ctx){
    ctx = ctx || {}; const today = ctx.today || ymd(new Date());
    if(!l || !l.first_human_contact_at || l.said_yes_at || String(l.status || '') === 'Lost' || waiting(l)) return null;
    const asm = asmtNext(Object.assign({}, ctx, { lead:l, now:ctx.now || new Date().toISOString(), today })); if(asm) return null;
    if((ctx.assessments || []).some(a => a && /complete/i.test(String(a.status || '')))) return null;
    const target = ASMT_TARGET_DAYS[startRank(l, today)], d = daysSinceContact(l, today);
    return d != null && d > target ? { days:d, target } : null;
  }
  /* reached, no assessment, no promise, no waiting reason, and more than 7 days deciding: give it a reason */
  function decisionStale(l, ctx){
    ctx = ctx || {}; const today = ctx.today || ymd(new Date());
    if(!l || !l.first_human_contact_at || l.said_yes_at || String(l.status || '') === 'Lost' || waiting(l) || l.promised_callback_at) return null;
    const asm = asmtNext(Object.assign({}, ctx, { lead:l, now:ctx.now || new Date().toISOString(), today })); if(asm) return null;
    const d = daysSinceContact(l, today);
    return d != null && d > DECISION_DAYS ? { days:d } : null;
  }
  /* the suggested next try for a family we have not reached (a suggestion on the desk; the person sets it) */
  function cadenceNext(l, ctx){
    ctx = ctx || {}; const now = ctx.now || new Date().toISOString(), today = ctx.today || chicago(now).ymd;
    if(!l || l.first_human_contact_at || l.said_yes_at || String(l.status || '') === 'Lost' || waiting(l)) return null;
    const tries = evts(l).filter(e => e && e.actor === 'human' && e.direction === 'out').length || Number(l.contact_attempts) || 0;
    const last = lastHumanOut(l); if(!tries || !last) return null;
    const lastDay = chicago(last.at).ymd, c = chicago(now);
    if(tries === 1){ const hm = Number(c.hm.slice(0, 2)); return hm < 15 && lastDay === today ? { step:'later today', day:today, time:(String(hm + 3).padStart(2, '0')) + ':00', words:'Try again later today, a different time of day often lands (2nd try)' } : { step:'day 1', day:addDays(lastDay, 1), time:'09:00', words:'Try again tomorrow morning (2nd try)' }; }
    if(tries === 2) return { step:'day 1', day:addDays(lastDay, 1), time:'', words:'Try again ' + dayWords(addDays(lastDay, 1), today) + ' (3rd try), a text with two assessment times helps' };
    if(tries === 3) return { step:'day 3', day:addDays(lastDay, 2), time:'', words:'One more try ' + dayWords(addDays(lastDay, 2), today) + ' (4th), then a closing-the-loop call' };
    if(tries === 4) return { step:'day 7', day:addDays(lastDay, 4), time:'', words:'Closing-the-loop call ' + dayWords(addDays(lastDay, 4), today) + ' (5th try)' };
    return { step:'park', day:null, time:'', words:'Five tries and no answer: park them as unable to reach (check back in 14 days)' };
  }
  /* 45 days with the state: the case manager gets a call and the family an offer of private bridge hours */
  function medicaidLong(l, ctx){
    ctx = ctx || {}; const today = ctx.today || ymd(new Date());
    if(!l || l.funding_source !== 'medicaid' || l.said_yes_at || String(l.status || '') === 'Lost') return null;
    const w = waiting(l); const on = (w && w.reason === 'state') || ['submitted', 'assessed'].indexOf(String(l.state_status || '')) > -1; if(!on) return null;
    const d = stateDays(l, w, today); if(d == null || d < MEDICAID_LONG_DAYS) return null;
    const called = l.case_manager_called_at && daysBetween(chicago(l.case_manager_called_at).ymd, today) < 7;
    return called ? null : { days:d, bridge_offered:!!l.bridge_hours_offered_at };
  }
  /* at the yes: what carried forward (read only) and what goes out now (drafts a person sends) */
  function carriedForward(l, ctx){
    ctx = ctx || {}; const today = ctx.today || ymd(new Date()), org = ctx.org || null, d = iso => iso ? dayWords(chicago(iso).ymd, today) : '';
    const parts = [];
    const src = [l.source, partnerName(l, org), SUBTYPE_LABEL[referralSubtype(l, org)] || ''].filter(Boolean).join(' · ');
    parts.push((src || 'Inquiry') + (l.created_at ? ' ' + d(l.created_at) : ''));
    if(l.first_human_contact_at) parts.push('reached ' + d(l.first_human_contact_at));
    if(l.assessment_at) parts.push('assessment ' + d(l.assessment_at));
    if(l.said_yes_at) parts.push('yes ' + d(l.said_yes_at));
    const pay = l.funding_source ? PAYER_WORDS[l.funding_source] || l.funding_source : '';
    return parts.join(' → ') + (pay ? ' · ' + pay : '') + (desiredStartWords(l, today) ? ' · ' + desiredStartWords(l, today).replace(/^\w/, c => c.toLowerCase()) : '') + (scheduleWords(l) ? ' · ' + scheduleWords(l) : '');
  }
  function yesThanks(l, ctx){
    ctx = ctx || {}; const client = (l.client_first_name || '').trim(), caller = (l.first_name || '').trim();
    const v = { first:caller || 'there', client:client && client !== caller ? client : 'your loved one', me:String(ctx.me || 'your Care Coordinator').split(' ')[0] };
    return fill(String((ctx.scripts && ctx.scripts.yes_thanks) || SCRIPT_DEFAULT.yes_thanks), v);
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

  /* ── SPEED-TO-LEAD RUNGS (item 2 of her design, her "yes to all" 2026-10-07) ─────────────────────────────────────────
     5 minutes with no human attempt: the owner (one text, the board is already red). 15: the backup's desk, one text,
     Take it. 30: one notice to the Owner Escalation seat, and a counted miss against the owner. One per rung per lead,
     never repeated (stamped on lead.rungs). The clock is the lead-response-hours clock, so nothing runs at night. The
     server (lead-watch) decides WHO from the duty schedule; this decides WHETHER and WHICH, so the Hub shows the same. */
  const RUNGS_DEFAULT = { backup_min:15, manager_min:30 };
  function rungSettings(settings){
    const r = (settings && settings.lead_rungs) || {};
    const n = (v, d, lo) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= lo && x <= 240 ? x : d; };
    const backup = n(r.backup_min, RUNGS_DEFAULT.backup_min, FIRST_ATTEMPT_MINUTES + 1);
    return { backup_min:backup, manager_min:Math.max(n(r.manager_min, RUNGS_DEFAULT.manager_min, backup + 1), backup + 1) };
  }
  /* the rungs due now and not yet stamped: [{level:'owner'|'backup'|'manager', minutes}] (empty when the clock is not
     running, a person has tried, the lead is lost/archived/spam, or the clock started more than a day ago: the 24-hour
     "lead waiting" alert owns that) */
  function rungsDue(l, ctx){
    ctx = ctx || {}; const now = ctx.now || new Date().toISOString(), hours = ctx.hours || responseHours({}), set = rungSettings(ctx.settings);
    if(!l || l.archived || l.spam || l.is_spam || ['Lost', 'Converted'].indexOf(String(l.status || '')) > -1 || l.said_yes_at) return [];
    const fa = firstAttemptState(l, hours, now);
    if(!fa || !fa.running || fa.attempted) return [];
    if(fa.open_minutes > 24 * 60) return [];
    const st = l.rungs || {};
    const out = [];
    if(fa.open_minutes >= FIRST_ATTEMPT_MINUTES && !st.owner_at) out.push({ level:'owner', minutes:FIRST_ATTEMPT_MINUTES });
    if(fa.open_minutes >= set.backup_min && !st.backup_at) out.push({ level:'backup', minutes:set.backup_min });
    if(fa.open_minutes >= set.manager_min && !st.manager_at) out.push({ level:'manager', minutes:set.manager_min });
    return out;
  }
  /* the stamp: who was told, when, and at 30 the miss against the owner (for the owners' team numbers) */
  function stampRung(l, level, o, nowIso){
    const at = nowIso || new Date().toISOString(); o = o || {};
    l.rungs = Object.assign({}, l.rungs || {}, { [level + '_at']:at, [level + '_to']:String(o.to || ''), [level + '_sent']:o.sent !== false });
    if(level === 'manager' && !l.speed_miss) l.speed_miss = { at, owner:String(o.owner || l.assigned_coordinator || ''), minutes:Number(o.minutes) || RUNGS_DEFAULT.manager_min };
    return l;
  }
  const RUNG_WORDS = { owner:'the owner', backup:'the backup', manager:'Owner Escalation' };

  /* ── REFERRAL SUBTYPE, THE TWO FLAGS, AND THE PARTNER LOOP (item 3 of her design, 2026-10-07) ─────────────────────────
     subtype   who sent them, when a professional did: hospital · snf_rehab · case_manager · community · apfm · other.
               Stamped on the inquiry (referral_subtype) or read from the partner's record type.
     flags     urgent_discharge: a hospital or rehab referral who needs care within 3 days, until the assessment is done.
               staffing_risk: the requested days and times find fewer than 2 caregivers available (their own windows),
               until a Team Builder plan is linked (pre-matched).
     loop      what the referrer hears from us: a receipt when we reach the family, the assessment date, the outcome, and
               a weekly line to case managers while Medicaid is pending. ALWAYS a draft a person sends (her audience law);
               this only says which message is due and offers the words (Settings can replace them). */
  const SUBTYPE_LABEL = { hospital:'Hospital', snf_rehab:'Rehab / skilled nursing', case_manager:'Case manager', community:'Community', apfm:'A Place for Mom', other:'Other professional' };
  const SUBTYPE_KEYS = Object.keys(SUBTYPE_LABEL);
  const PROFESSIONAL = ['hospital', 'snf_rehab', 'case_manager', 'apfm', 'other'];
  function referralSubtype(l, org){
    if(!l) return '';
    if(SUBTYPE_KEYS.indexOf(l.referral_subtype) > -1) return l.referral_subtype;
    const t = String((org && org.type) || '').toLowerCase();
    if(!t) return '';
    if(/hospital/.test(t)) return 'hospital';
    if(/rehab|skilled|nursing/.test(t)) return 'snf_rehab';
    if(/physician|hospice|case|social/.test(t)) return 'case_manager';
    if(/assisted|senior|community|church|center/.test(t)) return 'community';
    return 'other';
  }
  function flags(l, ctx){
    ctx = ctx || {}; const today = ctx.today || ymd(new Date()), out = [];
    const sub = referralSubtype(l, ctx.org);
    const asmDone = (ctx.assessments || []).some(a => a && (/complete/i.test(String(a.status || '')) || (a.status === 'Scheduled' && a.visit_date && a.visit_date < today)));
    if((sub === 'hospital' || sub === 'snf_rehab') && startRank(l, today) <= 1 && !asmDone)
      out.push({ key:'urgent_discharge', tone:'bad', text:(sub === 'hospital' ? 'Hospital discharge' : 'Rehab discharge') + ': ' + String(desiredStartWords(l, today) || 'Needs care now').replace(/^\w/, c => c.toLowerCase()), why:'a discharge referral who needs care within days; the assessment is the next step' });
    /* Web referrals (2026-10-08): a professional marked it Urgent on mo-care.com. Red until someone has reached the referrer or the family. */
    if(l.referral_urgency === 'urgent' && !l.first_human_contact_at)
      out.push({ key:'urgent_referral', tone:'bad', text:'Urgent referral: call ' + (String((l.referrer && l.referrer.name) || '').trim().split(/\s+/)[0] || 'the referrer') + ' now', why:'the referring professional marked it urgent on the website' });
    if(ctx.people && !ctx.pre_matched){
      const look = staffingLook(l, ctx.people);
      if(look.asked && look.total && look.count < 2) out.push({ key:'staffing_risk', tone:'warn', text:'Staffing risk: ' + (look.count ? '1 caregiver' : 'nobody') + ' available ' + look.ask, why:'the requested days and times find ' + (look.count ? 'only one caregiver' : 'no caregiver') + ' with that window; talk to Staffing before promising a start' });
    }
    return out;
  }
  const PARTNER_KINDS = ['receipt', 'assessment', 'outcome_started', 'outcome_lost', 'weekly'];
  const PARTNER_LABEL = { receipt:'We reached the family', assessment:'Assessment scheduled', outcome_started:'The family chose us', outcome_lost:'The family did not start with us', weekly:'Weekly status while Medicaid is pending' };
  const PARTNER_DEFAULT = {   /* her words (reviewed 2026-10-07): drafts a person reads and sends */
    receipt:'Hi {partner}, this is {me} with Caring Companions. Thank you for referring {client} to us. We connected with {family} today and are working with the family on next steps. I will keep you updated as things move forward.',
    assessment:'Hi {partner}, a quick update on {client}: we connected with the family and have the in-home assessment scheduled for {day}. After the visit, I will let you know where things stand and the anticipated next step toward starting care.',
    outcome_started:'Hi {partner}, good news. {client}\'s family has chosen Caring Companions, and we are moving forward with care. The anticipated start is {start}. Thank you again for trusting us with your referral. We will take good care of them.',
    outcome_lost:'Hi {partner}, I wanted to close the loop on {client}. Care will not be starting with Caring Companions at this time. {reason} Thank you for thinking of us, and please keep us in mind whenever another family needs help.',
    weekly:'Hi {partner}, our weekly update on {client}: the Medicaid authorization is still pending with the state ({days} days so far). We are staying in touch with the family while they wait and are prepared to move to the next step once authorization is received. I will continue to keep you posted.',
  };
  /* the reason a referral partner hears: brief and appropriate to share; never the family's private details */
  const LOST_SHARE = { could_not_staff:'We were not able to staff the requested schedule.', outside_area:'The home is outside our service area.', price:'The family chose not to move forward at this time.', minimum_hours:'The family chose not to move forward at this time.',
    chose_agency:'The family chose another option.', chose_facility:'The family chose another option.', family_providing:'Family is providing the care for now.', discharge_changed:'The discharge plan changed.',
    medicaid_issue:'A Medicaid eligibility or program issue came up.', va_issue:'A VA authorization issue came up.', unable_to_reach:'We were not able to reach the family.', no_longer_needs:'The family no longer needs in-home care.' };
  function partnerName(l, org){ return (org && org.name) || String((l && l.referral_source_name) || '').trim() || ''; }
  function partnerLoop(l, ctx){
    ctx = ctx || {}; const today = ctx.today || ymd(new Date()), org = ctx.org || null, name = partnerName(l, org);
    if(!name) return { partner:null, sent:[], due:[] };
    const sub = referralSubtype(l, org), sent = Array.isArray(l.partner_msgs) ? l.partner_msgs.slice() : [];
    const has = k => sent.some(m => m && m.kind === k);
    const lastAt = sent.length ? sent.map(m => m.at).sort().slice(-1)[0] : null;
    const client = String(((l.client_first_name || '') + ' ' + (l.client_last_name || '')).trim() || 'the family'), family = String((l.first_name || '').trim() || 'the family');
    /* the person who referred (a web referral names them) comes first, then the partner record's people line */
    const contact = String((l.referrer && l.referrer.name) || '').trim().split(/\s+/)[0] || String((org && org.people) || '').split(/[,(]/)[0].trim().split(/\s+/)[0] || 'there';
    const over = ctx.templates || {}, tpl = k => String(over[k] || PARTNER_DEFAULT[k]);
    const v = { partner:contact, me:String(ctx.me || 'the Care Coordinator').split(' ')[0], client, family, day:'', start:'', reason:'', days:'' };
    const due = [];
    if(l.first_human_contact_at && !has('receipt')) due.push({ kind:'receipt', title:PARTNER_LABEL.receipt, text:fill(tpl('receipt'), v) });
    const asm = asmtNext(Object.assign({}, ctx, { lead:l, now:ctx.now || new Date().toISOString(), today }));
    if(asm && asm.kind === 'booked' && !has('assessment')) due.push({ kind:'assessment', title:PARTNER_LABEL.assessment, text:fill(tpl('assessment'), Object.assign({}, v, { day:dayWords(asm.day, today) })) });
    if(l.said_yes_at && !has('outcome_started')) due.push({ kind:'outcome_started', title:PARTNER_LABEL.outcome_started, text:fill(tpl('outcome_started'), Object.assign({}, v, { start:l.first_shift_at ? 'already behind us: care began ' + dayWords(chicago(l.first_shift_at).ymd, today) : 'being set up now, once the schedule and caregiver are confirmed' })) });
    if(String(l.status || '') === 'Lost' && !has('outcome_lost')) due.push({ kind:'outcome_lost', title:PARTNER_LABEL.outcome_lost, text:fill(tpl('outcome_lost'), Object.assign({}, v, { reason:LOST_SHARE[lostKey(l)] || 'The family decided not to move forward at this time.' })) });
    const w = waiting(l);
    if(PROFESSIONAL.indexOf(sub) > -1 && l.funding_source === 'medicaid' && w && w.reason === 'state' && !l.said_yes_at && String(l.status || '') !== 'Lost'){
      const since = lastAt && lastAt > (w.since || '') ? chicago(lastAt).ymd : (w.since || today);
      if(daysBetween(since, today) >= 7) due.push({ kind:'weekly', title:PARTNER_LABEL.weekly, text:fill(tpl('weekly'), Object.assign({}, v, { days:String(stateDays(l, w, today) == null ? daysBetween(w.since || today, today) : stateDays(l, w, today)) })) });
    }
    return { partner:{ name, subtype:sub, label:SUBTYPE_LABEL[sub] || '', professional:PROFESSIONAL.indexOf(sub) > -1 }, sent:sent.sort((a, b) => String(b.at).localeCompare(String(a.at))), due };
  }
  /* a person sent (or said) something to the referrer: recorded on the inquiry; the timeline and the loop read it */
  function recordPartnerMsg(l, m, nowIso){
    const at = nowIso || new Date().toISOString(); m = m || {};
    l.partner_msgs = (Array.isArray(l.partner_msgs) ? l.partner_msgs : []).concat([{ at, kind:String(m.kind || 'note'), channel:String(m.channel || 'email'), to:String(m.to || ''), text:String(m.text || '').slice(0, 1500), by:String(m.by || '') }]).slice(-50);
    return l;
  }

  /* ── THE LEAD WORKSPACE (her design's screen 2, built 2026-10-07): what the profile's Overview says before the yes ─────
     Five steps with dates, the one timeline, a script line for the moment the board says we are in, and "can we staff
     it?" from the caregivers' own availability. All pure; the page only draws. Nothing here sends anything. */
  const STEP_KEYS = ['new', 'reaching', 'reached', 'assessment', 'yes'];
  const STEP_LABEL = { new:'New', reaching:'Reaching out', reached:'Reached', assessment:'Assessment', yes:'Yes' };
  function steps(l, ctx){
    ctx = Object.assign({ now:new Date().toISOString() }, ctx || {}); ctx.lead = l;
    const now = ctx.now, today = ctx.today || chicago(now).ymd, hours = ctx.hours || responseHours({});
    const fa = firstAttemptState(l, hours, now), asm = asmtNext(ctx);
    const tries = evts(l).filter(e => e && e.actor === 'human' && e.direction === 'out' && e.channel === 'call').length;
    const lastTry = lastHumanOut(l);
    const out = [];
    out.push({ key:'new', done:true, words:(l.created_at ? dayCap(cameInWords(l.created_at, now)).replace(/^Came in /, '') : '') + (fa ? ' · ' + fa.ack : '') });
    out.push({ key:'reaching', done:!!l.first_human_attempt_at, words:l.first_human_attempt_at ? (lastTry ? (lastTry.outcome === 'sent' ? (lastTry.channel === 'email' ? 'emailed' : 'texted') : String(lastTry.outcome || '').replace(/_/g, ' ')) + ' ' + whenWords(lastTry.at, now) : whenWords(l.first_human_attempt_at, now)) + (tries ? ' · ' + tries + (tries === 1 ? ' try' : ' tries') : '') : 'nobody has tried yet' });
    out.push({ key:'reached', done:!!l.first_human_contact_at, words:l.first_human_contact_at ? 'talked ' + whenWords(l.first_human_contact_at, now) : 'a real conversation' });
    const asmDone = (ctx.assessments || []).find(a => a && (a.status === 'Completed — Awaiting Plan' || /complete/i.test(String(a.status || '')) || (a.status === 'Scheduled' && a.visit_date && a.visit_date < today)));
    out.push({ key:'assessment', done:!!asmDone, words:asmDone ? 'done ' + dayWords(asmDone.visit_date || today, today) : asm && asm.kind === 'booked' ? 'booked ' + dayWords(asm.day, today) : 'not booked' });
    out.push({ key:'yes', done:!!l.said_yes_at, words:l.said_yes_at ? dayWords(chicago(l.said_yes_at).ymd, today) : 'then Getting ready' });
    const lost = String(l.status || '') === 'Lost';
    let cur = out.findIndex(s => !s.done); if(cur < 0) cur = out.length - 1;
    out.forEach((s, i) => { s.label = STEP_LABEL[s.key]; s.state = s.done ? 'done' : (i === cur && !lost ? 'now' : 'todo'); });
    return out;
  }
  /* every call, text, email, automatic message and change on this family, newest first; names from ctx.names {email:name} */
  function timeline(l, ctx){
    ctx = Object.assign({ now:new Date().toISOString() }, ctx || {});
    const names = ctx.names || {}, who = e => { if(!e) return ''; const k = String(e).toLowerCase(); if(names[k]) return String(names[k]).split(' ')[0]; const p = k.split('@')[0]; return p ? p.charAt(0).toUpperCase() + p.slice(1) : ''; };
    const items = [], push = (at, kind, text, sub) => { if(at && !isNaN(Date.parse(at))) items.push({ at:new Date(at).toISOString(), kind, text, sub:sub || '' }); };
    const src = [l.source, ctx.referral || l.referral_source_name].filter(Boolean).join(' · ');
    const inq = evts(l).find(e => e && e.channel === 'web' && e.outcome === 'inquiry');
    push(l.created_at, 'inquiry', 'Inquiry' + (src ? ' from ' + src : '') + (l.assigned_coordinator ? ' · to ' + String(l.assigned_coordinator).split(' ')[0] : ''), (inq && (inq.note || inq.ref)) || whyCalled(l));
    let ackAt = null, ackHow = [];
    evts(l).forEach(e => {
      if(!e || !e.at) return;
      if(e.channel === 'web' && e.outcome === 'inquiry') return;
      if(e.actor === 'automation'){ if(/acknowledg/i.test(String(e.note || ''))){ ackAt = ackAt || e.at; ackHow.push(e.channel === 'email' ? 'email' : 'text'); return; } push(e.at, 'auto', 'The Hub ' + (e.channel === 'email' ? 'emailed' : 'texted') + (e.note ? ': ' + e.note : ''), ''); return; }
      if(e.direction === 'in'){ push(e.at, 'family', 'They ' + (e.channel === 'call' ? 'called' : e.channel === 'email' ? 'emailed' : 'texted'), e.ref || e.note || ''); return; }
      if(e.channel === 'call'){ const o = String(e.outcome || '').replace(/_/g, ' '); push(e.at, e.outcome === 'connected' ? 'talked' : 'try', (who(e.by) || 'We') + ' called · ' + (o === 'connected' ? 'we talked' + (e.duration_s ? ' ' + Math.round(e.duration_s / 60) + ' min' : '') : o === 'requested callback' ? 'they asked us to call back' : o), e.note || ''); return; }
      push(e.at, 'sent', (who(e.by) || 'We') + (e.channel === 'email' ? ' emailed' : ' texted'), e.ref || e.note || '');
    });
    if(ackAt || l.ack_sent_at) push(ackAt || l.ack_sent_at, 'auto', 'Acknowledged by the Hub' + (ackHow.length ? ' by ' + [...new Set(ackHow)].join(' and ') : ''), l.ack_kind === 'after_hours' ? 'after hours: a coordinator will call when we open' : '');
    (Array.isArray(l.comm_log) ? l.comm_log : []).forEach(n => {
      if(!n || !n.at) return; const b = String(n.body || '');
      if(/^☎ call/.test(b) || n.kind === 'authorization_received' && l.authorization_received_at) return;   /* the call is on the events already; authorization is below */
      push(n.at, n.kind === 'dsds_called' ? 'talked' : /^🤝/.test(b) ? 'promise' : 'note', (who(n.by) ? who(n.by) + ': ' : '') + b.replace(/^[^\w(]+\s*/, ''), '');
    });
    if(l.authorization_received_at) push(l.authorization_received_at, 'auto', 'Authorization received from the state', '');
    const rg = l.rungs || {};
    ['owner', 'backup', 'manager'].forEach(k => { if(rg[k + '_at']) push(rg[k + '_at'], 'auto', (rg[k + '_sent'] === false ? 'Could not text ' : 'Texted ') + (who(rg[k + '_to']) || RUNG_WORDS[k]) + (k === 'owner' ? ' at 5 minutes, nobody had called' : k === 'backup' ? ': on the backup\'s desk, nobody had called' : ': Owner Escalation told, counted as a miss'), ''); });
    (Array.isArray(l.status_history) ? l.status_history : []).forEach(h => {
      if(!h || !h.at) return;
      if(h.to === 'Lost') push(h.at, 'stage', 'Marked lost' + (who(h.by) ? ' by ' + who(h.by) : ''), h.why || '');
      else if(h.from === 'Lost') push(h.at, 'stage', 'Not lost after all' + (who(h.by) ? ' by ' + who(h.by) : ''), '');
    });
    (Array.isArray(l.partner_msgs) ? l.partner_msgs : []).forEach(m => { if(m && m.at) push(m.at, 'sent', (who(m.by) || 'We') + (m.channel === 'email' ? ' emailed ' : m.channel === 'call' ? ' called ' : ' texted ') + (m.to || 'the referrer') + ': ' + (PARTNER_LABEL[m.kind] || 'an update').toLowerCase(), m.text || ''); });
    if(l.said_yes_at) push(l.said_yes_at, 'stage', 'They said yes' + (l.said_yes_by_name ? ' · marked by ' + String(l.said_yes_by_name).split(' ')[0] : ''), '');
    const fa = firstAttemptState(l, ctx.hours || responseHours({}), ctx.now);
    if(fa && fa.after_hours && fa.running) push(fa.start, 'clock', 'Lead response hours opened', 'first call due ' + clockWords(fa.due));
    items.sort((a, b) => b.at.localeCompare(a.at));
    return items.slice(0, 80);
  }
  /* the script line for the moment the board row says we are in. Her words are the defaults; Settings can replace each
     one (ctx.scripts {key:text}). Fill-ins: {first} {client} {me} {when} {why} {start} {referral}. Never sent by itself. */
  const SCRIPT_KEYS = ['first_call', 'voicemail', 'replied', 'promise', 'authorized', 'check_back_state', 'check_back_family', 'unable_to_reach', 'asmt_booked', 'urgent_start', 'followup', 'yes_thanks'];
  const SCRIPT_LABEL = { first_call:'First call', voicemail:'Voicemail', replied:'They replied', promise:'The call we promised', authorized:'The state authorized', check_back_state:'Check-back, waiting on the state',
    check_back_family:'Check-back, family deciding or not ready', unable_to_reach:'Unable to reach, one more try', asmt_booked:'Assessment confirmation', urgent_start:'Needs care soon, book the visit', followup:'A follow-up', yes_thanks:'Thank-you text when they say yes (goes out only when you send it)' };
  const SCRIPT_DEFAULT = {   /* her words (reviewed 2026-10-07): conversation starters, never sent by themselves */
    first_call:'Hi {first}, this is {me} with Caring Companions. Thank you for reaching out about care for {client}. I would love to learn a little more about what is going on, what help would make things easier right now, and what you are hoping care could look like. Then I can walk you through how we may be able to help.',
    voicemail:'Hi {first}, this is {me} with Caring Companions. I am following up about care for {client}. I am sorry I missed you. I would be happy to answer any questions and learn a little more about what kind of help you are looking for. You can call or text me back at (417) 234-8494. I will also try you again soon.',
    replied:'Hi {first}, thank you for getting back to me. [Answer their question.] I would be happy to help you figure out the next step for {client}. If it would be easier to talk, send me a good time to call and I will do my best to make it work.',
    promise:'Hi {first}, this is {me} with Caring Companions. I promised I would follow up with you {when} about care for {client}. Is now still a good time to talk?',
    authorized:'Hi {first}, good news. We received the authorization for {client}\'s care. The next step is for us to confirm the care schedule and work on the right caregiver match. I would like to go over the authorized hours with you and talk about when you would like care to begin.',
    check_back_state:'Hi {first}, I wanted to check in about {client}. We are still waiting for the Medicaid authorization from the state, but I have not forgotten about you. Has anything changed with {client}\'s needs or the schedule you are hoping for while we wait? I will keep you updated as soon as we receive anything new.',
    check_back_family:'Hi {first}, I wanted to check back in about care for {client}. Have you had a chance to think about what would work best for your family? There is no pressure at all. If questions have come up or the situation has changed, I am happy to help.',
    unable_to_reach:'Hi {first}, this is {me} with Caring Companions. I have tried to reach you a few times about care for {client}, and I know things can get busy. I do not want to keep bothering you, so I will make this my last check-in for now. If you still need help, now or later, just call or text us at (417) 234-8494. We would be happy to help.',
    asmt_booked:'Hi {first}, just confirming our visit {when} to meet with you and {client}. We will talk through what help is needed, the schedule that would work best, and what is important to you in a caregiver. If you have a current medication list, please have it handy. We look forward to meeting you.',
    urgent_start:'Hi {first}, since you are hoping to start care {start}, I would like to get your in-home visit scheduled so we can learn more about {client}\'s needs and start working on the right caregiver match. I have [option 1] or [option 2] available. Would either of those work for you?',
    followup:'Hi {first}, this is {me} with Caring Companions. I wanted to follow up about {client}{why}. How are things going?',
    yes_thanks:'Hi {first}, thank you for choosing Caring Companions to care for {client}. I am {me}, your Care Coordinator, and I will be here to help you through the process. Our next steps are to finalize the care schedule, match the right caregiver, and make sure everyone is ready for a great first day. I will keep you updated along the way, and you can always call or text us at (417) 234-8494 if you need anything.',
  };
  const SCRIPT_HINT = {
    first_call:{ Website:'They filled in the website form; they may not remember every detail, so start from what they wrote.', Phone:'They called us first; pick up where that call left off.', Referral:'{referral} sent them; say so, families trust the hand-off.' },
    draft_ready:'Read the AI draft as if you wrote it; change anything that does not sound like you. Nothing goes out until you send it.',
    asmt_plan:'Write the care plan from the visit, then call {first} to walk through it and agree the start date.',
    no_next_step:'Decide the next step with {first}: another try today, a follow-up on a date, or Waiting on something outside the office.',
    dsds_21:'Call DSDS about the authorization first; then tell {first} what they said and when we check again.',
    check_back_state:'Check Fusion before you call, so you are not asking the family what the state already told us.',
  };
  /* "by Fri" · "this week" · "as soon as possible" · "soon": the timing words alone, for "hoping to start care {start}" */
  function startTiming(l, today){ const w = desiredStartWords(l, today); if(!w) return 'soon'; if(/planning/i.test(w)) return 'when the time is right'; return w.replace(/^(Needs|Wants|Wanted) care /, '').replace(/^\w/, c => c.toLowerCase()); }
  function fill(t, v){ return String(t || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? m : v[k])); }
  function scriptFor(l, row, ctx){
    ctx = ctx || {}; const reason = row && row.reason || '', w = waiting(l), nx = leadNext(l, ctx.now);
    const byWait = r => r === 'state' ? 'check_back_state' : r === 'unable_to_reach' ? 'unable_to_reach' : 'check_back_family';
    const key = /^new_/.test(reason) ? 'first_call' : reason === 'replied' ? 'replied' : /^promise/.test(reason) ? 'promise' : reason === 'authorized' ? 'authorized'
      : (reason === 'check_back_due' || reason === 'waiting') ? byWait(w && w.reason) : reason === 'asmt_booked' ? 'asmt_booked' : reason === 'urgent_start' ? 'urgent_start'
      : /^followup/.test(reason) ? 'followup' : reason === 'no_next_step' && (ctx.stage === 'reaching_out') ? 'voicemail' : null;
    const client = (l.client_first_name || '').trim(), caller = (l.first_name || '').trim();
    const v = { first:caller || 'there', client:client && client !== caller ? client : 'your loved one', me:(ctx.me || 'a Care Coordinator').split(' ')[0],
      when:nx && (nx.kind === 'promise' || reason === 'asmt_booked') ? whenWords(nx.at, ctx.now || new Date().toISOString()) : (row && row.when && row.when.big) || 'as we said',
      why:nx && nx.kind === 'follow_up' && nx.why ? ': ' + String(nx.why).replace(/[.?!]+$/, '') : '', start:startTiming(l, ctx.today),
      referral:ctx.referral || l.referral_source_name || 'A partner' };
    if(reason === 'asmt_booked' && ctx.assessments){ const a = asmtNext(Object.assign({}, ctx, { lead:l })); if(a && a.kind === 'booked') v.when = a.timed ? whenWords(a.iso, ctx.now || new Date().toISOString()) : dayWords(a.day, ctx.today || chicago(ctx.now || new Date().toISOString()).ymd); }
    const over = ctx.scripts && key && String(ctx.scripts[key] || '').trim();
    const text = key ? fill(over || SCRIPT_DEFAULT[key], v) : '';
    let hint = SCRIPT_HINT[reason] || (key === 'first_call' ? SCRIPT_HINT.first_call[l.source] || '' : key === 'check_back_state' ? SCRIPT_HINT.check_back_state : '');
    if(typeof hint !== 'string') hint = '';
    return { key, title:key ? SCRIPT_LABEL[key] : '', text, hint:fill(hint, v), custom:!!over };
  }
  /* "Can we staff it?": the requested days and times against what caregivers say they are available for. people =
     [{ name, town, windows:{mon:['morning',…]} }] (the availability page's own shape). Counts only, no names. */
  const WIN_SPANS = [['morning', 6, 12], ['afternoon', 12, 17], ['evening', 17, 22], ['overnight', 22, 30], ['overnight', -2, 6]];
  function timeCats(text){
    const t = String(text || '').toLowerCase(); if(!t) return null;
    const m = [...t.matchAll(/(\d{1,2})(?::(\d\d))?\s*(a\.?m|p\.?m)?/g)].map(x => { let h = Number(x[1]); const ap = (x[3] || '').replace('.', ''); if(ap === 'pm' && h < 12) h += 12; if(ap === 'am' && h === 12) h = 0; return h; }).filter(h => h >= 0 && h <= 24);
    if(m.length >= 2){ let a = m[0], b = m[1]; if(b <= a) b += 24;
      /* a window counts when the shift spends 2 hours in it (9 to 1 is a morning shift, not a daytime one); else the biggest */
      const ov = {}; WIN_SPANS.forEach(sp => { const o = Math.min(b, sp[2]) - Math.max(a, sp[1]); if(o > 0) ov[sp[0]] = (ov[sp[0]] || 0) + o; });
      const cats = Object.keys(ov).filter(k => ov[k] >= 2); if(cats.length) return cats;
      const best = Object.keys(ov).sort((x, y) => ov[y] - ov[x])[0]; return best ? [best] : null; }
    const cats = []; if(/morning|a\.?m\b/.test(t)) cats.push('morning'); if(/afternoon|mid.?day|daytime|lunch/.test(t)) cats.push('afternoon'); if(/evening|dinner|bed ?time|night(?!s? ?shift)/.test(t) && !/overnight/.test(t)) cats.push('evening'); if(/overnight|night ?shift|24/.test(t)) cats.push('overnight');
    return cats.length ? cats : null;
  }
  function staffingLook(l, people, opts){
    opts = opts || {}; const s = schedule(l), town = String((l && l.client_city) || '').trim().toLowerCase();
    const pool = (people || []).filter(p => p && p.windows && Object.keys(p.windows).some(d => Array.isArray(p.windows[d]) && p.windows[d].length));
    if(!s || (!s.days.length && !s.times)) return { asked:false, total:pool.length, count:0, same_town:0, words:'No schedule asked yet, so there is nothing to check against the caregivers.' };
    if(!pool.length) return { asked:true, total:0, count:0, same_town:0, words:'No caregiver availability is on file yet (caregivers set it at cc.mo-care.com/availability).' };
    const days = (s.days.length ? s.days : DAYS).map(d => d.toLowerCase()), cats = timeCats(s.times);
    const fits = pool.filter(p => days.every(d => { const w = p.windows[d] || []; return cats ? cats.every(c => w.indexOf(c) > -1) : w.length > 0; }));
    const same = town ? fits.filter(p => String(p.town || p.city || '').trim().toLowerCase() === town).length : 0;
    const ask = [s.days.length ? daysWords(s.days) : 'every day', cats ? [...new Set(cats)].map(c => c === 'afternoon' ? 'daytimes' : c + 's').join(' and ') : (s.times || '')].filter(Boolean).join(' ');
    const words = fits.length ? fits.length + (fits.length === 1 ? ' caregiver says they are' : ' caregivers say they are') + ' available ' + ask + (town ? ' · ' + same + ' in ' + (l.client_city || '').trim() : '') + ' · of ' + pool.length + ' with availability on file'
      : 'Nobody has said they are available ' + ask + ' (of ' + pool.length + ' with availability on file). Staffing this takes a conversation before we promise a start.';
    return { asked:true, total:pool.length, count:fits.length, same_town:same, days:s.days, cats:cats || [], ask, words, thin:fits.length < 2 };
  }

  const api = { whenISO, START_KINDS, START_LABEL, LEGACY_URGENCY, DAYS, WAITING, WAITING_KEYS, LOST, LOST_LABEL, LOST_STAFFING, REQ_BY_STAGE, FORM_KEYS,
    RESPONSE_HOURS_DEFAULT, FIRST_ATTEMPT_MINUTES,
    ymd, addDays, daysBetween, dayWords, desiredStart, desiredStartWords, startRank, schedule, daysWords, scheduleWords, whyCalled,
    waiting, waitingProblems, defaultCheckBack, checkBackDue, lostKey, lostRecord, missing, toForm, compose, migrationPatch,
    responseHours, chicago, chicagoInstant, inResponseHours, nextOpening, clockStart, firstAttemptDue, clockWords, cameInWords, openingWords, callBackWords,
    firstAttemptState, medianFirstAttemptMinutes, PAYER_WORDS, lastEventWords, replyPending, boardRow, boardSort, dayHeader,
    markAuthorized, authorizationPending, stateDays, DSDS_AMBER_DAYS, DSDS_RED_DAYS, median, ownerNumbers, periodNumbers, leadNext, nextWords, setNext, STATUSES, setStatus, statusBeforeLost,
    STEP_KEYS, steps, timeline, SCRIPT_KEYS, SCRIPT_LABEL, SCRIPT_DEFAULT, scriptFor, timeCats, staffingLook, whenWords, RUNGS_DEFAULT, RUNG_WORDS, rungSettings, rungsDue, stampRung,
    SUBTYPE_LABEL, SUBTYPE_KEYS, PROFESSIONAL, referralSubtype, flags, PARTNER_KINDS, PARTNER_LABEL, PARTNER_DEFAULT, partnerName, partnerLoop, recordPartnerMsg, MEDICAID_LONG_DAYS, medicaidPipeline, missingRequired,
    ASMT_TARGET_DAYS, DECISION_DAYS, assessmentOverdue, decisionStale, cadenceNext, medicaidLong, carriedForward, yesThanks };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LeadRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
