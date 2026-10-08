#!/usr/bin/env python3
# 501 · PAST CLIENTS FROM AXISCARE (Samantha 2026-10-08: previews approved with "Resume care"; no sympathy card for imported
# deceased clients). Deploys the temporary client-history-import function, runs it once, and DELETES it again, so nothing
# stays live. SB_MODE=look (Desktop 501a): reads AxisCare and says exactly who would come in and who would be left out and
# why; nothing is written. SB_MODE=import (Desktop 501): the same, then adds them as past clients (a person, their AxisCare
# number, an ended client role; no phone, email, journey, card or task) and proves it. Nothing is texted or emailed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; MODE = os.environ.get("SB_MODE", "look"); FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); FN = "client-history-import"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-501/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
jl = lambda b: (lambda: json.loads(b))() if b and b[:1] in "[{" else {}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:300]
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def fmeta():
    s = None
    for i in range(4):
        s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
        if s in (200, 404): return s
        time.sleep(3 * (i + 1))
    return s
def remove_fn():
    http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    gone = fmeta() == 404
    say("  ✓ the temporary import function was deleted again (nothing stays live)") if gone else bad("the temporary import function could not be deleted; tell Claude (it answers only the server key)")
    return gone
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200])
    try: remove_fn()
    except Exception: pass
    say("  Tell Claude."); open(REPORT, "w").write("\n".join(lines) + "\n")
sys.excepthook = _crash
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
names = lambda xs: ", ".join(f"{x['name']} ({x.get('label', '')})" for x in xs) or "none"

