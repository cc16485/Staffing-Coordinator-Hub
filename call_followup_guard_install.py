#!/usr/bin/env python3
# Desktop 292 · GATE 0 GUARD: call-followup stops writing what the AI heard onto leads.
#   Part 1 READ ONLY: how call-followup checks callers (kept exactly), its version, and its arrival log count.
#   Part 2: sha-checked source; call-followup deployed; the NEW version confirmed running.
#   Part 3 LIVE PROOF, nothing sent to the AI and nothing written: a wrong token is refused, and the arrival log did
#     not grow (so no call was processed). The real behaviour is proven in the test harness (14/14; the live version
#     failed the 8 safety checks).
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
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-cf-guard/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, str(e)
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def fn_info():
    s, b = http("GET", f"{API}/v1/projects/{HUB}/functions/call-followup", headers=MG()); d = jl(b) if s == 200 else {}
    return d.get("verify_jwt"), d.get("version"), s
def log_count():
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query",
                {"query": "select coalesce((select jsonb_array_length(data) from public.app_data where key = 'call_followup_log'), 0) as n"}, MG())
    if s not in (200, 201): raise RuntimeError(f"database answered {s}")
    return int(jl(b)[0]["n"])

say("GATE 0 GUARD · CALL-FOLLOWUP STOPS WRITING WHAT THE AI HEARD ONTO LEADS")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)
say("PART 1 · READ ONLY")
vj, v0, s0 = fn_info()
if not isinstance(vj, bool): say(f"  ✗ STOP: could not read how call-followup checks callers (HTTP {s0}). Nothing was changed."); done(2)
n0 = log_count()
say(f"  call-followup: platform sign-in check {'ON' if vj else 'off'} (kept exactly; GoHighLevel calls it with its own token) · version {v0} · arrival log entries {n0}")
say()
say("PART 2 · INSTALL")
if hashlib.sha256(open(os.path.join(ROOT, "supabase/functions/call-followup/index.ts"), "rb").read()).hexdigest() != WANT:
    say("  ✗ call-followup is not the reviewed build. STOP. Nothing was changed."); done(3)
say("  ✓ call-followup is the reviewed build")
if SKIP_FN: say("  (test target) would deploy call-followup" + ("" if vj else " --no-verify-jwt"))
else:
    p = subprocess.run([SUPA, "functions", "deploy", "call-followup", "--project-ref", HUB, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ call-followup did not deploy: " + (p.stderr or p.stdout)[-240:]); say("  STOP. The old version is still running."); done(4)
    say("  ✓ call-followup deployed")
vj1, v1, _ = fn_info()
say("  ✓ it checks callers exactly as before") if vj1 == vj else bad(f"platform sign-in check changed ({vj} → {vj1})")
if not (isinstance(v0, int) and isinstance(v1, int) and v1 > v0):
    bad(f"could not confirm the new version is running (version {v0} → {v1}); the probe was NOT sent"); say(); say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say(f"  ✓ the new version is running (version {v0} → {v1})")
say()
say("PART 3 · LIVE PROOF (nothing is sent to the AI, nothing is written)")
s, _ = http("POST", f"{BASE}/functions/v1/call-followup?token=wrong-token-proof", {"transcript": "proof", "phone": "+10000000000"})
say(f"  ✓ a caller with the wrong token: refused ({s})") if s == 401 else bad(f"a wrong token answered {s}")
n1 = log_count()
say(f"  ✓ the arrival log did not grow ({n0} → {n1}): no call was processed") if n1 == n0 else bad(f"the arrival log changed ({n0} → {n1})")
say("  ○ a real client call now leaves the office's lead fields untouched, keeps what the AI heard as one 'suggested, not reviewed'")
say("    entry, stores no transcript on the lead, labels its summary, and still drafts the email and text for approval:")
say("    proven in the test harness (14/14; the live version failed the 8 safety checks and passed the 6 'unchanged' checks)")
say()
say("RESULT: " + ("DONE · the dormant AI writer can no longer write unreviewed facts onto a lead." if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
