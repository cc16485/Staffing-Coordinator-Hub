#!/usr/bin/env node
// JOURNEYS STILL AT INTAKE FOR CLIENTS ALREADY RECEIVING CARE (READ ONLY). 2026-10-15.
// Dan Probstfield (AxisCare #297) is receiving care, yet his client journey sits at "Talking · intake" with steps like
// "Book the in-home assessment", and those steps write My Work cards. Hub PR #420 hides it on his profile only.
// This lists EVERY open or active client journey whose client is receiving care (an active client role from AxisCare,
// or an open Pause care) while the journey's stage is intake, pre-checks or assessment, the same test the Hub page uses
// (profile-top.js: INTAKE = intake/prechecks/assessment, IN_CARE = active/paused; care.ts careState()).
// The stage is worked out by the real rules file (_shared/journey-rules.js), so it is what the Hub shows.
// Reads only (select statements). Writes nothing, sends nothing.
// Env: SB_TOKEN (Supabase access token), SB_REPORT (report path), RULES (path to journey-rules.js, default next to the repo copy).
//      SB_FAKE=<json file> answers the queries instead (rehearsal and tests).
'use strict';
const fs = require('fs'), path = require('path');
const REPORT = process.env.SB_REPORT, TOKEN = String(process.env.SB_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
const FAKE = process.env.SB_FAKE ? JSON.parse(fs.readFileSync(process.env.SB_FAKE, 'utf8')) : null;
const R = require(process.env.RULES || path.join(__dirname, 'supabase/functions/_shared/journey-rules.js'));
const API = 'https://api.supabase.com', REF = 'zngsgedlsxinbygwmxwn';
const INTAKE = ['intake', 'prechecks', 'assessment'], IN_CARE = ['active', 'paused'];
const lines = [], fails = [];
const say = (s = '') => { s = String(s).replace(/(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+/g, '(hidden)'); console.log(s); lines.push(s); };
const bad = s => { say('  ✗ ' + s); fails.push(s); };
const done = c => { if (REPORT) fs.writeFileSync(REPORT, lines.join('\n') + '\n'); process.exit(c); };

async function sql(name, q) {
  if (FAKE) return name in FAKE ? [true, FAKE[name]] : [false, 'no fake for ' + name];
  if (!/^\s*(select|with)\b/i.test(q)) return [false, 'refused: not a read'];
  try {
    const r = await fetch(`${API}/v1/projects/${REF}/database/query`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'cc-journey-incare/1.0', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ query: q }) });
    const b = await r.text();
    if (!r.ok) return [false, `HTTP ${r.status}: ${b.slice(0, 300)}`];
    return [true, JSON.parse(b)];
  } catch (e) { return [false, e.name || 'error']; }
}
async function rows(name, q) { const [ok, r] = await sql(name, q); if (!ok) { bad(`could not read ${name}: ${r}`); return null; } return r; }

/** the same as care.ts careState() */
function careState(roles, pause, journeys) {
  const rs = (roles || []).filter(r => r && r.role === 'client');
  if (rs.some(r => /deceas/i.test(String(r.end_reason || ''))) && !rs.some(r => r.status === 'active')) return 'deceased';
  if (pause) return 'paused';
  if (rs.some(r => r.status === 'active')) return 'active';
  if ((journeys || []).some(j => j.status === 'open')) return 'starting';
  if (rs.length) return 'past';
  return 'unknown';
}
const digits = v => /^\d+$/.test(String(v ?? '').trim()) ? String(v).trim() : '';

/** pure: who is receiving care but still on an intake journey. Exported for the test. */
function plan(d, today) {
  const leads = new Map((d.leads || []).filter(l => l && l.id != null).map(l => [String(l.id), l]));
  const personOf = new Map((d.links || []).map(x => [String(x.source_id), x.person_id]));
  const rolesOf = new Map(); (d.roles || []).forEach(r => { if (!rolesOf.has(r.person_id)) rolesOf.set(r.person_id, []); rolesOf.get(r.person_id).push(r); });
  const pauseOf = new Map((d.pauses || []).map(p => [String(p.axiscare_client_id), p]));
  const defs = (d.defs || []).map(r => ({ ...r.def, key: r.key, active: r.active !== false && (r.def || {}).active !== false }));
  const ctx = { today, owner_emails: d.owners || [], staffing_email: d.staffing || null };
  const stepsOf = new Map(); (d.steps || []).forEach(s => { if (!stepsOf.has(s.journey_id)) stepsOf.set(s.journey_id, []); stepsOf.get(s.journey_id).push(s); });
  const items = (d.ops_items || []).filter(x => x && x.status === 'open' && String(x.id || '').startsWith('ops_jr_'));
  const hits = [], later = [];
  for (const j of d.journeys || []) {
    if (j.is_test || !['open', 'active'].includes(j.status)) continue;
    const lead = j.lead_id != null ? leads.get(String(j.lead_id)) : null;
    const ax = digits(j.axiscare_client_id) || digits(lead && lead.axiscare_client_id);
    if (!ax) continue;
    const how = digits(j.axiscare_client_id) ? 'journey' : 'lead';
    const pid = personOf.get(ax);
    const care = careState(pid ? rolesOf.get(pid) : [], pauseOf.get(ax) || null, [j]);
    if (!IN_CARE.includes(care)) continue;
    const v = R.compute(defs, j, stepsOf.get(j.journey_id) || [], ctx);
    const pre = 'ops_jr_' + String(j.journey_id).replace(/-/g, '').slice(0, 12) + '_';
    const cards = items.filter(x => x.journey_id === j.journey_id || String(x.id).startsWith(pre));
    const row = { journey_id: j.journey_id, name: j.client_name || (lead && (lead.client_name || lead.name)) || '(no name)', ax, how, care,
      status: j.status, stage: v.stage, stage_label: v.stageLabel, next: v.next ? v.next.def.title : '', next_status: v.next ? v.next.status : '',
      cc: j.assigned_cc || '', created: String(j.created_at || '').slice(0, 10), payer: j.payer || '',
      cards: cards.map(c => ({ owner: c.owner || '', title: c.title || '', urgency: c.urgency || '', due: c.due || '', late: !!(c.due && String(c.due).slice(0, 10) < today && !c.sub_state) })) };
    (INTAKE.includes(v.stage) ? hits : later).push(row);
  }
  const by = (a, b) => a.name.localeCompare(b.name);
  return { hits: hits.sort(by), later: later.sort(by) };
}

