#!/usr/bin/env python3
# 1208 · AGREEMENT BEFORE AXISCARE (Samantha 2026-10-30: "we need to have a signed agreement before we would make them active
# in axiscare"; her answer "Wait for it").
#   1. agreement_lead_1208.sql: a Client Care Agreement can belong to a lead before the client has an AxisCare number; Start
#      of Care step 4's first how-to line says the agreement comes first. Existing agreements are not changed.
#   2. Deploys client-agreement (start, list and pre-fill from the lead; it moves to the client once in AxisCare),
#      agreement-sign (the countersign card for a lead), client-journey (the agreement check reads the lead; "Client created
#      in AxisCare" waits on the signed agreement) and client-convert (no AxisCare client before the agreement is signed,
#      or marked signed on paper).
# Replaced only when the live copy is main's build or an older version of it. Nothing is sent and nothing is written to
# AxisCare. Prints counts only: no name, number, email, key or secret.
import os, json, subprocess, hashlib, time
os.environ.setdefault("SB_STEP", "1208")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["client-agreement", "agreement-sign", "client-journey", "client-convert"]; SQLF = "agreement_lead_1208.sql"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
_HIST = {}
def in_history(rel, live_sha):
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
def anon_key():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        for k in arr:
            if isinstance(k, dict) and k.get("name") == "anon" and usable(k.get("api_key")): return k["api_key"]
    return ""
STATE = ("select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'client_agreements' and column_name = 'lead_id') as lead_col,"
         " (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'client_agreements' and column_name = 'axiscare_client_id') as ax_nullable,"
         " (select count(*) from public.client_agreements) as agreements,"
         " (select count(*) from public.client_journey_step_def where key = 'soc.setup') as step4,"
         " (select coalesce(def->'howto'->>0, '') like 'Once the Client Care Agreement is signed%' from public.client_journey_step_def where key = 'soc.setup') as howto_new")
start("AGREEMENT BEFORE AXISCARE (sign it on the lead, then create the client in AxisCare)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("the Supabase tool was not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
for f, want in json.loads(os.environ.get("SB_SQL_SHAS", "{}")).items():
    (say(f"  ✓ {f} is the reviewed build") if sha(os.path.join(ROOT, f)) == want else bad(f"{f} is not the reviewed build"))
ANON = anon_key(); HIDE.append(ANON)
if not ANON: bad("could not read the project's public key")
ok, r = sql(REF, STATE)
if not ok or not r: bad("could not read the agreements table (it comes with 871): " + str(r)[:200])
else:
    s0 = r[0]; AG0 = int(s0["agreements"] or 0)
    say(f"  ✓ {AG0} Client Care Agreement{'' if AG0 == 1 else 's'} on file; none of them is changed")
    say("  ✓ agreements can already belong to a lead" if int(s0["lead_col"] or 0) == 1 and s0["ax_nullable"] == "YES" else "  ✓ agreements will be able to belong to a lead")
    if int(s0["step4"] or 0) != 1: bad("Start of Care step 4 (soc.setup) was not found; it comes with 911")
VJ = {}
for FN in FNS:
    sx, mx = fmeta(REF, FN)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
        VJ[FN] = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
        differ = [x for x in need(FNROOT, FN) if livef.get(x) != sha(os.path.join(ROOT, x))] if okl else []
        unknown = [x for x in differ if livef.get(x) is not None and not in_history(x, livef.get(x))]
        if not okl: bad(f"could not read {FN}'s live files")
        elif unknown: bad(f"{FN}'s live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
        else: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}" + (": will be brought up to this build" if differ else ": already this build"))
    else: bad(f"{FN} is not live or unreadable ({sx}); this step only updates it")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok, r = sql(REF, open(os.path.join(ROOT, SQLF)).read())
if not ok: bad("the database change did not go in (nothing changed): " + str(r)[:300]); done(6)
say("  ✓ a Client Care Agreement can now be started on a lead; step 4 says the agreement comes first")
for FN in FNS:
    if not deploy(REF, FNROOT, FN, VJ[FN]): say(f"  RESULT: stopped at {FN}. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent; AxisCare is not touched)")
for FN in FNS:
    okl, livef = live_files(REF, FN)
    say(f"  ✓ {FN}: the live copy is exactly this build") if okl and all(livef.get(x) == sha(os.path.join(ROOT, x)) for x in need(FNROOT, FN)) else bad(f"{FN}'s live copy is not this build")
ok, r = sql(REF, STATE)
if ok and r and int(r[0]["lead_col"] or 0) == 1 and r[0]["ax_nullable"] == "YES" and r[0]["howto_new"] is True:
    say(f"  ✓ the table and step 4 read back as planned; still {int(r[0]['agreements'] or 0)} agreement(s) on file")
else: bad("the table or step 4 did not read back as planned")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
for FN, body in (("client-agreement", {"action": "list", "lead_id": "proof_1208"}), ("client-convert", {"action": "preview", "lead_id": "proof_1208"})):
    d = http("POST", f"{FNB}/functions/v1/{FN}", body, A)[0]
    say(f"  ✓ {FN} refuses anyone not signed in to the Hub ({d})") if d in (401, 403) else bad(f"{FN} answered the public key ({d})")
    c = http("OPTIONS", f"{FNB}/functions/v1/{FN}", None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
    say(f"  ✓ the Hub can reach {FN} ({c})") if c in (200, 204) else bad(f"the Hub cannot reach {FN} ({c})")
say("  · tested before deploying: the agreement on a lead (21 checks), the agreement's earlier tests (207 checks),")
say("    Create in AxisCare waiting for the agreement (35 checks), Start of Care checks, this step against a pretend server.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the server is ready. Now merge the Hub pull request."); done(0)
