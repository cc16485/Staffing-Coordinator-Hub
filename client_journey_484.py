#!/usr/bin/env python3
# 484 · THE CLIENT JOURNEY MOVE-OVER (Samantha 2026-10-06, her answers after the 483 look). The switch stays OFF.
#  · updates the client-journey service: routing by payer, a new lead starts its journey once someone has talked to them,
#    a lost/archived lead closes its journey, and the bridge that keeps the First shift launch (client_queue) in step
#  · who gets a new client nobody picked: Medicaid and VA to Angiel; Private Pay, LTC, Other, payer not known to Krystal
#  · turns off the older "start is stuck" items (client_start_live) and unschedules client-start-run
#  · records which leads existed at the move-over (they never start a journey by themselves; her August leads included)
#  · closes the First shift launches for Office Staff (#293, not a client) and Test Clients 5 and 6 (#290, #291)
#  · archives the blank Start of Care checklist (no name, nothing ticked)
#  · starts journeys for Tommy Fortner, Phyllis Netzer, Karen, Edward Anderson (#296) and Peggy Thomason (#295)
# Tommy Mason keeps his older First shift card. Nothing is texted or emailed. Nothing in AxisCare changes.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-484/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def probe(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    texts = []
    try:
        j = json.loads(b); texts.append(j.get("message") if isinstance(j, dict) else str(j))
    except Exception: pass
    texts.append(b.replace('\\"', '"'))
    for t in texts:
        if not t or "PROBE_RESULT: " not in t: continue
        try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + len("PROBE_RESULT: "):])[0], None
        except Exception: continue
    return None, f"HTTP {s}: {b[:240]}"
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

lit = lambda v: "'" + str(v).replace("'", "''") + "'"
ROOT = os.path.dirname(os.path.dirname(FNROOT)); CJDIR = os.path.join(ROOT, "client-journey")
FN = "client-journey"; OLD_JOB = "client-start-run"
OFFICE = ("owner_admin", "care_coordinator", "staffing_coordinator")
# Samantha's answers (2026-10-06)
LEAD_NAMES = ["Tommy Fortner", "Phyllis Netzer", "Karen"]                       # open leads that get a journey now
AX_PEOPLE = [("296", "Edward Anderson"), ("295", "Peggy Thomason")]            # AxisCare clients that get a journey now
CLOSE_LAUNCHES = [("293", "Office Staff", "Not a client: closed at the client journey move-over (Desktop 484)"),
                  ("291", "Test Client 6", "Test client: closed at the client journey move-over (Desktop 484)"),
                  ("290", "Test Client 5", "Test client: closed at the client journey move-over (Desktop 484)")]
BLANK_LEAD = "id_aadljdmgms9vl8xp"
nm = lambda l: (str(l.get("client_first_name") or "") + " " + str(l.get("client_last_name") or "")).strip() or (str(l.get("first_name") or "") + " " + str(l.get("last_name") or "")).strip()
def blob(k):
    ok, r = sql(f"select data from public.app_data where key = {lit(k)}")
    d = r[0]["data"] if ok and r else None
    return json.loads(d) if isinstance(d, str) else d

