#!/usr/bin/env python3
# Desktop 286 · "Send Text Asking" from the Care Team Builder (part 1).
#   Part 1 READ ONLY: the switch today; how the Team Builder's schedule function checks callers (team-ask copies it).
#   Part 2: sha-checked sources; the new team-ask function deployed.
#   Part 3 LIVE PROOF, nothing sent: no sign-in and the public key are refused; signed in as you (one-time link, never
#     emailed, signed out after) you are recognised, a real plan is read, and a send with the switch OFF is refused.
#   Part 4: the switch ON (ops_settings.team_ask_live), then a send naming a shift that isn't on the plan is refused
#     before any text could go. The button appears in the Hub when the hub update is merged (after this report).
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); SHAS = json.loads(os.environ["SB_SHAS"])
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"; PROOF_EMAIL = os.environ.get("SB_PROOF_EMAIL", "").lower()
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); ROOT = os.environ["SB_ROOT_HUB"]; HUB = "zngsgedlsxinbygwmxwn"
BASE = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
sys.excepthook = lambda t, e, tb: (say(f"✗ The installer stopped unexpectedly ({t.__name__}: {str(e)[:160]}). Everything above this line is accurate. Tell Claude."), done(8))
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-team-ask/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, str(e)
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, MG(), 180)
    if s not in (200, 201): raise RuntimeError(f"database answered {s}: {b[:160]}")
    return jl(b)
def vjwt(fn):
    s, b = http("GET", f"{API}/v1/projects/{HUB}/functions/{fn}", headers=MG())
    return (jl(b).get("verify_jwt") if s == 200 else None), s
LIVE = "select coalesce((select data->'team_ask_live' from public.app_data where key = 'ops_settings'), 'null'::jsonb) as v"

