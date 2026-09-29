#!/usr/bin/env python3
# S2 · ASK BEFORE TEXTING APPLICANTS (Desktop 328). The reference follow-up's day-5 message to the applicant is texted
# only if they said yes to texts on the apply form; everyone else gets the email. Its text gains "Reply STOP to opt out."
# Part 1 (read only): the function is the reviewed build; its gateway setting is read and kept.
# Part 2: redeploy reference-chase.
# Part 3 (read back): the gateway setting kept; a practice run (sends nothing) shows the new rule is live, counts only.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]

TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def api(path, method="GET", body=None):
    req = urllib.request.Request(API + f"/v1/projects/{REF}" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-s2/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return e.code, None
    except Exception: return None, None
def sql(q):
    st, out = api("/database/query", "POST", {"query": q}); return st in (200, 201), out
def status(name, token_param):
    req = urllib.request.Request(FNB + f"/functions/v1/{name}?token={token_param}", data=b"{}", method="POST", headers={"Content-Type": "application/json", "User-Agent": "cc-s2/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None

FN = "reference-chase"
say("S2 · ASK BEFORE TEXTING APPLICANTS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
got = hashlib.sha256(open(os.path.join(FNROOT, FN, "index.ts"), "rb").read()).hexdigest()
say(("  ✓ " if got == SHAS[FN] else "  ✗ ") + f"{FN} is the reviewed build")
if got != SHAS[FN]: say("  STOP. Nothing was run."); done(2)
st, meta = api(f"/functions/{FN}")
if not (st == 200 and isinstance(meta, dict) and "verify_jwt" in meta): say(f"  ✗ could not read {FN}'s setting ({st}). Nothing was changed."); done(4)
vj = bool(meta["verify_jwt"]); say(f"  ✓ {FN}: gateway setting read; kept on redeploy")
say(); say("PART 2 · CHANGE")
args = [SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"])
p = subprocess.run(args, cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
good = p.returncode == 0; say(("  ✓ " if good else "  ✗ ") + f"{FN} redeployed" + ("" if good else ": " + (p.stderr or p.stdout)[-300:]))
if not good: say("  STOP. The old version is still running. Tell Claude before Wednesday 10:30."); done(6)
say(); say("PART 3 · CHECK (read back; nothing is sent)")
st, meta = api(f"/functions/{FN}"); kept = st == 200 and isinstance(meta, dict) and bool(meta.get("verify_jwt")) == vj
say(("  ✓ " if kept else "  ✗ ") + "gateway setting kept")
def practice():
    req = urllib.request.Request(FNB + f"/functions/v1/{FN}?dry=1", data=b"{}", method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "cc-s2/1.0", **({"Authorization": "Bearer " + ANON} if ANON else {})})
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
ANON = os.environ.get("SB_ANON", "")
live = False
for i in range(6):   # a fresh deploy can take a moment to answer with the new version
    s1, j = practice()
    if s1 == 200 and isinstance(j, dict) and ("applicant_by_text" in j or j.get("note") == "nothing outstanding"): live = True; break
    import time; time.sleep(10)
if live and "applicant_by_text" in j:
    say(f"  ✓ the new rule is live · practice run: applicants who would be asked now: {j['applicant_by_text']} by text and email (said yes), {j['applicant_email_only']} by email only")
    say(f"  · also due now: {len(j.get('would_ask_for_the_first_time') or [])} first asks, {len(j.get('would_remind_reference') or [])} reminders (both email, to references), {len(j.get('would_escalate_to_office') or [])} for the office")
elif live: say("  ✓ answered · nothing outstanding today, so the practice run has nothing to show")
else: say(f"  ✗ the practice run did not show the new rule (answered {s1})")
allok = bool(kept and live)
say()
say("RESULT: " + ("DONE · from now on an applicant is texted only if they said yes to texts. Nobody else is." if allok else "CHECK THE ✗ LINES."))
say("No name, number or address was printed. Rollback if ever needed: redeploy reference-chase from the commit before this one.")
done(0 if allok else 7)