async function main() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  say('JOURNEYS STILL AT INTAKE FOR CLIENTS ALREADY RECEIVING CARE (READ ONLY)');
  say('Report ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC · today in Springfield ' + today); say();
  if (!FAKE && !TOKEN.startsWith('sbp_')) { bad('no Supabase access token'); done(2); }
  const J = await rows('journeys', "select to_jsonb(j) as j from public.client_journey j where j.subject = 'client' and j.status in ('open','active')");
  const S = await rows('steps', "select to_jsonb(s) as s from public.client_journey_step s join public.client_journey j using (journey_id) where j.subject = 'client' and j.status in ('open','active')");
  const D = await rows('defs', 'select key, def, active from public.client_journey_step_def');
  const LD = await rows('leads', "select data from public.app_data where key = 'leads'");
  const LK = await rows('links', "select person_id::text as person_id, source_id from public.person_source_id where system = 'axiscare' and entity_type = 'client'");
  const RL = await rows('roles', "select person_id::text as person_id, role, status, end_reason from public.person_role where role = 'client'");
  const PS = await rows('pauses', "select axiscare_client_id, client_name, followup_date::text as followup_date from public.client_pause where status = 'open'");
  const OI = await rows('ops_items', "select data from public.app_data where key = 'ops_items'");
  const SR = await rows('owners', "select lower(p.primary_email) as email, r.role from public.staff_roles r join public.persons p using (person_id) where r.entity = 'cc_ihs' and p.active is not false and p.primary_email is not null");
  const OS = await rows('settings', "select data -> 'client_journey_staffing_default' as staffing from public.app_data where key = 'ops_settings'");
  if ([J, S, D, LD, LK, RL, PS].includes(null)) { say(); say('Stopped: something needed could not be read, so a list would not be true.'); done(3); }
  const d = { journeys: J.map(r => r.j), steps: S.map(r => r.s), defs: D,
    leads: LD[0] && Array.isArray(LD[0].data) ? LD[0].data : [], links: LK, roles: RL, pauses: PS,
    ops_items: OI && OI[0] && Array.isArray(OI[0].data) ? OI[0].data : [],
    owners: (SR || []).filter(r => r.role === 'owner_admin').map(r => r.email),
    staffing: (OS && OS[0] && OS[0].staffing) || ((SR || []).find(r => r.role === 'staffing_coordinator') || {}).email || null };
  const real = d.journeys.filter(j => !j.is_test);
  say(`Open or active client journeys: ${real.length} real (${real.filter(j => j.status === 'open').length} open, ${real.filter(j => j.status === 'active').length} active)`);
  say(`Clients receiving care by the database: ${new Set(d.roles.filter(r => r.status === 'active').map(r => r.person_id)).size} active, ${d.pauses.length} paused`); say();
  const p = plan(d, today);
  say(`A · RECEIVING CARE, JOURNEY STILL AT INTAKE / PRE-CHECKS / ASSESSMENT: ${p.hits.length}`);
  const cnt = {}; p.hits.forEach(h => { cnt[h.stage_label] = (cnt[h.stage_label] || 0) + 1; });
  Object.entries(cnt).forEach(([k, n]) => say(`  ${k}: ${n}`));
  say(`  with open My Work cards: ${p.hits.filter(h => h.cards.length).length} people, ${p.hits.reduce((n, h) => n + h.cards.length, 0)} cards, ${p.hits.reduce((n, h) => n + h.cards.filter(c => c.late).length, 0)} of them late`); say();
  for (const h of p.hits) {
    say(`  ${h.name} · AxisCare #${h.ax} (${h.care}${h.how === 'lead' ? ', number from the lead' : ''})`);
    say(`    journey ${h.journey_id.slice(0, 8)} ${h.status}, started ${h.created || '?'}, stage ${h.stage_label}, Care Coordinator ${h.cc || '(none)'}${h.payer ? ', ' + h.payer : ''}`);
    say(`    next step: ${h.next || '(none)'}${h.next_status ? ' [' + h.next_status + ']' : ''}`);
    h.cards.forEach(c => say(`    My Work card for ${c.owner || '?'}: ${c.title}${c.late ? ' · LATE (due ' + String(c.due).slice(0, 10) + ')' : ''}${c.urgency && c.urgency !== 'normal' ? ' · ' + c.urgency : ''}`));
  }
  say();
  say(`B · RECEIVING CARE, JOURNEY PAST THE ASSESSMENT (for comparison, not part of the fix): ${p.later.length}`);
  for (const h of p.later) say(`  ${h.name} · AxisCare #${h.ax} (${h.care}) · ${h.status} · ${h.stage_label} · next: ${h.next || '(none)'} · cards ${h.cards.length}`);
  say();
  say('Nothing was changed. ' + (fails.length ? 'Some parts could not be read (marked ✗ above).' : 'Every part was read.'));
  done(fails.length ? 1 : 0);
}
module.exports = { plan, careState };
if (require.main === module) main().catch(e => { bad('stopped: ' + (e && e.message || e)); done(4); });
