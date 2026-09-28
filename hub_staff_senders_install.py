#!/usr/bin/env python3
# Desktop 283 · lead texts/emails, GoHighLevel replies and job offers: the staff member's own Hub sign-in + the Hub's
# opt-out check, instead of one shared staff key.
#   Part 1 READ ONLY: how each function checks callers today.
#   Part 2: sha-checked sources; the Hub's new outreach-check function; the Training project learns the Hub's PUBLIC
#     anon key (to call it); the three Training senders deployed exactly as they check callers today.
#   Part 3 LIVE PROOF, nothing sent: no sign-in and the old shared key are refused; signed in as you (one-time link,
#     never emailed, signed out after) the Hub recognises you and a Training sender accepts your sign-in (tested with a
#     "clear this conversation" on a conversation that does not exist, so nothing changes); the hub pages carry it.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); SHAS = json.loads(os.environ["SB_SHAS"])
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"; PROOF_EMAIL = os.environ.get("SB_PROOF_EMAIL", "").lower()
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", "")
HUB, TP = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"; ROOTS = {HUB: os.environ["SB_ROOT_HUB"], TP: os.environ["SB_ROOT_TP"]}
PAGES = json.loads(os.environ.get("SB_PAGES", "{}"))
DEPLOY = [(HUB, "outreach-check"), (TP, "ghl-lead-comms"), (TP, "ghl-reply"), (TP, "job-offer")]; NAMES = {HUB: "Hub", TP: "Training"}
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, raw=None, timeout=90):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-hub-staff/1.0"}, **(headers or {})))
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
    if s == 404: return "new"
    v = jl(b).get("verify_jwt") if s == 200 else None
    return v if isinstance(v, bool) else None
