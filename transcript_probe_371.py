#!/usr/bin/env python3
# 371 · READ ONLY: does GoHighLevel have transcripts of our recent calls? (Samantha 2026-09-30: "yes make the check")
# Part 1: the probe is the reviewed build. Part 2: puts up the TEMPORARY read-only probe (call-transcript-probe; owner
# key only, checked inside). Part 3: asks it once, prints day / in-out / seconds / transcript yes-no only, then DELETES
# the probe and confirms it's gone. Nothing is written anywhere; every GoHighLevel request is a read.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "call-transcript-probe"; lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-371/1.0"}, **(headers or {})))
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
    (say if s2 == 404 else bad)(("  ✓ " if s2 == 404 else "") + f"the temporary probe is removed" + ("" if s2 == 404 else f" (still there: {s2}). Tell Claude."))

say("371 · DOES GOHIGHLEVEL HAVE OUR CALL TRANSCRIPTS? (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for name, want in SHAS.items():
    if sha(src(name)) != want: bad(f"{name} is not the reviewed build. Nothing was run."); done(2)
if set(SHAS) != {FN, "_shared/job-auth"}: bad("the reviewed list is incomplete"); done(2)
say("  ✓ the probe is the reviewed build")
say(); say("PART 2 · PUT UP THE TEMPORARY PROBE")
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
    bad(f"the probe didn't answer as expected ({s}): " + str(j.get("error") or b)[:200])
else:
    say(f"  Last {j['days']} days: {j['calls']} call(s) found, {j['answered']} answered (had talk time).")
    say(f"  Checked the {j['checked']} most recent answered call(s): {j['with_transcript']} have a GoHighLevel transcript.")
    say("  GoHighLevel's answers to 'give me the transcript': " + ", ".join(f"{n} × {c}" for c, n in sorted(j["transcription_answers"].items())))
    say("  Call details GoHighLevel sends: " + (", ".join(j["call_fields_ghl_sends"]) or "none"))
    for r in j["rows"]: say(f"    {r['day']:>7} · {r['direction']:>3} · {r['seconds']:>4}s · transcript: {r['transcript']} ({r['answered_with']})")
    say()
    if j["checked"] == 0: say("  MEANING: no answered calls in the last two weeks to check. Make one real test call to 417-815-6423 and run 371 again.")
    elif j["with_transcript"] == j["checked"]: say("  MEANING: GoHighLevel transcribes your calls. The Hub can fetch calls and transcripts itself; no workflow needed.")
    elif j["with_transcript"] == 0 and set(j["transcription_answers"]) <= {"401", "403"}: say("  MEANING: GoHighLevel refused the question itself: the Hub's GoHighLevel key isn't allowed to read transcripts. We can't tell yet whether calls are transcribed; the key needs the conversations/message read permission. Tell Claude.")
    elif j["with_transcript"] == 0: say("  MEANING: GoHighLevel is NOT transcribing your calls. That's also why the workflow never fired. Turning on call transcription in GoHighLevel is the fix.")
    else: say("  MEANING: some calls are transcribed and some aren't (maybe only certain numbers, or only longer calls). Claude will look at which.")
remove_probe()
say(); say("RESULT: " + ("DONE · read only; the probe is gone. Tell Claude what the MEANING line says." if not fails else "CHECK THE ✗ LINES."))
done(0 if not fails else 8)
