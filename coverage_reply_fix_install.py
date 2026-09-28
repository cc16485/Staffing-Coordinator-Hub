#!/usr/bin/env python3
# Desktop 287 · caregiver replies to coordinator-picked callout asks reach their callout again.
#   Part 1 READ ONLY: how coverage-reply checks callers (kept exactly); how many texted asks each kind has and how many
#     picked asks are still "waiting" (their replies were never recorded; check GoHighLevel Conversations for them).
#   Part 2: sha-checked source; coverage-reply deployed exactly as it checks callers today.
#   Part 3 LIVE PROOF, nothing sent: a wrong token is still refused.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); WANT = os.environ["SB_EXPECTED_SHA"]
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"; ROOT = os.environ["SB_ROOT_HUB"]
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); HUB = "zngsgedlsxinbygwmxwn"; BASE = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
sys.excepthook = lambda t, e, tb: (say(f"✗ The installer stopped unexpectedly ({t.__name__}: {str(e)[:160]}). Everything above this line is accurate. Tell Claude."), done(8))
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-coverage-reply/1.0"}, **(headers or {})))
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
COUNTS = """select
  count(*) filter (where a->>'auto' = 'true') as auto_asks,
  count(*) filter (where a->>'picked_by_coordinator' = 'true') as picked_asks,
  count(*) filter (where a->>'picked_by_coordinator' = 'true' and a->>'state' = 'waiting') as picked_waiting,
  count(*) filter (where a->>'picked_by_coordinator' = 'true' and a->>'state' = 'waiting' and c->>'status' = 'open') as picked_waiting_open,
  count(*) filter (where a->>'auto' = 'true' and a->>'replied_at' is not null) as auto_replied,
  count(*) filter (where a->>'picked_by_coordinator' = 'true' and a->>'replied_at' is not null) as picked_replied
from public.app_data ad,
     lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]' end) c,
     lateral jsonb_array_elements(case when jsonb_typeof(c->'asked') = 'array' then c->'asked' else '[]' end) a
where ad.key = 'coverage_cases'"""

say("CALLOUT REPLIES TO COORDINATOR-PICKED ASKS")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)
say("PART 1 · READ ONLY")
s, b = http("GET", f"{API}/v1/projects/{HUB}/functions/coverage-reply", headers=MG()); vj = jl(b).get("verify_jwt") if s == 200 else None
if not isinstance(vj, bool): say(f"  ✗ STOP: could not read how coverage-reply checks callers (HTTP {s}). Nothing was changed."); done(2)
say(f"  coverage-reply checks the platform sign-in: {'ON' if vj else 'off'} (kept exactly; GoHighLevel calls it with its own token)")
c = sql(COUNTS)[0]
say(f"  texted asks on file: {c['auto_asks']} by Cara's automatic waves ({c['auto_replied']} with a reply recorded), "
    f"{c['picked_asks']} picked by a coordinator ({c['picked_replied']} with a reply recorded)")
say(f"  picked asks still 'waiting' (any reply to them was never recorded): {c['picked_waiting']}, of which {c['picked_waiting_open']} are on callouts still open")
say()
say("PART 2 · INSTALL")
if hashlib.sha256(open(os.path.join(ROOT, "supabase/functions/coverage-reply/index.ts"), "rb").read()).hexdigest() != WANT:
    say("  ✗ coverage-reply is not the reviewed build. STOP. Nothing was changed."); done(3)
say("  ✓ coverage-reply is the reviewed build")
if SKIP_FN: say("  (test target) would deploy coverage-reply" + ("" if vj else " --no-verify-jwt"))
else:
    p = subprocess.run([SUPA, "functions", "deploy", "coverage-reply", "--project-ref", HUB, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ coverage-reply did not deploy: " + (p.stderr or p.stdout)[-240:]); say("  STOP. The old version is still running."); done(4)
    say("  ✓ coverage-reply deployed")
s, b = http("GET", f"{API}/v1/projects/{HUB}/functions/coverage-reply", headers=MG())
say("  ✓ it checks callers exactly as before") if jl(b).get("verify_jwt") == vj else bad("how coverage-reply checks callers changed")
say()
say("PART 3 · LIVE PROOF (nothing is sent)")
s, _ = http("POST", f"{BASE}/functions/v1/coverage-reply?token=wrong-token-proof", {"id": "none", "phone": "+10000000000", "message": "proof"})
say(f"  ✓ a wrong token is still refused ({s})") if s == 401 else bad(f"a wrong token answered {s}")
say("  ○ a reply to a picked ask landing on its callout (and automatic asks, hand-logged calls, two open callouts and closed callouts behaving as before) is proven in the test harness (6/6; the live version failed 3 of them); live it would need a real caregiver reply")
say()
say("RESULT: " + ("DONE · replies to coordinator-picked asks reach their callout from now on." if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