say("484 · THE CLIENT JOURNEY MOVE-OVER (the switch stays OFF until you turn it on)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(CJDIR, name.split("/", 1)[1]) if name.startswith("client-journey/") else os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p_, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
ok, r = sql("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'client_journey'")
if not (ok and r and r[0]["n"]): bad("the client journey isn't installed yet (run 482 first). Nothing was changed."); done(4)
# the two Care Coordinators her routing names must hold an office role, or routing would quietly fall through
ok, ppl = sql("select distinct lower(p.primary_email) as email, p.full_name from public.persons p join public.staff_roles r on r.person_id = p.person_id "
              "where r.entity = 'cc_ihs' and r.role in ('owner_admin','care_coordinator','staffing_coordinator') and coalesce(p.active, true) and p.primary_email is not null")
ppl = ppl if ok else []
def person(first):
    hit = [x for x in ppl if str(x["full_name"] or "").lower().split(" ")[0] == first.lower()]
    return hit[0]["email"] if len(hit) == 1 else None
KRY, ANG = person("Krystal"), person("Angiel")
chk(bool(KRY), "Krystal has an office role (gets Private Pay, LTC, Other, and payer not known yet)" if KRY else "Krystal doesn't have exactly one office role in the Hub")
chk(bool(ANG), "Angiel has an office role (gets Medicaid and VA)" if ANG else "Angiel doesn't have an office role in the Hub yet. Give her one on the Owners Hub Admin page, Team, then run this again")
if not (KRY and ANG): say("  STOP. Nothing was changed."); done(4)
ROUTES = {"medicaid": ANG, "va": ANG, "private": KRY, "ltc": KRY, "other": KRY, "unknown": KRY}
ops = blob("ops_settings") or {}
say("  · client journeys switch: " + ("ON (left as it is)" if ops.get("client_journey_live") is True else "OFF (stays off; you turn it on from the Admin page)"))
say("  · the older 'start is stuck' job (client-start-run): " + ("ON, will be turned off" if ops.get("client_start_live") is True else "already off"))
leads = [l for l in (blob("leads") or []) if isinstance(l, dict)]
picked = []
for want in LEAD_NAMES:
    hit = [l for l in leads if nm(l) == want and not l.get("archived") and l.get("status") != "Lost"]
    if len(hit) == 1: picked.append(hit[0]); say(f"  · {want}: found ({hit[0].get('status')}, {hit[0].get('funding_source') or 'payer not set'})")
    else: bad(f"{want}: {'not found' if not hit else str(len(hit)) + ' open leads have that name'}, so no journey is started for them here (use Start the journey on their profile)")
blank = next((l for l in leads if str(l.get("id")) == BLANK_LEAD), None)
blank_ok = bool(blank) and not nm(blank) and not any(isinstance(s_, dict) and s_.get("done_at") for s_ in ((blank.get("soc") or {}).get("steps") or [])) and not blank.get("archived")
say("  · the blank Start of Care checklist: " + ("still blank, will be archived" if blank_ok else "already archived or no longer blank, left alone" if blank else "not found, nothing to do"))
cols = {x["column_name"] for x in (sql("select column_name from information_schema.columns where table_schema='public' and table_name='client_queue'")[1] or [])}
launches = []
for ax, name, why in CLOSE_LAUNCHES:
    ok, r = sql(f"select id, client_name, status from public.client_queue where axiscare_client_id = {lit(ax)} and coalesce(status,'') <> 'complete'")
    rows = r if ok else []
    if len(rows) == 1 and str(rows[0]["client_name"]).strip() == name: launches.append((rows[0]["id"], ax, name, why)); say(f"  · First shift launch {name} (#{ax}): open, will be closed")
    else: say(f"  · First shift launch {name} (#{ax}): " + ("not open any more, left alone" if not rows else "doesn't match, left alone"))
ok, r = sql(f"select count(*)::int as n from cron.job where jobname = {lit(OLD_JOB)}")
old_job = bool(ok and r and r[0]["n"])

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(CJDIR, "move-over.sql")).read())
if not ok: bad("the two new journey columns didn't install: " + str(r)[:240]); say("  STOP. Nothing else was changed."); done(5)
say("  ✓ journeys remember how their Care Coordinator was picked, and which First shift launch they speak for")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing else was changed."); done(6)
say("  ✓ the client-journey service updated (routing by payer, new leads start once contacted, the First shift bridge)")
patch = {"client_journey_routing": ROUTES, "client_start_live": False}
ok, r = sql(f"update public.app_data set data = coalesce(data, '{{}}'::jsonb) || {lit(json.dumps(patch))}::jsonb where key = 'ops_settings' returning 1")
chk(ok and r, "who gets a new client: Medicaid and VA to Angiel; Private Pay, LTC, Other and payer not known yet to Krystal (change it in Hub settings, Client journeys)")
chk(ok and r, "the older 'start is stuck' items are off")
if old_job:
    ok, r = sql(f"select cron.unschedule({lit(OLD_JOB)})"); chk(ok, "the older client-start-run job is unscheduled")
ok, r = sql("select count(*)::int as n from public.app_data where key = 'client_journey_cutover'")
if ok and r and r[0]["n"]: say("  · the move-over record was already there (kept)")
else:
    rec = {"at": dt.datetime.now(dt.timezone.utc).isoformat(), "by": "Desktop 484", "lead_ids": [str(l.get("id")) for l in leads if l.get("id") is not None],
           "note": "Leads that existed at the move-over never start a journey by themselves. New leads start once someone has talked to them."}
    ok, r = sql(f"insert into public.app_data (key, data) values ('client_journey_cutover', {lit(json.dumps(rec))}::jsonb) on conflict (key) do nothing returning 1")
    chk(ok, f"the move-over record: the {len(rec['lead_ids'])} leads that exist now won't start a journey by themselves (your August leads included)")
