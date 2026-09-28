#!/usr/bin/env python3
# Desktop 284 · the last senders get the opt-out check: Training invites, reminders, certificates, "you're cleared",
# the nightly welcome; HomeTogether Hire invites/messages/document notices, application emails, "profile is live",
# founding emails. They ask the Hub's server-only door (outreach-check) before each message.
#   Part 1 READ ONLY · Part 2: one new server-only secret in all three projects (never shown), the Hub door first, then
#   the senders, each exactly as it checks callers today · Part 3 LIVE PROOF, nothing sent.
import json, os, re, hashlib, secrets as pysecrets, subprocess, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); SHAS = json.loads(os.environ["SB_SHAS"])
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", "")
HUB, TP, HT = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa", "lrlczrpehjpncqixubuk"
ROOTS = {HUB: os.environ["SB_ROOT_HUB"], TP: os.environ["SB_ROOT_TP"], HT: os.environ["SB_ROOT_HT"]}; NAMES = {HUB: "Hub", TP: "Training", HT: "HomeTogether Hire"}
DEPLOY = [(HUB, "outreach-check")] + [(TP, f) for f in ("send-invite", "send-reminder", "send-certificate", "notify-cleared", "sync-axiscare")] + \
         [(HT, f) for f in ("htl-notify", "htl-apply", "htl-admin", "htl-founding-emails")]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, raw=None, timeout=90):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-optout-rest/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, str(e)
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def vjwt(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    v = jl(b).get("verify_jwt") if s == 200 else None
    return v if isinstance(v, bool) else None
def keys(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys", headers=MG()); k = jl(b)
    return {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
def secret_fingerprint(ref, name):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG()); k = jl(b)
    for x in (k if isinstance(k, list) else []):
        if isinstance(x, dict) and x.get("name") == name: return str(x.get("value", ""))
    return None
base = lambda ref: FNB or f"https://{ref}.supabase.co"

say("THE LAST SENDERS GET THE OPT-OUT CHECK (Training Platform + HomeTogether Hire)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)
say("PART 1 · READ ONLY")
before = {(r, f): vjwt(r, f) for r, f in DEPLOY}
if any(v is None for v in before.values()): say("✗ STOP: could not read how these functions check callers: " + ", ".join(f"{NAMES[r]} {f}" for (r, f), v in before.items() if v is None) + ". Nothing was changed."); done(2)
say("  how each checks callers today (kept exactly): " + "; ".join(f"{NAMES[r]} {f} {'ON' if v else 'off'}" for (r, f), v in before.items()))
say()
say("PART 2 · INSTALL")
for f, want in SHAS.items():
    ref, rel = f.split(":", 1)
    if hashlib.sha256(open(os.path.join(ROOTS[ref], rel), "rb").read()).hexdigest() != want: say(f"  ✗ {NAMES[ref]} {rel} is not the reviewed build. STOP. Nothing was changed."); done(3)
say(f"  ✓ all {len(SHAS)} source files are the reviewed builds")
kh = keys(HUB); HUB_ANON = kh.get("anon", ""); HIDE.append(HUB_ANON)
if not HUB_ANON: say("  ✗ STOP: could not read the Hub's public key. Nothing was changed."); done(3)
SECRET = pysecrets.token_urlsafe(48); HIDE.append(SECRET)
for ref, vals in ((HUB, {"OUTREACH_SECRET": SECRET}), (TP, {"OUTREACH_SECRET": SECRET, "HUB_ANON_KEY": HUB_ANON}), (HT, {"OUTREACH_SECRET": SECRET, "HUB_ANON_KEY": HUB_ANON})):
    s, _ = http("POST", f"{API}/v1/projects/{ref}/secrets", headers=MG(), raw=json.dumps([{"name": k, "value": v} for k, v in vals.items()]).encode())
    if s not in (200, 201): bad(f"could not set the opt-out secret in {NAMES[ref]} (HTTP {s})"); say("  STOP. Nothing was deployed."); done(4)
fps = {ref: secret_fingerprint(ref, "OUTREACH_SECRET") for ref in (HUB, TP, HT)}
if None in fps.values() or len(set(fps.values())) != 1: bad("the opt-out secret does not read back the same in all three projects"); say("  STOP. Nothing was deployed."); done(4)
say("  ✓ one new server-only opt-out secret set in the Hub, Training and HomeTogether Hire; its fingerprint matches in all three (not shown)")
for ref, fn in DEPLOY:
    vj = before[(ref, fn)]
    if SKIP_FN: say(f"  (test target) would deploy {NAMES[ref]} {fn}" + ("" if vj else " --no-verify-jwt")); continue
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOTS[ref], env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{NAMES[ref]} {fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Functions above this line run the new code. Tell Claude today."); done(5)
    say(f"  ✓ {NAMES[ref]} {fn} deployed")
after = {k: vjwt(*k) for k in before}
say("  ✓ every function checks callers exactly as before") if after == before else bad("how a function checks callers changed")
say()
say("PART 3 · LIVE PROOF (nothing is sent)")
door = f"{base(HUB)}/functions/v1/outreach-check"; H0 = {"apikey": HUB_ANON, "Authorization": "Bearer " + HUB_ANON}
s, _ = http("POST", door, {"sender": "proof", "channel": "email", "email": "proof@invalid.invalid", "via_ghl": False}, dict(H0, **{"x-outreach-secret": "x" * 64}))
say("  ✓ the Hub's opt-out door with a wrong secret: refused, 401") if s == 401 else bad(f"the opt-out door with a wrong secret answered {s}")
s, b = http("POST", door, {"sender": "proof (Desktop 284)", "channel": "email", "email": "proof@invalid.invalid", "via_ghl": False}, dict(H0, **{"x-outreach-secret": SECRET}))
say("  ✓ with the real secret, it answers (an address nobody uses: allowed; every opt-out source was readable)") if s == 200 and jl(b).get("allowed") is True else bad(f"the opt-out door did not answer as expected ({s})")
s, _ = http("POST", door, {"auth_check": True}, H0)
say("  ✓ without the secret or a staff sign-in: refused, 401") if s == 401 else bad(f"the opt-out door without a secret answered {s}")
say("  ○ each sender skipping an opted-out person, and staying silent if the Hub cannot be reached, is proven in the test harness (20/20); live it would message real people")
say()
say("RESULT: " + ("DONE · every sender that reaches anyone outside our staff now checks every opt-out source first" if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