look = MODE != "import"
say("501a · PAST CLIENTS FROM AXISCARE: LOOK ONLY" if look else "501 · PAST CLIENTS FROM AXISCARE: IMPORT")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, name); have = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have == want else bad(f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
ok, r = sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'person_role' and column_name = 'ended_date_basis'")
if not (ok and r and r[0]["n"] == 1): bad("the 'on or before' mark (499) is not in the database: nothing runs"); done(2)
say("  ✓ the 'on or before' end-date mark is there (499)")
st = fmeta()
if st == 200: say("  · a copy of the import function was left from an earlier run; it is replaced by this reviewed build and deleted after")
elif st != 404: bad(f"could not check for the import function ({st})"); done(2)
ok, r = sql("select count(*)::int as n from public.person_source_id where evidence like 'historical import (Desktop 501%'")
say(f"  · past clients already imported by 501: {r[0]['n'] if ok and r else '?'}")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); k = jl(kb)
keys = {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
SVC = keys.get("service_role", ""); HIDE.append(SVC)
if not SVC: bad("the server key could not be read: nothing runs"); done(2)

say(); say("PART 2 · " + ("LOOK (the function runs, reads AxisCare, writes nothing)" if look else "IMPORT"))
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("the import function did not deploy: " + (p.stderr or p.stdout)[-200:]); remove_fn(); done(5)
say("  ✓ the temporary import function is up (it answers only the server key)")
j = {}
for i in range(3):
    s, b = http("GET", f"{BASE}/functions/v1/{FN}" + ("" if look else "?commit=1"), headers={"Authorization": "Bearer " + SVC, "apikey": SVC}, timeout=400); j = jl(b)
    if s == 200 and j.get("mode"): break
    if s in (401, 502) or (s == 200 and not j.get("mode")): break
    time.sleep(5)
SVC = ""
if not (s == 200 and j.get("mode") == ("look" if look else "import")):
    bad(f"the run answered {s}: {str(j.get('error') or b)[:300]}"); remove_fn(); say("  RESULT: STOPPED. " + ("Nothing was written." if look else "Tell Claude; the report above says what happened.")); done(6)
remove_fn()
ni = j["not_imported"]
say(f"  · AxisCare holds {j['axiscare_total']} clients ever: " + ", ".join(f"{v} {k}" for k, v in sorted(j["by_label"].items(), key=lambda x: -x[1])))
say(f"  · current clients (left alone): {j['active']} · not clients (leads, prospects): {j['not_clients']} · past clients already in the Hub (left alone): {j['already_in_hub']}")
say(f"  · the Hub already holds {j['axiscare_clients_linked_in_hub']} of AxisCare's clients; it read all {j['hub_people_read']} people in the Hub to check names")
say(f"  {'·' if look else '✓'} {'would come in' if look else 'came in'} as past clients: {j['to_import'] if look else j['imported']} ({j['to_import_past']} past, {j['to_import_deceased']} deceased)")
say(f"      end date from AxisCare (exact): {j['with_axiscare_end_date']} · no usable AxisCare end date, so 'on or before {j['today']}': {j['on_or_before']}")
say("      no phone, email, journey, card or task for any of them; no sympathy-card task for the deceased")
if j["twins_in_axiscare"]: say("      ○ same name twice in AxisCare (kept as separate people, nothing merged): " + names(j["twins_in_axiscare"]))
say("  · NOT brought in, for a person to decide (nothing is guessed):")
say("      no start date in AxisCare (may never have started care): " + str(len(ni["no_start_date"])) + (": " + names(ni["no_start_date"]) if ni["no_start_date"] else ""))
say("      test or example records (never imported): " + str(len(ni["test_records"])) + (": " + names(ni["test_records"]) if ni["test_records"] else ""))
say("      same name as someone already in the Hub (same human? a person decides): " + str(len(ni["same_name_as_someone_in_hub"])) + (": " + names(ni["same_name_as_someone_in_hub"]) if ni["same_name_as_someone_in_hub"] else ""))
say("      on hold in AxisCare, not in the Hub: " + str(len(ni["on_hold_in_axiscare"])) + (": " + names(ni["on_hold_in_axiscare"]) if ni["on_hold_in_axiscare"] else ""))
if ni["no_name"]: say(f"      no name in AxisCare: {ni['no_name']}")
if j["older_backfill_same_day_end"]: say(f"  ○ {j['older_backfill_same_day_end']} past client(s) already in the Hub show an end date equal to their start date (an older backfill's habit). Not changed; tell Claude if you want them reviewed.")
say(); say("  " + ("WHO WOULD COME IN" if look else "WHO CAME IN") + f" ({len(j['import_list'])}): name · AxisCare status · care started · care ended")
for x in sorted(j["import_list"], key=lambda x: x["name"].lower()):
    say(f"      {x['name']} · {x['label']} · {x['started_at']} · " + (x["ended_at"] if x["ended_date_basis"] == "exact" else f"on or before {x['ended_at']} (no AxisCare end date)"))
if j.get("errors"): bad(f"{len(j['errors'])} could not be added (each taken back whole): " + "; ".join(j["errors"])[:400])

if not look:
    say(); say("PART 3 · PROOF (nothing is texted or emailed)")
    ok, r = sql("""with imp as (select person_id, source_id from public.person_source_id where evidence like 'historical import (Desktop 501%')
      select (select count(*) from imp)::int as people,
        (select count(*) from public.person_role r join imp using (person_id) where r.role = 'client' and r.status = 'former' and r.ended_at is not null)::int as ended,
        (select count(*) from public.person_role r join imp using (person_id) where r.status = 'active')::int as active,
        (select count(*) from public.person_identity p join imp on imp.person_id = p.id where p.primary_phone is not null)::int as phones,
        (select count(*) from public.client_journey j join imp on imp.source_id = j.axiscare_client_id)::int as journeys""")
    x = r[0] if ok and r else {}
    say(f"  ✓ {x.get('people')} imported people, every one an ended client role") if ok and x.get("people") == x.get("ended") and x.get("people", 0) >= j["imported"] else bad(f"the imported roles don't add up: {x}")
    say("  ✓ none is active, none has a phone, none has a journey") if ok and not x.get("active") and not x.get("phones") and not x.get("journeys") else bad(f"something extra is attached: {x}")
    ok, r = sql("""with ended as (select person_id from public.person_role where role = 'client' group by person_id having not bool_or(status = 'active'))
      select count(*)::int as n from public.person_source_id where evidence like 'historical import (Desktop 501%' and person_id not in (select person_id from ended)""")
    say("  ✓ every one is on the list the shift jobs skip; campaigns treat them as past (left out)") if ok and r and r[0]["n"] == 0 else bad(f"some are not on the shift jobs' quiet list: {r}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
if look: say(f"RESULT: LOOK DONE · {j['to_import']} would come in as past clients; the rest above stay out until a person decides. Nothing was written. Tell Claude \"ran 501a\".")
else: say(f"RESULT: DONE · {j['imported']} past clients are in the Hub (Clients → Past), protected like every past client. Nothing was texted or emailed.")
done(0)
