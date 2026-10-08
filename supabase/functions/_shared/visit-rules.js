/* =============================================================================
   visit-rules.js · delivered vs authorized, and visits not delivered (Medicaid slice D, Samantha 2026-10-08)
   Pure functions, byte-identical in the Hub and the server (supabase/functions/_shared/visit-rules.js): the weekday
   medicaid-visits run, the client's Payer tab and the tests use this one file.

   HER RULES (2026-10-08): "can those be pulled from AxisCare, not manual?" Yes:
   · units delivered = CLOCKED time on the care visits (her call: "clocked times is fine"), in 15-minute units, against the
     units the care plan authorizes for that month and procedure code
   · a visit not delivered = a scheduled care visit whose time has passed with no clock-in; its reason comes from the
     missed clock-in alert when an admin resolved it (timekeeper_cases), otherwise a person gives it on the review
   · the risk line (19 CSR 15-7.021(4)(A)5): stopping services without consent for 1 week or 3 scheduled visits in a row
     is evidence of risk. The Hub warns BEFORE it: 2 scheduled visits in a row not delivered, or 5 days with no delivered
     visit while visits were scheduled → a card for Staffing and the Medicaid coordinator
   · the monthly review (19 CSR 15-7.021(18)(L),(21)(A),(24)(A)3): delivered vs authorized with the reason for each visit
     not delivered and a written explanation of any difference, signed by the Medicaid coordinator (her pick: Angiel)
   ADW RESPITE (Samantha 2026-10-08: "we only do basic, no advanced yet"):
   · basic and advanced respite together: at most 49 hours a week and 868 units a month, from July 1 2026 (HCBS Manual 3.50
     rev. Jul 2026; Provider Bulletin 49-03); respite can't overlap another service at the same time (MAN 3.50). Checked on
     the schedule ahead (scheduled time) and on what happened (clocked time), so a week booked over the limit shows before it
     happens. A respite visit = the state's code S5150, or "respite" in the AxisCare service.
   · Caring Companions does not provide ADVANCED respite yet (it needs RN training sign-off per caregiver, ADW Provider
     Manual 2.6): any advanced respite visit booked (S5150 with TF, or "advanced" in the service) is flagged.
   ============================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisitRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GHE = /\bT1001\b/i;
  const RISK_IN_A_ROW = 2, RISK_DAYS = 5, SHORT_SHARE = 0.75, UNDER_SHARE = 0.9;
  const t = v => String(v || '');
  const when = v => t(v && (v.scheduledStartDate || v.startDate));
  const chiDay = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10); };
  const mins = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return isNaN(x) || isNaN(y) || y <= x ? 0 : Math.round((y - x) / 60000); };
  const codeOf = v => { const s = (v && v.service) || {}; return t(s.procedureCode || s.code || v.serviceCode).toUpperCase(); };

  /** the procedure codes this plan authorizes for our care lines (personal care, APC, ADW), month by month */
  function authorized(plan, month) {
    const out = {};
    for (const s of (plan && plan.services) || []) {
      if (!s.ours || !['pc', 'apc', 'adw_respite', 'adw_homemaker', 'adw_chore'].includes(s.kind)) continue;
      for (const u of s.units || []) if (t(u.start).slice(0, 7) === month && u.units != null) out[t(u.code).toUpperCase() || 'T1019'] = (out[t(u.code).toUpperCase() || 'T1019'] || 0) + Number(u.units);
    }
    return out;
  }
  /** a care visit: not removed, not the GHE (T1001); when the plan names codes, one of those codes */
  function isCare(v, codes) {
    if (!v || v.removed) return false;
    const c = codeOf(v); if (GHE.test(c) || GHE.test(t((v.service || {}).description))) return false;
    return !codes || !codes.length || !c || codes.indexOf(c) > -1;
  }
  /** one visit: delivered (clocked in and out), in progress, not delivered (its time passed, no clock-in), or upcoming */
  function classify(v, nowIso) {
    const sched = mins(v.scheduledStartDate || v.startDate, v.scheduledEndDate || v.endDate);
    const inT = v.clockIn && (v.clockIn.time || ''), outT = v.clockOut && (v.clockOut.time || '');
    const endAt = t(v.scheduledEndDate || v.endDate || v.scheduledStartDate || v.startDate);
    if (inT && outT) { const m = mins(inT, outT); return { state: 'delivered', minutes: m, scheduled: sched, short: sched > 0 && m < sched * SHORT_SHARE }; }
    if (inT) return { state: 'in_progress', minutes: 0, scheduled: sched };
    if (endAt && endAt < t(nowIso)) return { state: 'not_delivered', minutes: 0, scheduled: sched };
    return { state: 'upcoming', minutes: 0, scheduled: sched };
  }

  /** the month for one client: authorized vs delivered units, visits not delivered (with any reason on file), short visits */
  function monthSummary(visits, plan, month, nowIso, tkCases) {
    const auth = authorized(plan, month), codes = Object.keys(auth);
    const reasonOf = id => { const c = (tkCases || []).find(x => t(x.visit_id) === t(id) && x.resolved_at); return c ? { reason: c.resolved_reason || '', note: c.resolved_note || '', by: c.resolved_by_name || c.resolved_by || '' } : null; };
    const rows = (visits || []).filter(v => isCare(v, codes) && chiDay(when(v)).slice(0, 7) === month).sort((a, b) => when(a).localeCompare(when(b)));
    let minutes = 0; const missed = [], short = []; let delivered = 0, scheduled = 0;
    for (const v of rows) {
      const c = classify(v, nowIso);
      if (c.state === 'upcoming') continue;
      scheduled++;
      if (c.state === 'delivered') { delivered++; minutes += c.minutes; if (c.short) short.push({ id: t(v.id), day: chiDay(when(v)), minutes: c.minutes, scheduled: c.scheduled }); }
      if (c.state === 'not_delivered') missed.push({ id: t(v.id), day: chiDay(when(v)), at: when(v), caregiver: v.caregiver ? [v.caregiver.firstName, v.caregiver.lastName].filter(Boolean).join(' ') : '', reason: reasonOf(v.id) });
    }
    const units = Math.floor(minutes / 15), authUnits = Object.values(auth).reduce((a, b) => a + b, 0);
    return { month, authorized: auth, authorized_units: authUnits, delivered_units: units, delivered_minutes: minutes, visits_scheduled: scheduled, visits_delivered: delivered, missed, short };
  }

  /** the risk line, warned before it is crossed: in a row not delivered, and days with no delivered visit while visits were scheduled */
  function risk(visits, plan, nowIso) {
    const codes = Object.keys(authorized(plan, t(nowIso).slice(0, 7)));
    const past = (visits || []).filter(v => isCare(v, codes)).map(v => ({ v, c: classify(v, nowIso) })).filter(x => x.c.state === 'delivered' || x.c.state === 'not_delivered').sort((a, b) => when(b.v).localeCompare(when(a.v)));
    let inARow = 0; for (const x of past) { if (x.c.state === 'not_delivered') inARow++; else break; }
    const lastDel = past.find(x => x.c.state === 'delivered'), firstMiss = past.length && past[0].c.state === 'not_delivered' ? past[inARow - 1] : null;
    const since = lastDel ? when(lastDel.v) : (firstMiss ? when(firstMiss.v) : '');
    const daysWithout = inARow && since ? Math.floor((Date.parse(nowIso) - Date.parse(since)) / 864e5) : 0;
    const at = inARow >= RISK_IN_A_ROW || (inARow >= 1 && daysWithout >= RISK_DAYS);
    return { at_risk: at, in_a_row: inARow, days_without: daysWithout, last_delivered: lastDel ? chiDay(when(lastDel.v)) : '', since_missed: past.slice(0, inARow).map(x => chiDay(when(x.v))).reverse() };
  }

  /** what the review needs written: visits not delivered with no reason on file, and units well under what was authorized */
  function reviewNeeds(sum) {
    const noReason = (sum && sum.missed || []).filter(m => !m.reason);
    const under = !!(sum && sum.authorized_units && sum.delivered_units < sum.authorized_units * UNDER_SHARE);
    return { no_reason: noReason, under, needs_writing: noReason.length > 0 || under };
  }
  /** signing the review: an explanation when something needs writing, the signer's name, the date */
  function signReview(sum, form, ctx) {
    ctx = ctx || {}; const f = form || {}, n = reviewNeeds(sum), ex = t(f.explanation).trim();
    if (n.needs_writing && ex.length < 15) return { ok: false, why: n.no_reason.length ? 'Explain the ' + n.no_reason.length + ' visit' + (n.no_reason.length === 1 ? '' : 's') + ' not delivered with no reason on file, and any difference in units.' : 'Explain why fewer units were delivered than authorized.' };
    if (!t(f.signed_name).trim()) return { ok: false, why: 'Type your name to sign it.' };
    return { ok: true, rec: { explanation: ex, signed_name: t(f.signed_name).trim(), signed_by: ctx.me || '', signed_at: ctx.at || '' } };
  }

  /* ── ADW respite ── */
  const WEEK_HOURS = 49, MONTH_UNITS = 868;
  const svcText = v => { const s = (v && v.service) || {}; return [s.procedureCode, s.code, s.description, v && v.serviceCode].map(t).join(' '); };
  function isRespite(v) { return !!v && !v.removed && /S5150|respite/i.test(svcText(v)); }
  function isAdvancedRespite(v) { return isRespite(v) && (/S5150\s*-?\s*TF\b|\bTF\b/i.test(svcText(v)) || /advanced/i.test(svcText(v))); }
  const weekStart = day => { const d = new Date(day + 'T12:00:00Z'), w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); };
  /** minutes a respite visit counts for: clocked when it happened, scheduled when it is still ahead, nothing when it was not delivered */
  function respiteMinutes(v, nowIso) {
    const c = classify(v, nowIso);
    if (c.state === 'delivered') return c.minutes;
    if (c.state === 'upcoming' || c.state === 'in_progress') return c.scheduled;
    return 0;
  }
  /**
   * the respite checks for one client over a stretch of days (the schedule ahead and what happened):
   * weeks over 49 hours, the month over 868 units, respite overlapping another visit, advanced respite booked.
   */
  function respiteCheck(visits, nowIso, month) {
    const all = (visits || []).filter(v => v && !v.removed), rs = all.filter(isRespite);
    const weeks = {}; let monthMin = 0;
    for (const v of rs) {
      const day = chiDay(when(v)), m = respiteMinutes(v, nowIso);
      const wk = weekStart(day); weeks[wk] = (weeks[wk] || 0) + m;
      if (day.slice(0, 7) === month) monthMin += m;
    }
    const weekRows = Object.keys(weeks).sort().map(k => ({ week: k, hours: Math.round(weeks[k] / 6) / 10, over: weeks[k] > WEEK_HOURS * 60 }));
    const span = v => [Date.parse(v.scheduledStartDate || v.startDate), Date.parse(v.scheduledEndDate || v.endDate)];
    const overlaps = [];
    for (const r of rs) { const [a, b] = span(r); if (isNaN(a) || isNaN(b)) continue;
      for (const o of all) { if (o === r || isRespite(o)) continue; const [c, d] = span(o); if (!isNaN(c) && !isNaN(d) && a < d && c < b) overlaps.push({ day: chiDay(when(r)), respite: t(r.id), other: t(o.id), other_service: t(((o.service || {}).description) || codeOf(o)) }); } }
    const advanced = rs.filter(isAdvancedRespite).map(v => ({ id: t(v.id), day: chiDay(when(v)), caregiver: v.caregiver ? [v.caregiver.firstName, v.caregiver.lastName].filter(Boolean).join(' ') : '' }));
    const monthUnits = Math.floor(monthMin / 15);
    return { any: rs.length > 0, weeks: weekRows, over_weeks: weekRows.filter(w => w.over), month, month_units: monthUnits, month_over: monthUnits > MONTH_UNITS, overlaps, advanced };
  }

  return { RISK_IN_A_ROW, RISK_DAYS, authorized, isCare, classify, monthSummary, risk, reviewNeeds, signReview, chiDay, WEEK_HOURS, MONTH_UNITS, isRespite, isAdvancedRespite, weekStart, respiteCheck };
});
