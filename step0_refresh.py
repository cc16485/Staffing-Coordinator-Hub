#!/usr/bin/env python3
# Step 0 · 0.0 · the read-only live refresh (Desktop 268). CHANGES NOTHING.
# Every query goes through read(), which refuses anything that is not a SELECT / WITH.
# Phone numbers print as their last 4 digits only. Tokens inside scheduled-job commands never print.
# It reports: automatic senders and their switches, scheduled jobs, alert phones, admin accounts and
# Journey seats, whether inbound texts have arrived since Sept 19, opt-out counts, and open old
# "coverage gap / call-out" messages. It infers nothing about who should be in Shared Admin or whether
# the office line is monitored: those are Samantha's to confirm.
import json, os, re, urllib.request, urllib.error, datetime as dt
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
REPORT = os.environ["SB_REPORT"]; API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
import sys, traceback
def _crash(t, v, tb):
    # an unexpected value must never lose the report: write what we have plus the error
    lines.append(""); lines.append("✗ UNEXPECTED ERROR (the report above is partial; nothing was changed): " + repr(v))
    lines.append("  at: " + " / ".join(f"line {f.lineno}" for f in traceback.extract_tb(tb)[-3:]))
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
    print(lines[-2], flush=True)
sys.excepthook = _crash
S = lambda v, d="": d if v is None else str(v)
def read(q):
    if not re.match(r"^\s*(select|with)\b", q, re.I) or re.search(r"\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b", q, re.I):
        return False, "refused: not a read-only query"
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-step0-refresh/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r: return True, json.loads(r.read())
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}"
    except Exception as e: return False, f"{type(e).__name__}: {e}"
def last4(v):
    d = re.sub(r"\D", "", str(v or ""))
    return ("…" + d[-4:]) if len(d) >= 4 else "(none)"
def phones(v):
    try: arr = v if isinstance(v, list) else json.loads(v) if isinstance(v, str) else []
    except Exception: arr = [v]
    return ", ".join(last4(x if not isinstance(x, dict) else x.get("phone")) for x in arr) or "(not set)"

say("STEP 0 · LIVE REFRESH · READ ONLY, nothing is changed")
say("Report " + dt.datetime.now().strftime("%Y-%m-%d %H:%M") + " (Central, this Mac)")
say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was read."); done(1)

say("── 1. SCHEDULED JOBS (every automatic run) ─────────────")
ok, jobs = read("""select jobname, schedule, active, command from cron.job order by jobname""")
if not ok: say("✗ " + str(jobs))
else:
    for j in jobs:
        m = re.search(r"/functions/v1/([a-z0-9-]+)", j.get("command") or "")
        target = m.group(1) if m else ("sql: " + re.sub(r"\s+", " ", (j.get("command") or ""))[:40])
        say(f"  {S(j.get('jobname')):<36} {S(j.get('schedule')):<16} {'ACTIVE' if j.get('active') else 'paused':<7} → {target}")
say()

say("── 2. SWITCHES (ops_settings) ──────────────────────────")
ok, st = read("select data from app_data where key = 'ops_settings'")
settings = {}
if not ok or not st: say("✗ could not read ops_settings: " + str(st))
else:
    settings = st[0]["data"] if isinstance(st[0]["data"], dict) else json.loads(st[0]["data"] or "{}")
    for k in sorted(settings):
        v = settings[k]
        if "phone" in k: say(f"  {k:<40} {phones(v)}")
        elif isinstance(v, bool) or isinstance(v, (int, float)): say(f"  {k:<40} {v}")
        elif isinstance(v, str) and len(v) <= 60: say(f"  {k:<40} {v}")
        else: say(f"  {k:<40} ({type(v).__name__}, not shown)")
    for need in ("inquiry_followups_live", "inquiry_ack_live"):
        if need not in settings: say(f"  {need:<40} (not present yet; 0a adds it)")
say()

say("── 3. CAMPAIGN SWITCHES (campaign_settings) ────────────")
ok, cs = read("""select x from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x
                  where key='campaign_settings' and x->>'id'='settings'""")
