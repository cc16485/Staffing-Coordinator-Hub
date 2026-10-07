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
  const STAGE_LABEL = { intake:'Intake', prechecks:'Pre-checks', assessment:'Assessment', signed:'Signed', axiscare:'AxisCare', billing:'Billing/Auth',
    schedule:'Schedule', team:'Team', ready:'Ready', firstweek:'First week', active:'Active' };
  const PAYERS = { private:'Private Pay', medicaid:'Medicaid IHS / HCBS', va:'VA Community Care', ltc:'Long-Term Care Insurance', other:'Other' };
  const ROLE_LABEL = { care_coordinator:'Care Coordinator', staffing_coordinator:'Staffing Coordinator', owner:'Owner', hub:'The Hub' };
  const DONE = ['complete', 'not_needed', 'exception'];
  const PROOF_LABEL = { verified:'Verified by the Hub', proof:'Proof file required', answer:'Answer required', confirmed:'Confirmed by a person' };
  /* the owner exception kinds Samantha named (2026-10-06) */
  const EXCEPTION_KINDS = { hard_stop:'Hard-stop override', unusual_acceptance:'Unusual acceptance', authorization:'Authorization exception',
    payer_setup:'Payer / setup exception', safety:'Safety decision', other:'Other owner decision' };

  /* a date as YYYY-MM-DD in Chicago, and day arithmetic in date space (no clock, no DST) */
  function ymd(d){ return new Date(d).toLocaleString('sv-SE', { timeZone:'America/Chicago' }).slice(0, 10); }
  function addDays(day, n){ const [y, m, d] = String(day).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  function addBusinessDays(day, n){ let d = day, left = n; while(left > 0){ d = addDays(d, 1); const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if(wd !== 0 && wd !== 6) left--; } return d; }
  function daysBetween(a, b){ return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }

  function applies(def, j){
    if(!def || def.active === false) return false;
    const p = Array.isArray(def.payers) ? def.payers : [];
    if(!p.length) return true;
    return !!j.payer && p.indexOf(j.payer) > -1;
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
  function dueOf(def, st, j){
    const d = def && def.due; if(!d) return null;
    if(d.before_start != null && j.target_start) return addDays(j.target_start, -Number(d.before_start));
    const since = st && st.ready_since ? ymd(st.ready_since) : null;
    if(d.days != null && since) return d.business ? addBusinessDays(since, Number(d.days)) : addDays(since, Number(d.days));
    return null;
  }
  /* who does it: the step's own reassignment, else the journey's role holder, else the role itself (unassigned) */
  function ownerOf(def, st, j, ctx){
    if(st && st.owner_email) return { email:String(st.owner_email).toLowerCase(), role:def.owner_role, how:'step' };
    const role = def.owner_role || 'care_coordinator';
    if(role === 'care_coordinator') return { email:(j.assigned_cc || '').toLowerCase() || null, role, how:'assigned' };
    if(role === 'staffing_coordinator'){ const e = j.staffing_email || (ctx && ctx.staffing_email) || null; return { email:e ? String(e).toLowerCase() : null, role, how:j.staffing_email ? 'assigned' : 'role' }; }
    if(role === 'owner') return { email:null, emails:((ctx && ctx.owner_emails) || []).map(x => String(x).toLowerCase()), role, how:'owners' };
    return { email:null, role, how:'hub' };
  }

  /* THE JOURNEY: every applicable step with its shown status, the next required step, what's coming, the stage rail */
  function compute(defs, j, steps, ctx){
    ctx = ctx || {};
    const today = ctx.today || ymd(Date.now());
    const byKey = {}; (steps || []).forEach(s => { if(s && s.step_key) byKey[s.step_key] = s; });
    const list = (defs || []).filter(d => applies(d, j)).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const doneKeys = new Set(list.filter(d => DONE.indexOf((byKey[d.key] || {}).state) > -1 && !(ruleHit(d, byKey[d.key], byKey) && byKey[d.key].state !== 'exception')).map(d => d.key));
    let stop = null;
    const startSoon = j.target_start ? daysBetween(today, j.target_start) : null;
    const rows = list.map(def => {
      const st = byKey[def.key] || { state:'open' };
      const owner = ownerOf(def, st, j, ctx);
      const r = { key:def.key, def, st, owner, due:null, status:'later', why:'', back:false };
      const hit = ruleHit(def, st, byKey);
      if(hit && st.state !== 'exception'){ r.status = 'blocked'; r.stop = true; r.why = hit.message; if(!stop) stop = r; return r; }
      if(DONE.indexOf(st.state) > -1){ r.status = st.state; return r; }
      if(stop){ r.status = 'later'; r.why = 'Stopped: ' + stop.def.title; return r; }
      const waitingOn = (def.after || []).filter(k => list.some(d => d.key === k) && !doneKeys.has(k));
      if(waitingOn.length){ r.status = 'later'; r.why = 'After: ' + waitingOn.map(k => (list.find(d => d.key === k) || {}).title).join(', '); return r; }
      r.due = dueOf(def, st, j);
      if(st.state === 'waiting'){
        if(st.check_back && st.check_back <= today){ r.status = 'attention'; r.back = true; r.why = 'Back from waiting' + (st.waiting_on ? ' on ' + st.waiting_on : ''); }
        else { r.status = 'waiting'; r.why = 'Waiting' + (st.waiting_on ? ' on ' + st.waiting_on : '') + (st.check_back ? ' · back ' + st.check_back : ''); }
        return r;
      }
      if(st.state === 'blocked'){ r.status = 'blocked'; r.why = st.blocked_reason || 'Blocked'; r.unblock = st.unblock || ''; r.unblock_role = st.unblock_role || null; }
      else r.status = 'ready';
      /* attention is worked out from dates: late, or the start date is close and an administrative step is still open */
      if(r.due && r.due < today){ r.attention = 'Late since ' + r.due; }
      else if(startSoon != null && startSoon <= 3 && STAGES.indexOf(def.stage) < STAGES.indexOf('team') && def.required !== false){
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
    const stage = complete ? 'active' : next ? next.def.stage : (rows.find(r => r.status === 'later') || {}).def ? rows.find(r => r.status === 'later').def.stage : 'intake';
    const stageKeys = STAGES.filter(s => s === 'active' || rows.some(r => r.def.stage === s));
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
  function canComplete(row, input){
    const def = row.def, a = (input && input.answer) || {}, files = (input && input.files) || [];
    if(row.status === 'later') return { ok:false, why:row.why || 'Not its turn yet.' };
    /* a verified step completes itself; by hand only with a reason (when the Hub can't see it), recorded as such */
    if(def.proof === 'verified' && !(input && input.manual_reason)) return { ok:false, why:'The Hub completes this one itself when it sees it done. If it can\'t, confirm it by hand with a reason.' };
    if(def.proof === 'proof' && !files.length && !(row.st.evidence && (row.st.evidence.files || []).length)) return { ok:false, why:'Attach the proof first.' };
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

  const api = { STAGES, STAGE_LABEL, PAYERS, ROLE_LABEL, PROOF_LABEL, EXCEPTION_KINDS, DONE, ymd, addDays, addBusinessDays, daysBetween,
    applies, ruleHit, dueOf, ownerOf, compute, canComplete, cardsFor, shown };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.JourneyRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
