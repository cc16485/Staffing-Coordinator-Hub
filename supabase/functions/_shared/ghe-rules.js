/* =============================================================================
   ghe-rules.js · is the GHE booked and done in AxisCare? (GHE fix, slice 3, Samantha 2026-10-08)
   Pure functions, byte-identical in the Hub and the server (supabase/functions/_shared/ghe-rules.js): the nightly
   ghe-reminders run, the Nurse Scheduling tab and the tests all use this one file.

   HER RULES (2026-10-08):
   · the nurse calls the client, agrees a time and BOOKS THE GHE IN AXISCARE themselves, as service T1001
   · AxisCare is the proof: a T1001 visit in the GHE month = booked; clocked in and out = visited
   · oversight by the Medicaid coordinator (owner of Payer Programs): the 1st, a due list; the 10th, not booked yet →
     the nurse and the coordinator are warned; the 20th, still not booked → a Needs Attention card for the coordinator;
     the last week of the month, not visited → Samantha hears; the month over with no visit → a Missed GHE card that
     only clears with a reason and a next step (MAN 3.15; INFO 05-26-02: a missed GHE is done the next month and is
     not paid unless the delay was outside our control (then contact the PCCP team); a refusal is reported to DSDS)
   ============================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GheRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CODE = /\bT1001\b/i;
  const ym = d => String(d || '').slice(0, 7);
  const addMonths = (m, n) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + n; y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12 + 12) % 12 + 1; return y + '-' + String(mo).padStart(2, '0'); };
  const lastDay = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const monthRange = m => ({ from: m + '-01', to: m + '-' + String(lastDay(m)).padStart(2, '0') });

  /** a GHE visit in AxisCare: service T1001 (its code, procedure code or description) */
  function isGhe(v) {
    const s = (v && v.service) || {};
    return !!v && !v.removed && [s.code, s.procedureCode, s.description, v.serviceCode].some(x => CODE.test(String(x || '')));
  }
  const when = v => String(v.scheduledStartDate || v.startDate || '');
  const nurseOf = v => { const c = v && v.caregiver; return c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : ''; };

  /** what AxisCare says about one client's GHE month: visited, booked, or nothing (a past booking not clocked = not visited) */
  function monthState(visits, month, nowIso) {
    const now = String(nowIso || new Date().toISOString());
    const g = (visits || []).filter(isGhe).filter(v => ym(when(v)) === month).sort((a, b) => when(a).localeCompare(when(b)));
    const done = g.find(v => v.clockIn && v.clockOut && (v.clockIn.time || v.clockIn === true));
    const pick = v => v ? { id: String(v.id || ''), at: when(v), nurse: nurseOf(v), clock_in: (v.clockIn && v.clockIn.time) || '', clock_out: (v.clockOut && v.clockOut.time) || '' } : null;
    if (done) return { state: 'visited', visit: pick(done) };
    const ahead = g.find(v => when(v) >= now.slice(0, 16));
    if (ahead) return { state: 'booked', visit: pick(ahead) };
    const past = g[g.length - 1];
    if (past) return { state: 'not_visited', visit: pick(past) };
    return { state: 'none', visit: null };
  }

  /** the GHE windows to look at today: this month, last month (to catch a miss) and next month (to show bookings) */
  function windows(clients, today) {
    const m = ym(today), keep = [addMonths(m, -1), m, addMonths(m, 1)], out = [];
    for (const c of clients || []) {
      if (!c || c.active === false) continue;
      /* ghe_makeup: the month a missed GHE will be done, set when a person resolves a Missed GHE card */
      for (const w of ['ghe1', 'ghe2', 'ghe_makeup']) { const gm = ym(c[w]); if (gm && keep.indexOf(gm) > -1) out.push({ client_id: String(c.id), name: c.name || '', ax: String(c.axiscare_client_id || ''), nurse: c.assigned_nurse || '', month: gm, which: w }); }
    }
    return out;
  }

  /**
   * where one window stands today, and what the oversight ladder does about it.
   * st: monthState(); formDone: a GHE form for this client dated in the month (the older way the Hub counted it).
   */
  function stage(win, st, today, formDone) {
    const m = ym(today), day = +String(today).slice(8, 10), last = lastDay(m);
    const s = (st && st.state) || 'none', visited = s === 'visited' || !!formDone, booked = s === 'booked';
    if (win.month > m) return { stage: booked || visited ? 'booked_ahead' : 'upcoming', actions: [] };
    if (win.month < m) return visited ? { stage: 'done', actions: [] } : { stage: 'missed', actions: ['missed_card'] };
    if (visited) return { stage: 'done', actions: [] };
    const actions = [];
    if (!booked && day >= 10) actions.push('warn_unbooked');
    if (!booked && day >= 20) actions.push('unbooked_card');
    if (!booked && day >= last - 6) actions.push('owner_alert');
    return { stage: booked ? 'booked' : (s === 'not_visited' ? 'not_visited' : 'not_booked'), actions };
  }

  /** the ways a Missed GHE card can be cleared: each one is a next step a person takes (nothing is sent by the Hub) */
  const MISSED_REASONS = [
    ['make_up', 'Doing it next month (the late GHE is not billed or paid)'],
    ['outside_control', 'Delay outside our control (for example a hospital stay): PCCP team contacted for a new month'],
    ['refused', 'The client refused: reported to DSDS (services close)'],
    ['ended', 'Care ended or the client was no longer with us that month'],
    ['wrong_month', 'The month on the board was wrong: corrected from the care plan'],
  ];
  function missedResolution(form) {
    const r = MISSED_REASONS.find(x => x[0] === (form && form.reason));
    const note = String((form && form.note) || '').trim();
    if (!r) return { ok: false, why: 'Pick what happened.' };
    if ((r[0] === 'outside_control' || r[0] === 'refused') && !form.contacted_on) return { ok: false, why: r[0] === 'refused' ? 'Enter the date it was reported to DSDS.' : 'Enter the date the PCCP team was contacted.' };
    if (r[0] === 'make_up' && !/^\d{4}-\d{2}$/.test(String(form.make_up_month || ''))) return { ok: false, why: 'Pick the month it will be done.' };
    return { ok: true, reason: r[0], label: r[1], note, contacted_on: form.contacted_on || '', make_up_month: form.make_up_month || '' };
  }

  return { isGhe, monthState, windows, stage, monthRange, addMonths, lastDay, MISSED_REASONS, missedResolution };
});
