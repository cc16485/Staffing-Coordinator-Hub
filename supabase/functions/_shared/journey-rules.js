/* =====================================================================================================================
   JOURNEY RULES: the one decision file for a client's journey (2026-10-06, Samantha approved Stages 1–3: "ONE canonical
   journey ... ONE source of truth for the person's journey"). Pure functions only: no page, no database. The Hub page and
   the server job (journey-run) run this same file, so they can never disagree about where a person stands.

   A journey = one person (lead or client, any payer except CDS) + their step states. The steps themselves come from the
   catalog (journey_step_def), which is data an owner can edit: name, instructions, payers, owner role, required, how it is
   proven, due timing, hard gate, what must come first. Nothing about the process is written here; only how to read it.

   Stored step states:   open · waiting (with check_back) · blocked (manual, with what unblocks it) · complete ·
                         not_needed · exception (owner override)
   Shown statuses:       ready · waiting · blocked · attention · complete · exception · not_needed · later (not its turn)
   "attention" is never stored: it is worked out from dates (late, start date close, back from waiting).
   ===================================================================================================================== */
(function(root){
  'use strict';
  const STAGES = ['intake', 'prechecks', 'assessment', 'signed', 'axiscare', 'billing', 'schedule', 'team', 'ready', 'firstweek', 'active'];
  /* SLICE 3b (2026-10-10): the caregiver journey (offer to Approved to Work) runs on the same tables and this same file; its
     stages are its own, and a step applies only to its own subject (client or caregiver), never across. */
  const CG_STAGES = ['offer', 'step1', 'screening', 'approval', 'step2', 'orientation', 'training', 'ready', 'active'];
  /* STAGE B (2026-10-17, Samantha approved "one client, one Start of Care journey, one current action"): the nine-step
     Start of Care. A journey on catalog 'nine' uses only the steps marked catalog 'nine', and each step is its own stage. */
  const NINE_STAGES = ['lead', 'assess', 'outcome', 'setup', 'confirm', 'axis', 'start', 'first', 'follow', 'active'];
  const catalogOf = j => (j && j.catalog === 'nine') ? 'nine' : 'v1';
  const STAGE_LABEL = { intake:'Intake', prechecks:'Pre-checks', assessment:'Assessment', signed:'Signed', axiscare:'AxisCare', billing:'Billing/Auth',
    schedule:'Schedule', team:'Team', ready:'Ready', firstweek:'First week', active:'Active',
    lead:'New Lead', assess:'Care Assessment', outcome:'Assessment Outcome', setup:'Client Setup + Billing', confirm:'Confirm Schedule + Caregivers', axis:'Schedule in AxisCare', start:'Confirm Start of Care', first:'First Shift', follow:'Next-Day Follow-Up',
    offer:'Offer', step1:'Step 1', screening:'Screening', approval:'Approval', step2:'Step 2 (Viventium)', orientation:'Orientation', training:'Training' };
  const subjectOf = j => (j && j.subject === 'caregiver') ? 'caregiver' : 'client';
  const stagesFor = j => subjectOf(j) === 'caregiver' ? CG_STAGES : catalogOf(j) === 'nine' ? NINE_STAGES : STAGES;
  const PAYERS = { private:'Private Pay', medicaid:'Medicaid IHS / HCBS (ending)', va:'VA Community Care', ltc:'Long-Term Care Insurance', guide:'Medicare GUIDE', other:'Other' };
  const ROLE_LABEL = { care_coordinator:'Care Coordinator', staffing_coordinator:'Staffing Coordinator', owner:'Owner', hub:'The Hub' };
  const DONE = ['complete', 'not_needed', 'exception'];
  const PROOF_LABEL = { verified:'Verified by the Hub', proof:'Proof file required', answer:'Answer required', confirmed:'Confirmed by a person', checks:'Checks (the Hub ticks what it can see)' };
  /* the owner exception kinds Samantha named (2026-10-06) */
  const EXCEPTION_KINDS = { hard_stop:'Hard-stop override', unusual_acceptance:'Unusual acceptance', authorization:'Authorization exception',
    payer_setup:'Payer / setup exception', safety:'Safety decision', other:'Other owner decision' };

  /* a date as YYYY-MM-DD in Chicago, and day arithmetic in date space (no clock, no DST) */
  function ymd(d){ return new Date(d).toLocaleString('sv-SE', { timeZone:'America/Chicago' }).slice(0, 10); }
  function addDays(day, n){ const [y, m, d] = String(day).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  function addBusinessDays(day, n){ let d = day, left = n; while(left > 0){ d = addDays(d, 1); const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if(wd !== 0 && wd !== 6) left--; } return d; }
  function daysBetween(a, b){ return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }

  function applies(def, j, ctx){
    if(!def || def.active === false) return false;
    if((def.subject || 'client') !== subjectOf(j)) return false;   /* 3b: never across subjects */
    if(subjectOf(j) === 'client' && (def.catalog || 'v1') !== catalogOf(j)) return false;   /* stage B: one catalog per journey */
    /* 3b: a caregiver step that applies only to some people (lived outside Missouri, claims a credential, will drive, after
       year one): every named fact must be known and true; an unknown fact means the step is not shown yet */
    if(def.applies && typeof def.applies === 'object'){
      const facts = (ctx && ctx.facts) || {};
      if(!Object.keys(def.applies).every(k => facts[k] === def.applies[k])) return false;
    }
    /* stage A (2026-10-17): a step retired for NEW journeys only (Medicaid IHS intake ended): journeys opened before the
       date keep it, with every record, exactly as it was */
    if(def.opened_before && j && j.created_at && String(j.created_at).slice(0, 10) >= String(def.opened_before)) return false;
    const p = Array.isArray(def.payers) ? def.payers : [];
    if(!p.length) return true;
    return !!j.payer && p.indexOf(j.payer) > -1;
  }
  /* 3b: a completed step whose evidence has a life (expires_after_days) counts as done only while it is still in date */
  function expiredOn(def, st, today){
    if(!st || st.state !== 'complete') return null;
    /* SLICE 6 (2026-10-10): an expiry recorded on the evidence (a credential's own expiry date) counts first; else the
       catalog's interval from the completion date */
    const ev = st.evidence && typeof st.evidence.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.evidence.expires) ? st.evidence.expires : null;
    if(ev) return ev < today ? ev : null;
    const n = def && def.expires_after_days; if(!n || !st.completed_at) return null;
    const until = addDays(ymd(st.completed_at), Number(n)); return until < today ? until : null;
  }
  /* an answer rule: { field, op, value, outcome:'stop', message } — e.g. prior 21-day notices >= 2 stops */
  /* a rule can compare with another step's answer: ref "pay.auth.hours_week" (requested hours above authorized hours) */
  function ruleHit(def, st, byKey){
    const r = def && def.rule; if(!r || !st || !st.answer) return null;
    const v = st.answer[r.field]; if(v === undefined || v === null || v === '') return null;
    let target = r.value;
    if(r.ref){ const i = String(r.ref).lastIndexOf('.'), other = byKey && byKey[r.ref.slice(0, i)], ov = other && other.answer ? other.answer[r.ref.slice(i + 1)] : undefined;
      if(ov === undefined || ov === null || ov === '') return null; target = Number(ov); }
    const a = typeof target === 'number' ? Number(v) : v;
    const hit = r.op === '>=' ? a >= target : r.op === '>' ? a > target : r.op === '<=' ? a <= target : r.op === '<' ? a < target
      : r.op === 'in' ? (Array.isArray(target) && target.indexOf(a) > -1) : r.op === '!=' ? a != target : a == target;   // eslint-disable-line eqeqeq
    return hit ? { outcome:r.outcome || 'stop', message:r.message || 'This answer stops the journey.' } : null;
  }
  /* when a step is due: N (business) days after it became ready, or N days before the target start */
  function dueOf(def, st, j, byKey){
    if(st && st.evidence && typeof st.evidence.due_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.evidence.due_on)) return st.evidence.due_on;
    const d = def && def.due; if(!d) return null;
    if(d.before_start != null && j.target_start) return addDays(j.target_start, -Number(d.before_start));
    /* 3b: N days after another step was completed (the OJT clock runs from orientation completion, her decision 7) */
    if(d.from && d.days != null){ const o = byKey && byKey[d.from]; if(!o || !o.completed_at) return null; return d.business ? addBusinessDays(ymd(o.completed_at), Number(d.days)) : addDays(ymd(o.completed_at), Number(d.days)); }
    const since = st && st.ready_since ? ymd(st.ready_since) : null;
    if(d.days != null && since) return d.business ? addBusinessDays(since, Number(d.days)) : addDays(since, Number(d.days));
    return null;
  }
  /* who does it: the step's own reassignment, else the journey's role holder, else the role itself (unassigned) */
  function ownerOf(def, st, j, ctx){
    if(st && st.owner_email) return { email:String(st.owner_email).toLowerCase(), role:def.owner_role, how:'step' };
    const role = def.owner_role || 'care_coordinator';
    if(role === 'care_coordinator') return { email:(j.assigned_cc || '').toLowerCase() || null, role, how:'assigned' };
    if(role === 'staffing_coordinator'){ const e = j.staffing_email || (ctx && ctx.staffing_email) || null;
      /* stage A (2026-10-17): no Staffing Coordinator yet -> the client's Care Coordinator, never the first owner */
      if(!e && j.assigned_cc && subjectOf(j) === 'client') return { email:String(j.assigned_cc).toLowerCase(), role, how:'care coordinator (no staffing coordinator)' };
      return { email:e ? String(e).toLowerCase() : null, role, how:j.staffing_email ? 'assigned' : 'role' }; }
    if(role === 'owner') return { email:null, emails:((ctx && ctx.owner_emails) || []).map(x => String(x).toLowerCase()), role, how:'owners' };
    return { email:null, role, how:'hub' };
  }

  /* THE JOURNEY: every applicable step with its shown status, the next required step, what's coming, the stage rail */
  function compute(defs, j, steps, ctx){
    ctx = ctx || {};
    const today = ctx.today || ymd(Date.now());
    const byKey = {}; (steps || []).forEach(s => { if(s && s.step_key) byKey[s.step_key] = s; });
    const list = (defs || []).filter(d => applies(d, j, ctx)).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const doneKeys = new Set(list.filter(d => DONE.indexOf((byKey[d.key] || {}).state) > -1 && !(ruleHit(d, byKey[d.key], byKey) && byKey[d.key].state !== 'exception') && !expiredOn(d, byKey[d.key], today)).map(d => d.key));
    let stop = null;
    const startSoon = j.target_start ? daysBetween(today, j.target_start) : null;
    const rows = list.map(def => {
      const st = byKey[def.key] || { state:'open' };
      const owner = ownerOf(def, st, j, ctx);
      const r = { key:def.key, def, st, owner, due:null, status:'later', why:'', back:false, payer:j.payer || null };
      const hit = ruleHit(def, st, byKey);
      if(hit && st.state !== 'exception'){ r.status = 'blocked'; r.stop = true; r.why = hit.message; if(!stop) stop = r; return r; }
      const exp = expiredOn(def, st, today);
      if(exp){ r.status = 'attention'; r.expired = exp; r.attention = 'Expired on ' + exp + ': due again'; r.why = r.attention; return r; }
      if(DONE.indexOf(st.state) > -1){ r.status = st.state; return r; }
      if(stop){ r.status = 'later'; r.why = 'Stopped: ' + stop.def.title; return r; }
      const waitingOn = (def.after || []).filter(k => list.some(d => d.key === k) && !doneKeys.has(k));
      if(waitingOn.length){ r.status = 'later'; r.why = 'After: ' + waitingOn.map(k => (list.find(d => d.key === k) || {}).title).join(', '); return r; }
      r.due = dueOf(def, st, j, byKey);
      if(st.state === 'waiting'){
        if(st.check_back && st.check_back <= today){ r.status = 'attention'; r.back = true; r.why = 'Back from waiting' + (st.waiting_on ? ' on ' + st.waiting_on : ''); }
        else { r.status = 'waiting'; r.why = 'Waiting' + (st.waiting_on ? ' on ' + st.waiting_on : '') + (st.check_back ? ' · back ' + st.check_back : ''); }
        return r;
      }
      if(st.state === 'blocked'){ r.status = 'blocked'; r.why = st.blocked_reason || 'Blocked'; r.unblock = st.unblock || ''; r.unblock_role = st.unblock_role || null; }
      else r.status = 'ready';
      /* attention is worked out from dates: late, or the start date is close and an administrative step is still open */
      if(r.due && r.due < today){ r.attention = 'Late since ' + r.due; }
      else if(startSoon != null && startSoon <= 3 && subjectOf(j) === 'client' && (def.catalog === 'nine' ? def.admin === true : STAGES.indexOf(def.stage) < STAGES.indexOf('team')) && def.required !== false){
        r.attention = startSoon < 0 ? 'Start date has passed' : startSoon === 0 ? 'Starts today' : 'Start date in ' + startSoon + ' day' + (startSoon === 1 ? '' : 's');
      }
      if(r.attention && r.status === 'ready') r.status = 'attention';
      return r;
    });
    const open = rows.filter(r => ['ready', 'blocked', 'attention'].indexOf(r.status) > -1);
    const required = rows.filter(r => r.def.required !== false);
    const next = required.find(r => ['ready', 'blocked', 'attention'].indexOf(r.status) > -1)
      || required.find(r => r.status === 'waiting') || null;
    /* a quiet step (def.quiet) is up but never nags: no "also ready" line and no My Work card. The yes is one: it is the
       family's move, and the office presses it when it happens. */
    const alsoReady = open.filter(r => r !== next && !r.def.quiet);
    const comingNext = rows.filter(r => r.status === 'later' && !r.stop).slice(0, 3);
    const complete = required.length > 0 && required.every(r => DONE.indexOf(r.status) > -1);
    const ST = stagesFor(j);
    const stage = complete ? 'active' : next ? next.def.stage : (rows.find(r => r.status === 'later') || {}).def ? rows.find(r => r.status === 'later').def.stage : ST[0];
    const stageKeys = ST.filter(s => s === 'active' || rows.some(r => r.def.stage === s));
    const rail = stageKeys.map(s => {
      const rs = rows.filter(r => r.def.stage === s && r.def.required !== false);
      const state = s === 'active' ? (complete ? 'done' : 'todo')
        : rs.some(r => r.stop) ? 'stopped'
        : rs.length && rs.every(r => DONE.indexOf(r.status) > -1) ? 'done'
        : s === stage ? 'now' : 'todo';
      return { key:s, label:STAGE_LABEL[s], state };
    });
    return { rows, next, alsoReady, comingNext, stop, complete, stage, stageLabel:STAGE_LABEL[stage], rail, today };
  }

  /* What can be done to a step, and what it needs. The server checks the same things again (journey_step_apply). */
  /* a question only asked for some answers (show_if: { payer:'other' }) */
  function shown(f, a){ if(!f.show_if) return true; return Object.keys(f.show_if).every(k => a[k] === f.show_if[k]); }
  /* STAGE B: a step made of checks. An auto check is ticked by the Hub from what it can see (st.evidence.auto[key].ok);
     a person check is answered by a person. show_if may also name the journey's payer ({ payer:'va' }). */
  function checksOf(def, j){ return ((def && def.checks) || []).filter(c => !c.show_if || Object.keys(c.show_if).every(k => k === 'payer' ? (j && j.payer) === c.show_if[k] : true)); }
  function checkState(def, st, j, answer){
    const auto = (st && st.evidence && st.evidence.auto) || {}, a = answer || (st && st.answer) || {};
    return checksOf(def, j).map(c => {
      if(c.auto) return { key:c.key, label:c.label, auto:true, ok:!!(auto[c.key] && auto[c.key].ok), detail:(auto[c.key] && auto[c.key].detail) || '', at:(auto[c.key] && auto[c.key].at) || null };
      const v = a[c.key];
      const ok = c.type === 'check' || !c.type ? v === true : (v !== undefined && v !== null && String(v).trim() !== '');
      return { key:c.key, label:c.label, auto:false, ok, type:c.type || 'check', options:c.options || null, value:v, optional:c.required === false };
    });
  }
  const personChecks = (def, j) => checksOf(def, j).filter(c => !c.auto);
  function canComplete(row, input){
    const def = row.def, a = (input && input.answer) || {}, files = (input && input.files) || [];
    if(row.status === 'later') return { ok:false, why:row.why || 'Not its turn yet.' };
    /* a verified step completes itself; by hand only with a reason (when the Hub can't see it), recorded as such */
    if(def.proof === 'verified' && !(input && input.manual_reason)) return { ok:false, why:'The Hub completes this one itself when it sees it done. If it can\'t, confirm it by hand with a reason.' };
    if(def.proof === 'proof' && !files.length && !(row.st.evidence && (row.st.evidence.files || []).length)) return { ok:false, why:'Attach the proof first.' };
    if(def.proof === 'checks'){
      const cs = checkState(def, row.st, { payer:row.payer || null }, Object.assign({}, row.st.answer || {}, a));
      const miss = cs.find(c => !c.ok && !c.optional);
      if(miss) return { ok:false, why:miss.auto ? 'The Hub can\'t see this yet: ' + miss.label + (miss.detail ? ' (' + miss.detail + ')' : '') : 'Tick or answer "' + miss.label + '" first.' };
      return { ok:true };
    }
    const fields = (def.answer && def.answer.fields) || [];
    for(const f of fields){ if(!shown(f, a) || f.required === false) continue;
      const v = a[f.key]; if(v === undefined || v === null || v === '' || (f.type === 'check' && v !== true)) return { ok:false, why:(f.type === 'check' ? 'Tick "' : 'Answer "') + f.label + '" first.' }; }
    return { ok:true };
  }

  /* My Work: one card per person per owner. The most pressing of that owner's open steps leads. */
  function cardsFor(j, view, ctx){
    const by = new Map();
    const add = (email, r) => { if(!email) return; if(!by.has(email)) by.set(email, []); by.get(email).push(r); };
    view.rows.forEach(r => {
      if(['ready', 'blocked', 'attention', 'waiting'].indexOf(r.status) < 0) return;
      if(r.def.quiet && r.status === 'ready') return;   /* a quiet step waits for a person without a card */
      /* stage A (2026-10-17): a step the Hub does itself (First visit happened) is nobody's card while it waits; if it
         needs a person (attention, blocked) it goes to the client's Care Coordinator, never to the owners as "Nobody is assigned" */
      if(subjectOf(j) === 'client' && r.owner && r.owner.how === 'hub' && !(r.status === 'blocked' && r.unblock_role === 'owner')){
        if(['attention', 'blocked'].indexOf(r.status) < 0) return;
        if(j.assigned_cc){ add(String(j.assigned_cc).toLowerCase(), r); return; }
      }
      const target = r.status === 'blocked' && r.unblock_role === 'owner' ? { emails:(ctx && ctx.owner_emails) || [] } : r.owner;
      if(target.email) add(target.email, r);
      else if(target.emails && target.emails.length) target.emails.forEach(e => add(String(e).toLowerCase(), r));
      else add('unassigned', r);
    });
    const rank = r => r.status === 'attention' ? 0 : r.status === 'blocked' ? 1 : r.status === 'ready' ? 2 : 3;
    const out = [];
    by.forEach((rs, email) => {
      rs.sort((a, b) => rank(a) - rank(b) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || (a.def.sort || 0) - (b.def.sort || 0));
      const lead = rs[0], startIn = j.target_start ? daysBetween(view.today, j.target_start) : null;
      const kind = lead.status === 'attention' ? 'attention' : lead.status === 'blocked' ? 'blocked' : lead.status === 'waiting' ? 'waiting' : 'next';
      out.push({ owner:email === 'unassigned' ? null : email, kind, step_key:lead.key, title:lead.def.title, why:lead.attention || lead.why || '',
        due:lead.due, start_in:startIn, also:rs.slice(1).filter(r => r.status !== 'waiting').map(r => r.def.title),
        check_back:lead.status === 'waiting' ? lead.st.check_back : null, waiting_on:lead.status === 'waiting' ? (lead.st.waiting_on || '') : '' });
    });
    return out;
  }

  const api = { STAGES, CG_STAGES, NINE_STAGES, catalogOf, checksOf, checkState, personChecks, stagesFor, subjectOf, expiredOn, STAGE_LABEL, PAYERS, ROLE_LABEL, PROOF_LABEL, EXCEPTION_KINDS, DONE, ymd, addDays, addBusinessDays, daysBetween,
    applies, ruleHit, dueOf, ownerOf, compute, canComplete, cardsFor, shown };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.JourneyRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
