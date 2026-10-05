#!/usr/bin/env python3
# 457 · READ ONLY: what does the Step 1 Application Packet ask? (Samantha 2026-10-05: "pull 'step 1 application' in from
# their GHL account and save it into their profiles", "extract a lot of info from that step 1 application pdf", "yes build it")
# Part 1: the read-only helper is the reviewed build. Part 2: puts up the TEMPORARY read-only helper (step1-look; owner key
# only, checked inside). Part 3: asks it once (up to 2 PDFs), prints the form's sections and question LABELS only, never an
# answer, then DELETES the helper and confirms it's gone. Nothing is written anywhere; every GoHighLevel request is a read.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "step1-look"; lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-457/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src(name): return os.path.join(FNROOT, name + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
def remove_probe():
    s, _ = http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    s2, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    (say if s2 == 404 else bad)(("  ✓ " if s2 == 404 else "") + f"the temporary helper is removed" + ("" if s2 == 404 else f" (still there: {s2}). Tell Claude."))

say("457 · WHAT THE STEP 1 APPLICATION PACKET ASKS (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for name, want in SHAS.items():
    if sha(src(name)) != want: bad(f"{name} is not the reviewed build. Nothing was run."); done(2)
if set(SHAS) != {FN, "_shared/job-auth"}: bad("the reviewed list is incomplete"); done(2)
say("  ✓ the read-only helper is the reviewed build")
say(); say("PART 2 · PUT UP THE TEMPORARY HELPER")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=REPO,
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("couldn't put it up: " + (p.stderr or p.stdout)[-200:]); done(4)
say("  ✓ up (it checks for the owner key itself)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
say(); say("PART 3 · THE ANSWER")
a = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a == 401 else bad)(("  ✓ " if a == 401 else "") + f"it refuses the public key ({a})")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b)
except Exception: j = {}
if s != 200 or not j.get("ok"):
    bad(f"the look didn't answer as expected ({s}): " + str(j.get("error") or b)[:200])
else:
    say(f"  Hub caregivers: {j['caregivers']} · looked up: {j['looked_up']} · with a Step 1 PDF: {j['with_file']} (it stops after 2 PDFs)")
    for i, f in enumerate(j["files"], 1):
        say(f"  PDF {i}: {f.get('result')}" + (f" · {f.get('pages')} pages · {f.get('kb')} KB · {f.get('sections')} sections" if f.get('result') == 'read' else ""))
    say(""); say("  WHAT THE FORM ASKS (labels only, never anyone's answers):")
    if not j["sections"]: say("    (nothing could be read)")
    for sec in j["sections"]:
        say(f"  ▸ {sec['title']}")
        for l in sec["labels"]: say(f"      · {l}")
remove_probe()
say(); say("RESULT: " + ("DONE · read only; the helper is gone. Tell Claude: I ran 457." if not fails else "CHECK THE ✗ LINES."))
done(0 if not fails else 8)
