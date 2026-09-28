#!/usr/bin/env python3
# Desktop 285 · Step 0 · 0c · GoHighLevel workflows · READ ONLY (it deploys one read-only function, nothing else).
# Lists every GoHighLevel workflow (name, live/draft, last change), which of our tags exist there, whether the Hub and
# the Training Platform use the same GoHighLevel account (fingerprints compared, never values), and what our code does
# that can start a workflow. No contact, message or person is read; nothing is changed.
import json, os, re, sys, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); WANT = os.environ["SB_EXPECTED_SHA"]
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"; ROOT = os.environ["SB_ROOT_HUB"]
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); HUB, TP = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"; FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
lines = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
sys.excepthook = lambda t, e, tb: (say(f"✗ The check stopped unexpectedly ({t.__name__}: {str(e)[:120]}). Everything above is accurate; nothing was changed except what is listed."), done(8))
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-ghl-inventory/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, str(e)
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def fingerprint(ref, name):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG()); k = jl(b)
    for x in (k if isinstance(k, list) else []):
        if isinstance(x, dict) and x.get("name") == name: return str(x.get("value", ""))
    return None

say("STEP 0 · 0c · GOHIGHLEVEL WORKFLOWS · READ ONLY (deploys one read-only function)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was run."); done(1)
if hashlib.sha256(open(os.path.join(ROOT, "supabase/functions/ghl-inventory/index.ts"), "rb").read()).hexdigest() != WANT:
    say("✗ ghl-inventory is not the reviewed build. Nothing was changed."); done(2)
if SKIP_FN: say("  (test target) would deploy ghl-inventory")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "ghl-inventory", "--project-ref", HUB, "--use-api"], cwd=ROOT,
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("✗ the read-only function did not deploy: " + (p.stderr or p.stdout)[-200:]); done(3)
    say("  ✓ the read-only ghl-inventory function is in place (server key only)")
s, kb = http("GET", f"{API}/v1/projects/{HUB}/api-keys", headers=MG()); k = jl(kb)
SVC = next((x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict) and x.get("name") == "service_role"), ""); HIDE.append(SVC)
s, b = http("POST", f"{FNB}/functions/v1/ghl-inventory", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC})
d = jl(b)
if s != 200: say(f"✗ GoHighLevel inventory did not answer (HTTP {s}: {str(d.get('error', ''))[:120]})."); done(4)
say()
say("1. GOHIGHLEVEL WORKFLOWS (the Caring Companions account the Hub uses)")
wf = d.get("workflows")
if isinstance(wf, dict): say(f"  ✗ could not list them: {wf.get('error')}")
else:
    live = [w for w in wf if str(w.get("status")).lower() == "published"]; other = [w for w in wf if w not in live]
    say(f"  {len(wf)} workflow(s): {len(live)} live, {len(other)} draft or off")
    for w in sorted(live, key=lambda x: x.get("name", "").lower()): say(f"    ● LIVE   {w.get('name')}  (changed {w.get('updated') or '?'})")
    for w in sorted(other, key=lambda x: x.get("name", "").lower()): say(f"    ○ {str(w.get('status') or 'unknown').upper():<6} {w.get('name')}  (changed {w.get('updated') or '?'})")
say()
say("2. OUR TAGS IN GOHIGHLEVEL (a workflow can start when one of these is added)")
tg = d.get("tags")
if isinstance(tg, dict): say(f"  ✗ could not list them: {tg.get('error')}")
else:
    say(f"  GoHighLevel holds {d.get('tag_count')} tag(s) in all")
    for t in tg: say(f"    {'✓ exists ' if t.get('exists') else '· not there'}  {t.get('tag')}")
say()
say("3. SAME GOHIGHLEVEL ACCOUNT? (fingerprints of the account setting, never the value)")
fh, ft = fingerprint(HUB, "GHL_LOCATION_ID"), fingerprint(TP, "GHL_LOCATION_ID")
say("  Hub and Training Platform: " + ("the SAME account" if fh and fh == ft else "different accounts" if fh and ft else "could not compare"))
say()
say("4. WHAT OUR CODE DOES THAT CAN START A GOHIGHLEVEL WORKFLOW (from the code)")
for line in (
    "Inbound webhooks: new website inquiry (lead-intake → GHL_HOOK_CCLEADS); orientation booked (orientation-booked → GHL_HOOK_ORIENTATION);",
    "  HomeTogether founding family (htl-founding-emails → GHL_HOOK_FOUNDING); HomeTogether caregiver signup (htl-lead-alert → GHL_HOOK_CAREGIVER);",
    "  HomeTogether TV order (GHL_HOOK_TV).",
    "Tags: lead (after a call); coverage-asked, confirm-asked, timekeeper-asked (caregiver asks, removed when closed);",
    "  campaign audience tags; active/inactive client and active/inactive employee (Training nightly sync, every client and caregiver).",
    "New contacts: every send creates or finds a GoHighLevel contact, which can start a \"contact created\" workflow."):
    say("  " + line)
say()
say("NEXT: for each LIVE workflow, the question is whether it texts or emails a person. Those honor GoHighLevel's Do Not Disturb but")
say("not the Hub's opt-out record. Claude proposes the fix after you review this list.")
done(0)