for qid, ax, name, why in launches:
    sets = ["status = 'complete'"] + [f"{c} = now()" for c in ("completed_at", "launch_completed_at") if c in cols] + ([f"exception_reason = {lit(why)}"] if "exception_reason" in cols else [])
    ok, r = sql(f"update public.client_queue set {', '.join(sets)} where id = {lit(qid)} and axiscare_client_id = {lit(ax)} and coalesce(status,'') <> 'complete' returning id")
    chk(ok and r, f"closed the First shift launch {name} (#{ax}): {why.split(':')[0].lower()}")
if blank_ok:
    pa = {"archived": True, "archived_at": dt.datetime.now(dt.timezone.utc).isoformat(), "archived_by": "Desktop 484", "archive_note": "Blank Start of Care checklist (no name, nothing ticked), archived at the client journey move-over. Unarchive to bring it back."}
    ok, r = sql("update public.app_data set data = (select jsonb_agg(case when x->>'id' = " + lit(BLANK_LEAD) + " then x || " + lit(json.dumps(pa)) + "::jsonb else x end order by o) from jsonb_array_elements(data) with ordinality t(x, o)) where key = 'leads' returning 1")
    chk(ok and r, "archived the blank Start of Care checklist (it can be unarchived)")
people = [{"lead_id": str(l["id"])} for l in picked] + [{"axiscare_client_id": a, "client_name": n} for a, n in AX_PEOPLE]
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "adopt", "people": people}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: ad = json.loads(b).get("adopted") or []
except Exception: ad = []
if s != 200: bad(f"starting the journeys didn't answer ({s}). Everything above is in; run this again to finish.")
names = {**{str(l["id"]): nm(l) for l in picked}, **{a: n for a, n in AX_PEOPLE}}
who = lambda e: (str(e or "").split("@")[0] or "?").capitalize()
for x in ad:
    label = names.get(str(x.get("lead_id") or x.get("axiscare_client_id")), "?")
    if x.get("outcome") == "created": say(f"  ✓ journey started: {label} · {who(x.get('assigned_cc'))} ({x.get('how')}) · stage {x.get('stage')}")
    elif x.get("outcome") == "exists": say(f"  · {label} already had a journey (kept)")
    else: bad(f"{label}: no journey ({x.get('error') or x.get('outcome')})")

say(); say("PART 3 · PROOF (nothing is texted or emailed)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "list"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 in (401, 403), f"a page without a staff sign-in is refused ({s1})")
ops2 = blob("ops_settings") or {}
chk(ops2.get("client_journey_routing") == ROUTES and ops2.get("client_start_live") is False, "the routing and the older job's switch read back")
chk(ops2.get("client_journey_live") == ops.get("client_journey_live"), "the client journeys switch is as it was (" + ("ON" if ops2.get("client_journey_live") is True else "OFF") + ")")
ok, r = sql(f"select count(*)::int as n from cron.job where jobname = {lit(OLD_JOB)}"); chk(ok and r and r[0]["n"] == 0, "the older client-start-run job is gone")
ok, r = sql("select client_name, assigned_cc, assigned_how from public.client_journey where not is_test order by client_name")
real = r if ok else []
chk(len(real) >= len(people) - sum(1 for x in ad if x.get("outcome") not in ("created", "exists")), f"{len(real)} real client journey(s): " + ", ".join(f"{x['client_name']} ({who(x['assigned_cc'])})" for x in real))
items = blob("ops_items") or []
jc = [i for i in items if isinstance(i, dict) and i.get("kind") == "journey" and i.get("status") == "open" and not i.get("is_test")]
if ops2.get("client_journey_live") is True: say(f"  · {len(jc)} client journey card(s) on My Work")
else: chk(not jc, "switched off: no real journey shows on anyone's My Work yet")
say()
say("RESULT: " + ("DONE · Turn it on from the Owners Hub Admin page, Switches, Clients: Client journeys. Within 10 minutes each journey's next step is on its Care Coordinator's My Work."
                   if not fails else "CHECK THE ✗ LINES."))
say("Tommy Mason finishes on his older First shift card. Nothing was texted or emailed. Nothing in AxisCare changed.")
done(0 if not fails else 8)
