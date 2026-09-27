#!/usr/bin/env python3
# Change 6b · care level: deploy care-level (new) and the one shared rule into coverage-run, coverage-shifts
# and profile-check (all sha-checked), then REPORT (read only) how the rule reads every AxisCare client class
# and every active client's level. Writes nothing to AxisCare. Run AFTER the hub update is merged.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", ""); SUPA = os.environ.get("SB_SUPA_CLI", "")
SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-care-level/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}
say("CHANGE 6b · CARE LEVEL COMES FROM AXISCARE · INSTALL + READ-ONLY REPORT")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
s2, page, _ = http("GET", HUB + "/?v=" + dt.datetime.now().strftime("%H%M%S"))
if s2 != 200 or "ccLevelsLoad" not in page:
    say("  ✗ STOP: the live hub does not have the Change 6b update yet (merge the hub pull request, wait a few minutes). Nothing was run."); done(3)
say("  ✓ the live hub has the Change 6b screens")
if SKIP_FN: say("  (test target: function deploys skipped)")
else:
    for fn in [f for f in FN_SHAS if not f.endswith(".ts")]:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                           env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(4)
        say(f"  ✓ {fn} deployed")
s, _, h = http("OPTIONS", f"{FNB}/functions/v1/care-level", headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
cors = s == 200 and (h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")) == "*"
say("  " + ("✓ the hub can reach care-level (CORS answered)" if cors else f"✗ CORS preflight answered {s}"))
s, kb, _ = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: svc = ""
H = {"Authorization": "Bearer " + svc, "apikey": svc}
s, vb, _ = http("POST", f"{FNB}/functions/v1/care-level", {"action": "vocab"}, H)
s3, lb, _ = http("POST", f"{FNB}/functions/v1/care-level", {"action": "levels"}, H); svc = ""
try: vocab = json.loads(vb).get("classes") or []
except Exception: vocab = []
try: levels = json.loads(lb).get("levels") or {}
except Exception: levels = {}
say(); say("HOW THE ONE RULE READS YOUR AXISCARE CLIENT CLASSES (read only)")
if not vocab: say("  ✗ could not read AxisCare's class list: HTTP " + str(s) + " " + vb[:200])
NAME = {1: "Level 1 · Wellness", 2: "Level 2 · Personal Care", 3: "Level 3 · Advanced Care"}
for c in vocab:
    ra = c.get("reads_as"); lv = c.get("level")
    say(f"  {str(c.get('label') or c.get('code')):<34} → " + (NAME.get(lv, "") if ra == "level" else {"payer": "payer (never changed by the hub)", "mixed": "BOTH payer and level (hub never changes a client holding it)", "other": "other (kept as is)"}[ra]))
same = {}
for c in vocab:
    if c.get("reads_as") == "level": same.setdefault(c.get("level"), []).append(c.get("label"))
for lv, labs in same.items():
    if len(labs) > 1: say(f"  ⚠ {len(labs)} classes read as {NAME.get(lv)} ({', '.join(labs)}): \"Update AxisCare's care level\" to {NAME.get(lv)} will refuse and ask you to change it in AxisCare")
say(); say("ACTIVE CLIENTS BY CARE LEVEL (from AxisCare)")
if not levels: say("  ✗ could not read client levels: HTTP " + str(s3) + " " + lb[:200])
cnt = {}
for ax, v in levels.items(): cnt[v.get("level")] = cnt.get(v.get("level"), 0) + 1
for lv in (1, 2, 3): say(f"  {NAME[lv]}: {cnt.get(lv, 0)}")
say(f"  no level class in AxisCare: {cnt.get(None, 0)}")
mixed_labels = {c.get("label") for c in vocab if c.get("reads_as") == "mixed"}
mixedc = [ax for ax, v in levels.items() if any(l in mixed_labels for l in (v.get("classes") or []))]
if mixedc: say(f"  clients holding a payer+level class (update their level in AxisCare, not the hub): {len(mixedc)}")
say(); say("Nothing was written to AxisCare.")
allok = cors and bool(vocab) and bool(levels)
say(); say("RESULT: " + ("INSTALLED · care level reads from AxisCare everywhere; one rule; the review offers the update" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 5)