if not ok: say("✗ " + str(cs))
elif not cs: say("  No campaign settings row: every audience is off.")
else:
    x = cs[0]["x"]
    for k, label in (("enabled", "master switch"), ("aud_monthly", "open leads"), ("aud_clients", "ACTIVE CLIENTS"),
                     ("aud_client_contacts", "CLIENT CONTACTS (families)"), ("aud_caregivers", "caregivers")):
        say(f"  {label:<28} {'ON' if str(x.get(k)).lower() == 'true' else 'off'}")
say()

say("── 4. WHO THE OFFICE ALERTS GO TO ──────────────────────")
say(f"  coverage_alert_phones      {phones(settings.get('coverage_alert_phones'))}")
say(f"  timekeeper_alert_phones    {phones(settings.get('timekeeper_alert_phones'))}")
say(f"  ops escalation fallback    {last4(settings.get('fallback_phone'))}")
ok, aa = read("""select name, coalesce(phone,'') as phone, coalesce(email,'') as email, alert_on from applicant_alerts where active = true order by name""")
if ok:
    say("  applicant_alerts (also used for 'lead waiting' alerts):")
    for r in aa: say(f"    {S(r.get('name'), '(no name)'):<24} phone {last4(r.get('phone'))}  email {S(r.get('email')) or '-'}  on {S(r.get('alert_on'))}")
else: say("  ✗ applicant_alerts: " + str(aa))
say("  Whether anyone actually monitors these numbers after hours is for Samantha to confirm.")
say()

say("── 5. ADMIN ACCOUNTS AND AUTHORITY (facts only) ────────")
ok, us = read("""select email, coalesce(raw_app_meta_data->'hub_access','null'::jsonb)::text as hub_access,
                        to_char(last_sign_in_at at time zone 'America/Chicago','YYYY-MM-DD') as last_sign_in
                   from auth.users order by email""")
if ok:
    say("  Sign-in accounts (hub access · last sign-in):")
    for r in us: say(f"    {S(r.get('email'), '(no email)'):<34} {S(r.get('hub_access')):<40} {S(r.get('last_sign_in')) or 'never'}")
else: say("  ✗ auth.users: " + str(us))
ok, cst = read("""select x->>'name' as name, lower(coalesce(x->>'email','')) as email, coalesce(x->>'active','true') as active
                    from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x
                   where key='coordinator_staff' order by 1""")
if ok:
    say("  Coordinator staff list:")
    for r in cst: say(f"    {S(r.get('name'), '(no name)'):<24} {S(r.get('email')) or '-':<30} active {S(r.get('active'))}")
ok, js = read("select email, seat from journey_seat_member order by seat, email")
if ok:
    say("  Journey seats (needed to record a Start Contract or connect a Journey):")
    for r in js: say(f"    {S(r.get('seat')):<16} {S(r.get('email'))}")
    if not js: say("    (nobody holds a Journey seat)")
else: say("  ✗ journey_seat_member: " + str(js))
say("  NOT inferred: which of these are the Shared Admin pool. Samantha confirms that.")
say()

say("── 6. INBOUND TEXTS SINCE SEPT 19 ──────────────────────")
ok, ev = read("""select verb, count(*)::int as n, max(at)::text as latest from op_events
                  where verb in ('lead_reply_received','lead_opted_out') group by verb order by verb""")
if ok:
    for r in ev: say(f"  {S(r.get('verb')):<22} ×{S(r.get('n'))}  latest {S(r.get('latest'))[:16]}")
    if not ev: say("  No lead replies or opt-outs recorded, ever.")
ok, tf = read("""select count(*)::int as n, count(*) filter (where x->>'opened_at' >= '2026-09-19')::int as since,
                        coalesce(max(x->>'opened_at'),'never') as latest
                   from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x
                  where key='coverage_cases' and x->>'flag_source'='text message'""")
if ok and tf: say(f"  caregiver texts flagged as call-offs: ×{S(tf[0].get('n'))} ({S(tf[0].get('since'))} since Sept 19)  latest {S(tf[0].get('latest'))[:16]}")
ok, dl = read("""select count(*)::int as n from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x
                  where key='call_disposition_log' and (x::text ilike '%"sms": true%' or x::text ilike '%sms%reply%')""")