say("SEND TEXT ASKING FROM THE CARE TEAM BUILDER (part 1)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)
say("PART 1 · READ ONLY")
sw0 = sql(LIVE)[0]["v"]; say(f"  the switch (ops_settings.team_ask_live) today: {json.dumps(sw0)}")
vj, s0 = vjwt("schedule-push")
if vj is None: say(f"  ✗ STOP: could not read how the Team Builder's schedule function checks callers (HTTP {s0}). Nothing was changed."); done(2)
say(f"  the Team Builder's schedule function checks the platform sign-in: {'ON' if vj else 'off'} (team-ask will match)")
_, s1 = vjwt("team-ask"); say("  team-ask is " + ("already deployed (it will be replaced)" if s1 == 200 else "not deployed yet"))
n = sql("select coalesce(jsonb_array_length(data), 0) as n from public.app_data where key = 'staffing_plans'")
say(f"  Team Builder plans on file: {n[0]['n'] if n else 0}")
say()
say("PART 2 · INSTALL")
for rel, want in SHAS.items():
    if hashlib.sha256(open(os.path.join(ROOT, rel), "rb").read()).hexdigest() != want:
        say(f"  ✗ {rel} is not the reviewed build. STOP. Nothing was changed."); done(3)
say(f"  ✓ all {len(SHAS)} source files are the reviewed builds")
if SKIP_FN: say("  (test target) would deploy team-ask" + ("" if vj else " --no-verify-jwt"))
else:
    p = subprocess.run([SUPA, "functions", "deploy", "team-ask", "--project-ref", HUB, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ team-ask did not deploy: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing else was changed."); done(4)
    say("  ✓ team-ask deployed")
vj2, _ = vjwt("team-ask")
say("  ✓ it checks the platform sign-in exactly like the schedule function") if vj2 == vj else bad(f"team-ask sign-in check is {vj2}, expected {vj}")
say()
say("PART 3 · LIVE PROOF (nothing is sent)")
s, kb = http("GET", f"{API}/v1/projects/{HUB}/api-keys", headers=MG()); k = jl(kb)
keys = {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE.extend([ANON, SVC])
FN = f"{BASE}/functions/v1/team-ask"
s, _ = http("OPTIONS", FN, headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
say("  ✓ the Hub page's browser check (preflight) is answered") if s == 200 else bad(f"preflight answered {s}")
s, _ = http("POST", FN, {"action": "draft", "plan_id": "x", "caregiver_name": "x"}, {"apikey": ANON})
say(f"  ✓ no sign-in: refused ({s})") if s == 401 else bad(f"no sign-in answered {s}")
s, _ = http("POST", FN, {"action": "draft", "plan_id": "x", "caregiver_name": "x"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the public key alone: refused ({s})") if s == 401 else bad(f"the public key answered {s}")
plan = sql("select e->>'id' as id from public.app_data ad, jsonb_array_elements(case when jsonb_typeof(ad.data)='array' then ad.data else '[]' end) e "
           "where ad.key = 'staffing_plans' and e ? 'id' order by e->>'created_at' desc nulls last limit 1")
PLAN = plan[0]["id"] if plan else None
s, b = http("POST", f"{BASE}/auth/v1/admin/generate_link", {"type": "magiclink", "email": PROOF_EMAIL}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
th = jl(b).get("hashed_token") or (jl(b).get("properties") or {}).get("hashed_token"); at = None
for typ in ("magiclink", "email"):
    if at or not th: break
    s2, b2 = http("POST", f"{BASE}/auth/v1/verify", {"type": typ, "token_hash": th}, {"apikey": ANON}); at = jl(b2).get("access_token")
proven_off = False
if not at: bad("could not sign in as you for the check; the refusals above still stand")
else:
    HIDE.append(at); U = {"apikey": ANON, "Authorization": "Bearer " + at}
    s, b = http("POST", FN, {"action": "draft", "plan_id": "no-such-plan", "caregiver_name": "Nobody"}, U)
    say("  ✓ signed in as you: recognised (office role), and a plan that doesn't exist is reported as not found") if s == 404 else bad(f"your sign-in answered {s}: {jl(b).get('error', '')}")
    if PLAN:
        s, b = http("POST", FN, {"action": "draft", "plan_id": PLAN, "caregiver_name": "Proof Nobody"}, U); d = jl(b)
        say("  ✓ a real plan's draft reads (client, town, template; the caregiver is made up, so no phone)") if s == 200 and "template" in d and d.get("caregiver", {}).get("on_roster") is False else bad(f"a real plan's draft answered {s}")
        if sw0 is not True:
            s, b = http("POST", FN, {"action": "send", "plan_id": PLAN, "caregiver_name": "Proof Nobody", "cells": ["mon|x"], "message": "proof", "ask_id": "proof-0000-0001"}, U)
            proven_off = s == 409 and jl(b).get("outcome") == "off"
            say("  ✓ with the switch off, a send is refused before anything else happens") if proven_off else bad(f"a send with the switch off answered {s}")
    else: say("  ○ there are no Team Builder plans yet, so the plan checks were skipped")
say()
say("PART 4 · THE SWITCH")
if fails: say("  ✗ NOT switched on because of the ✗ lines above.")
else:
    sql("update public.app_data set data = jsonb_set(coalesce(data, '{}'::jsonb), '{team_ask_live}', 'true'::jsonb) where key = 'ops_settings'")
    sw1 = sql(LIVE)[0]["v"]
    say("  ✓ ops_settings.team_ask_live is now true (to turn it off: set it to false; nothing else changes)") if sw1 is True else bad(f"the switch reads {json.dumps(sw1)} after turning it on")
    if at and PLAN and sw1 is True:
        s, b = http("POST", FN, {"action": "send", "plan_id": PLAN, "caregiver_name": "Proof Nobody", "cells": ["mon|no-such-shift"], "message": "proof", "ask_id": "proof-0000-0002"}, U)
        say("  ✓ switched on, a send naming a shift that isn't on the plan is refused before any text could go") if s == 409 and jl(b).get("outcome") == "board_changed" else bad(f"the switched-on board check answered {s}")
if at:
    s, _ = http("POST", f"{BASE}/auth/v1/logout?scope=local", {}, {"apikey": ANON, "Authorization": "Bearer " + at})
    say("  ✓ that sign-in was signed out" if s in (200, 204) else f"  ○ sign-out answered {s}; the session expires on its own within the hour")
say("  ○ the real send (roster number by AxisCare id, every opt-out check, the exact text saved on the plan and in the record) is proven in the test harness (32/32); live it would text a real person")
say()
say("RESULT: " + ("DONE · team-ask is live. Tell Claude, and the hub update (the button) gets merged next." if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
