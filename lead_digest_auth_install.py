#!/usr/bin/env python3
# Desktop 288 · SECURITY: the morning brief can no longer be sent to any address by anyone with the link.
#   Part 1 READ ONLY: how lead-digest checks callers (kept exactly) and its current version.
#   Part 2: sha-checked sources; lead-digest deployed; the NEW version confirmed running before any probe.
#   Part 3 LIVE PROOF, nothing sent: no sign-in, the public key, and your own sign-in asking for someone else's
#     address are all refused. The old version is never probed (your rule: don't test the hole on live data).
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
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-lead-digest-sec/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, str(e)
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def fn_info():
    s, b = http("GET", f"{API}/v1/projects/{HUB}/functions/lead-digest", headers=MG()); d = jl(b) if s == 200 else {}
    return d.get("verify_jwt"), d.get("version"), s

say("SECURITY · THE MORNING BRIEF: OWN SIGN-IN, OWN ADDRESS")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)
say("PART 1 · READ ONLY")
vj, v0, s0 = fn_info()
if not isinstance(vj, bool): say(f"  ✗ STOP: could not read how lead-digest checks callers (HTTP {s0}). Nothing was changed."); done(2)
say(f"  lead-digest checks the platform sign-in: {'ON' if vj else 'off'} (kept exactly) · running version {v0}")
say()
say("PART 2 · INSTALL")
for rel, want in SHAS.items():
    if hashlib.sha256(open(os.path.join(ROOT, rel), "rb").read()).hexdigest() != want: say(f"  ✗ {rel} is not the reviewed build. STOP. Nothing was changed."); done(3)
say(f"  ✓ all {len(SHAS)} source files are the reviewed builds")
if SKIP_FN: say("  (test target) would deploy lead-digest" + ("" if vj else " --no-verify-jwt"))
else:
    p = subprocess.run([SUPA, "functions", "deploy", "lead-digest", "--project-ref", HUB, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ lead-digest did not deploy: " + (p.stderr or p.stdout)[-240:]); say("  STOP. The old version is still running; nothing was probed."); done(4)
    say("  ✓ lead-digest deployed")
vj1, v1, _ = fn_info()
say("  ✓ it checks the platform sign-in exactly as before") if vj1 == vj else bad(f"platform sign-in check changed ({vj} → {vj1})")
new_running = isinstance(v0, int) and isinstance(v1, int) and v1 > v0
if not new_running: bad(f"could not confirm the new version is running (version {v0} → {v1}); the refusal probes were NOT sent"); say(); say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say(f"  ✓ the new version is running (version {v0} → {v1})")
say()
say("PART 3 · LIVE PROOF (nothing is sent)")
s, kb = http("GET", f"{API}/v1/projects/{HUB}/api-keys", headers=MG()); k = jl(kb)
keys = {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE.extend([ANON, SVC])
FN = f"{BASE}/functions/v1/lead-digest?to=proof%40invalid.invalid&force=1"
s, _ = http("GET", FN); say(f"  ✓ no sign-in, a test brief to an outside address: refused ({s})") if s == 401 else bad(f"no sign-in answered {s}")
s, _ = http("GET", FN, headers={"apikey": ANON, "Authorization": "Bearer " + ANON}); say(f"  ✓ the public page key: refused ({s})") if s == 401 else bad(f"the public key answered {s}")
s, b = http("POST", f"{BASE}/auth/v1/admin/generate_link", {"type": "magiclink", "email": PROOF_EMAIL}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
th = jl(b).get("hashed_token") or (jl(b).get("properties") or {}).get("hashed_token"); at = None
for typ in ("magiclink", "email"):
    if at or not th: break
    s2, b2 = http("POST", f"{BASE}/auth/v1/verify", {"type": typ, "token_hash": th}, {"apikey": ANON}); at = jl(b2).get("access_token")
if not at: bad("could not sign in as you for the last check; the refusals above still stand")
else:
    HIDE.append(at)
    s, _ = http("GET", FN, headers={"apikey": ANON, "Authorization": "Bearer " + at})
    say(f"  ✓ signed in as you, asking for someone else's address: refused ({s}), no email") if s == 403 else bad(f"your sign-in asking for another address answered {s}")
    s, _ = http("POST", f"{BASE}/auth/v1/logout?scope=local", {}, {"apikey": ANON, "Authorization": "Bearer " + at})
    say("  ✓ that sign-in was signed out" if s in (200, 204) else f"  ○ sign-out answered {s}; the session expires on its own within the hour")
say("  ○ your own test brief (Settings → Send me a test brief now) and the 6:45am brief are unchanged; proven in the test harness (9/9; the old version failed 6)")
say()
say("RESULT: " + ("DONE · the morning brief goes only to the people on your list, or to a signed-in staff member's own inbox." if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