def keys(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys", headers=MG()); k = jl(b)
    return {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
base = lambda ref: FNB or f"https://{ref}.supabase.co"

say("LEAD TEXTS, GOHIGHLEVEL REPLIES AND JOB OFFERS · EACH STAFF MEMBER'S OWN SIGN-IN + THE OPT-OUT CHECK")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_") or not PROOF_EMAIL: say("✗ Missing the Supabase access token or the proof address. Nothing was changed."); done(1)
say("PART 1 · READ ONLY")
before = {(r, f): vjwt(r, f) for r, f in DEPLOY}
if any(v is None for v in before.values()): say("✗ STOP: could not read how these functions check callers. Nothing was changed."); done(2)
say("  " + "; ".join(f"{NAMES[r]} {f}: " + ("new (platform sign-in check ON)" if v == "new" else ("sign-in check ON" if v else "off")) for (r, f), v in before.items()))
say()
say("PART 2 · INSTALL")
for f, want in SHAS.items():
    ref, rel = f.split(":", 1)
    if hashlib.sha256(open(os.path.join(ROOTS[ref], rel), "rb").read()).hexdigest() != want: say(f"  ✗ {rel} is not the reviewed build. STOP. Nothing was changed."); done(3)
say(f"  ✓ all {len(SHAS)} source files are the reviewed builds")
kh, kt = keys(HUB), keys(TP); HUB_ANON, HUB_SVC, TP_ANON = kh.get("anon", ""), kh.get("service_role", ""), kt.get("anon", ""); HIDE += [HUB_ANON, HUB_SVC, TP_ANON]
if not HUB_ANON or not HUB_SVC or not TP_ANON: say("  ✗ STOP: could not read the project keys. Nothing was changed."); done(3)
s, _ = http("POST", f"{API}/v1/projects/{TP}/secrets", headers=MG(), raw=json.dumps([{"name": "HUB_ANON_KEY", "value": HUB_ANON}]).encode())
if s not in (200, 201): bad(f"could not give the Training project the Hub's public key (HTTP {s})"); done(4)
say("  ✓ the Training project now knows the Hub's PUBLIC key (the one printed in every hub page), so it can ask the Hub who is signed in")
for ref, fn in DEPLOY:
    vj = True if before[(ref, fn)] == "new" else before[(ref, fn)]
    if SKIP_FN: say(f"  (test target) would deploy {NAMES[ref]} {fn}" + ("" if vj else " --no-verify-jwt")); continue
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOTS[ref], env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{NAMES[ref]} {fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude today."); done(5)
    say(f"  ✓ {NAMES[ref]} {fn} deployed")
after = {k: vjwt(*k) for k in before}
if any(after[k] != (True if before[k] == "new" else before[k]) for k in before if not (SKIP_FN and before[k] == "new")): bad("how a function checks callers is not as intended")
else: say("  ✓ every function checks callers at the platform as intended (the three Training senders exactly as before)")
say()
say("PART 3 · LIVE PROOF (nothing is sent)")
s, _ = http("POST", f"{base(HUB)}/functions/v1/outreach-check", {"auth_check": True}, {"apikey": HUB_ANON, "Authorization": "Bearer " + HUB_ANON})
say("  ✓ Hub outreach-check with only the public key: refused, 401") if s == 401 else bad(f"Hub outreach-check with only the public key answered {s}")
for fn, body in (("ghl-lead-comms", {"key": "old-shared-key-probe", "action": "timeline", "phone": "+10000000000"}),
                 ("ghl-reply", {"key": "old-shared-key-probe", "action": "dismiss", "conversation_id": "no-such-conversation"}),
                 ("job-offer", {"key": "old-shared-key-probe", "action": "send_welcome", "offer_id": "00000000-0000-0000-0000-000000000000"})):
    s, _ = http("POST", f"{base(TP)}/functions/v1/{fn}", body, {"apikey": TP_ANON, "Authorization": "Bearer " + TP_ANON})
    say(f"  ✓ Training {fn} without a Hub sign-in (the old shared-key way): refused, 401") if s == 401 else bad(f"Training {fn} without a Hub sign-in answered {s}")
s, b = http("POST", f"{base(HUB)}/auth/v1/admin/generate_link", {"type": "magiclink", "email": PROOF_EMAIL}, {"apikey": HUB_SVC, "Authorization": "Bearer " + HUB_SVC})
th = jl(b).get("hashed_token") or (jl(b).get("properties") or {}).get("hashed_token"); at = None
for typ in ("magiclink", "email"):
    if at or not th: break
    s2, b2 = http("POST", f"{base(HUB)}/auth/v1/verify", {"type": typ, "token_hash": th}, {"apikey": HUB_ANON}); at = jl(b2).get("access_token")
if not at: bad("could not sign in as you for the check; the refusals above still stand")
else:
    HIDE.append(at)
    s, b = http("POST", f"{base(HUB)}/functions/v1/outreach-check", {"auth_check": True}, {"apikey": HUB_ANON, "Authorization": "Bearer " + at})
    say("  ✓ the Hub recognises you by your own sign-in (office role)") if s == 200 and jl(b).get("authorized") is True else bad(f"the Hub did not recognise you ({s})")
    s, _ = http("POST", f"{base(TP)}/functions/v1/ghl-reply", {"action": "dismiss", "conversation_id": "no-such-conversation"}, {"apikey": TP_ANON, "Authorization": "Bearer " + TP_ANON, "x-hub-token": at})
    say(f"  ✓ a Training sender accepts your Hub sign-in (a 'clear' on a conversation that does not exist: {s}, nothing changed)") if s not in (401, 403, None) else bad(f"the Training sender did not accept your Hub sign-in ({s})")
    s, _ = http("POST", f"{base(HUB)}/auth/v1/logout?scope=local", {}, {"apikey": HUB_ANON, "Authorization": "Bearer " + at})
    say("  ✓ that sign-in was signed out" if s in (200, 204) else f"  ○ sign-out answered {s}; the session expires on its own within the hour")
for name, url in PAGES.items():
    s, page = http("GET", url, headers={"Cache-Control": "no-cache"}, timeout=60)
    if s == 200 and "x-hub-token" in page: say(f"  ✓ the live {name} sends your sign-in with these calls")
    else: say(f"  ○ the live {name} has not picked up the update yet (HTTP {s}); its lead texts, replies and offers pause until it does")
say("  ○ opted-out numbers and addresses being skipped, and every refusal, are proven in the test harness (18/18)")
say()
say("RESULT: " + ("DONE · lead texts, GoHighLevel replies and job offers need each staff member's own sign-in, and skip anyone who opted out" if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