if ok and dl: say(f"  text-message entries in the call-disposition log (last 50 kept): {dl[0]['n']}")
say()

say("── 7. OPT-OUTS WE ALREADY HOLD ─────────────────────────")
ok, oo = read("""select count(*) filter (where (x->>'do_not_contact')='true')::int as dnc, count(*)::int as total
                   from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x where key='leads'""")
if ok and oo: say(f"  inquiries marked do-not-contact: {S(oo[0].get('dnc'))} of {S(oo[0].get('total'))}")
elif not ok: say("  ✗ leads: " + str(oo))
ok, cc = read("select count(*) filter (where stopped_at is not null)::int as stopped, count(*)::int as total from circle_contacts")
if ok and cc: say(f"  Family Circle contacts marked stopped: {S(cc[0].get('stopped'))} of {S(cc[0].get('total'))}")
elif not ok: say("  ✗ circle_contacts: " + str(cc))
ok, ps = read("""select count(*)::int as n from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x where key='phone_suppress'""")
if ok and ps: say(f"  suppressed numbers (spam/sales list): {ps[0]['n']}")
say()

say("── 8. INQUIRY MESSAGES: how active the sender has been ─")
ok, lf = read("""select count(*) filter (where x->>'ack_sent_at' >= to_char(now() - interval '30 days','YYYY-MM-DD'))::int as ack30,
                        count(*) filter (where x->>'nudge_1_at'  >= to_char(now() - interval '30 days','YYYY-MM-DD'))::int as n1_30,
                        count(*) filter (where x->>'nudge_2_at'  >= to_char(now() - interval '30 days','YYYY-MM-DD'))::int as n2_30
                   from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x where key='leads'""")
if ok and lf: say(f"  last 30 days: {lf[0]['ack30']} acknowledgments · {lf[0]['n1_30']} day-1 follow-ups · {lf[0]['n2_30']} day-3 follow-ups")
say()

say("── 9. OPEN OLD 'COVERAGE GAP / CALL-OUT' MESSAGES ───────")
ok, om = read("""select coalesce(x->>'about','') as about, left(coalesce(x->>'message',''),120) as message,
                        coalesce(x->>'from_name','') as from_name, left(coalesce(x->>'created_at',''),16) as at
                   from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x
                  where key='staffing_tasks' and x->>'kind'='coverage' and coalesce(x->>'status','open')='open' order by 4""")
if not ok: say("✗ " + str(om))
elif not om: say("  None open.")
else:
    say(f"  {len(om)} open (shown to Samantha; nothing converted or closed):")
    for r in om: say(f"    {S(r.get('at'))}  {S(r.get('about')) or '(no client named)'} · from {S(r.get('from_name'))}: {S(r.get('message'))}")
say()

say("── 10. DUTY WINDOWS AND ON-CALL (recorded, not used by Shared Admin) ─")
ok, dw = read("""select x->>'area' as area, coalesce(x->>'person','') as person, coalesce((x->'recur'->'days')::text,(x->'days')::text,'') as days,
                        coalesce(x->'recur'->>'from',x->>'from','') as f, coalesce(x->'recur'->>'to',x->>'to','') as t, coalesce(x->>'status','') as status
                   from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x
                  where key='duty_windows' and coalesce(x->>'active','true') <> 'false' order by 1,2""")
if ok:
    for w in dw: say(f"  {S(w.get('area'), '(no area)'):<16} {S(w.get('person')) or '(no person)':<28} days {S(w.get('days'))} {S(w.get('f'))}-{S(w.get('t'))} {('['+S(w.get('status'))+']') if w.get('status') else ''}")
ok, oc = read("""select x->>'name' as name, x->>'start_date' as s, x->>'end_date' as e
                   from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x where key='on_call_schedule' order by 2""")
if ok:
    for r in oc: say(f"  on-call listing: {S(r.get('name'))} ({S(r.get('s'))} to {S(r.get('e'))})")
say()
say("══ DONE · nothing was changed ══════════════════════════")
done(0)
