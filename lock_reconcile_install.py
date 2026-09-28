#!/usr/bin/env python3
# SECURITY · lock the "is any lead invisible?" function (lead-reconcile) to the owner's Desktop scripts.
# Part 1 (read only): the function source is the reviewed build; reads its current settings (never calls it).
# Part 2: deploy it.
# Part 3: prove the lock. Asks with no sign-in and with the Hub's public key: both must be refused. Asks with the
#   private server key (what Desktop 93 now uses): must be answered. Only the status codes are kept; every answer's
#   body is thrown away unread, so no contact name is printed or saved, even if something went wrong.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHA = os.environ["SB_FN_SHA"]; REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_DEPLOY = os.environ.get("SB_SKIP_DEPLOY") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def api_get(path):
    req = urllib.request.Request(API + f"/v1/projects/{REF}" + path, headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "cc-lock-reconcile/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
def status_only(method, headers=None, body=None):
    req = urllib.request.Request(FNB + "/functions/v1/lead-reconcile", data=body, method=method, headers=dict({"User-Agent": "cc-lock-reconcile/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=300) as r: r.read(); return r.status          # the body is discarded unread
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None

say("SECURITY · LOCK THE \"IS ANY LEAD INVISIBLE?\" FUNCTION")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
got = hashlib.sha256(open(os.path.join(FNROOT, "lead-reconcile", "index.ts"), "rb").read()).hexdigest()
say("  lead-reconcile function sha256 " + got + ("  ✓ the reviewed source" if got == FN_SHA else "  ✗ differs"))
if got != FN_SHA: say("  STOP. Nothing was run."); done(2)
st, meta = api_get("/functions/lead-reconcile")
say("  deployed now: " + (f"yes (version {meta.get('version')})" if st == 200 and isinstance(meta, dict) else f"could not read ({st})") + ". Not called.")
st, keys = api_get("/api-keys?reveal=true")
anon = next((k.get("api_key", "") for k in (keys or []) if k.get("name") == "anon"), "")
svc = next((k.get("api_key", "") for k in (keys or []) if k.get("name") == "service_role"), "")
say(("  ✓" if anon and svc else "  ✗") + " read the project's public and private keys (kept in memory only, never printed)")
if not (anon and svc): say("  STOP. Nothing was changed."); done(3)
say(); say("PART 2 · DEPLOY")
if SKIP_DEPLOY: say("  (test target: deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "lead-reconcile", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(5)
    say("  ✓ deployed the locked version")
say(); say("PART 3 · PROVE THE LOCK (status codes only; every answer is thrown away unread)")
s0 = status_only("OPTIONS")
s1 = status_only("POST", {"Content-Type": "application/json"}, b"{}")
s2 = status_only("POST", {"apikey": anon, "Authorization": "Bearer " + anon, "Content-Type": "application/json"}, b"{}")
s3 = status_only("POST", {"apikey": anon, "Authorization": "Bearer " + svc, "Content-Type": "application/json"}, b"{}")
c1, c2, c3 = s1 in (401, 403), s2 == 403, s3 == 200
say(("  ✓" if c1 else "  ✗") + f" no sign-in is refused ({s1})")
say(("  ✓" if c2 else "  ✗") + f" the Hub's public key is refused ({s2}); before today it was answered")
say(("  ✓" if c3 else "  ✗") + f" the private server key (your Desktop 93) is still answered ({s3})")
say(f"  (a browser preflight answered {s0})")
say()
ok = c1 and c2 and c3
say("RESULT: " + ("LOCKED · only your Desktop scripts can read which GoHighLevel contacts look invisible. Desktop 93 works as before." if ok
                 else "CHECK THE ✗ LINES."))
done(0 if ok else 6)
