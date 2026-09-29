#!/usr/bin/env python3
# Desktop 349 · CALLS AND CLOCK-IN REPLIES REACH THE HUB (P3 + C3). Samantha: "complete 9-13" (2026-09-29).
# P3 · the call reader (call-followup, built and guarded since Sept 28) gets finished calls again: a fresh link code,
#      and a GoHighLevel workflow that sends each call's transcript. Drafts wait for approval; nothing is sent.
# C3 · a caregiver's reply to the missed clock-in text reaches the Hub (new clockin-reply): it is attached to her open
#      missed clock-in, shown on the admins' link page and in their next reminder. Nothing is sent from it.
# Part 1 (read only): reviewed builds; the live watcher and link-page server are exactly GitHub's (c3_accept.json);
#   clockin-reply doesn't exist yet. Part 2: deploys the three (the new one without the sign-in check: GoHighLevel
#   calls it with its own link code), sets the two link codes (random, never shown). Part 3: refusals; then, step by
#   step, each GoHighLevel address goes onto your clipboard (never printed) for you to paste, with the steps; after
#   your test call / test run, it checks that they arrived (counts only). The clipboard is cleared at the end.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil, secrets as pysecrets
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
PBCOPY = os.environ.get("SB_PBCOPY", "pbcopy"); ASK = os.environ.get("SB_ASK", "1") == "1"
KEEP = os.environ.get("SB_KEEP_DIR", os.path.expanduser("~/Claude/c3-live-copy"))
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c):
    try: subprocess.run([PBCOPY], input=b"", check=False)
    except Exception: pass
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=150, raw=None):
    data = raw.encode() if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-349/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return None
    try: return json.loads(b)
    except Exception: return None
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def pause(msg):
    if ASK:
        try: input("  " + msg + " ")
        except EOFError: pass

say("349 · CALLS AND CLOCK-IN REPLIES REACH THE HUB"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
need = {"timekeeper-watch", "clockin-alert", "clockin-reply", "call-followup", "c3_accept.json"}
for name, want in SHAS.items():
    p = os.path.join(REPO, name) if name.endswith(".json") else (os.path.join(FNROOT, name + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts"))
    if not os.path.exists(p) or sha(p) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not need <= set(SHAS): bad("the build list is incomplete"); done(2)
say("  ✓ the reviewed builds")
s0, m0 = fmeta("clockin-reply")
if s0 == 200: bad("clockin-reply already exists (unexpected). Nothing was changed."); done(4)
sc, mc = fmeta("call-followup")
if sc != 200 or (mc or {}).get("verify_jwt") is not False: bad("the call reader isn't deployed the way it should be (no sign-in check, its own link code). Nothing was changed."); done(4)
ACC = json.load(open(os.path.join(REPO, "c3_accept.json")))
VJ = {}
for fn in ("timekeeper-watch", "clockin-alert"):
    s, m = fmeta(fn); VJ[fn] = (m or {}).get("verify_jwt")
    tmp = tempfile.mkdtemp(prefix="c3-live-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if d.returncode != 0 or not isinstance(VJ[fn], bool): bad(f"could not read or download the live {fn}. Nothing was changed."); done(4)
    want = ACC[fn]["files"]; diff = []; seen = set()
    for root, _, files in os.walk(tmp):
        for f in files:
            if not f.endswith(".ts"): continue
            lp = os.path.join(root, f); tail = "/".join(os.path.relpath(lp, tmp).replace(os.sep, "/").split("/")[-2:])
            hits = [r for r in want if r.endswith(tail)]
            if len(hits) != 1: diff.append(tail + " (not expected)"); continue
            seen.add(hits[0])
            if sha(lp) not in (want[hits[0]]["base"], want[hits[0]]["deploy"]): diff.append(hits[0])
    diff += [r + " (not found live)" for r in want if r not in seen]
    if diff:
        shutil.rmtree(KEEP, ignore_errors=True); shutil.copytree(tmp, KEEP)
        bad(f"the live {fn} is NOT GitHub's (" + ", ".join(sorted(set(diff))) + f"). Nothing was changed; the live copy is kept at {KEEP}."); done(5)
    shutil.rmtree(tmp, ignore_errors=True)
say("  ✓ the live watcher and link-page server are exactly GitHub's · the reply catcher doesn't exist yet · the call reader is in place")

say(); say("PART 2 · CHANGE")
for fn, vj in (("clockin-reply", False), ("timekeeper-watch", VJ["timekeeper-watch"]), ("clockin-alert", VJ["clockin-alert"])):
    d = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if d.returncode != 0: bad(f"{fn}: deploy failed: " + (d.stderr or d.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
    s, m = fmeta(fn)
    if (m or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting isn't as intended")
    say(f"  ✓ {fn} deployed" + (" (new; GoHighLevel calls it with its own link code)" if fn == "clockin-reply" else ", gateway setting kept"))
CALL_TOK, REPLY_TOK = pysecrets.token_urlsafe(36), pysecrets.token_urlsafe(36); HIDE += [CALL_TOK, REPLY_TOK]
s, _ = http("POST", f"{API}/v1/projects/{REF}/secrets", [{"name": "CALL_FOLLOWUP_TOKEN", "value": CALL_TOK}, {"name": "CLOCKIN_REPLY_TOKEN", "value": REPLY_TOK}], MG())
if s not in (200, 201): bad(f"could not save the two link codes (HTTP {s}). Tell Claude."); done(6)
say("  ✓ fresh link codes saved for the call reader and the reply catcher (not shown). Any older call-reader link stops working.")

say(); say("PART 3 · PROOF AND THE TWO GOHIGHLEVEL WORKFLOWS")
time.sleep(float(os.environ.get("SB_SETTLE", "12")))
CALL_URL = f"{FNB}/functions/v1/call-followup?token={CALL_TOK}"; REPLY_URL = f"{FNB}/functions/v1/clockin-reply?token={REPLY_TOK}"
r1 = http("POST", f"{FNB}/functions/v1/clockin-reply?token=" + "x" * 48, {"phone": "0", "message": "x"})[0]
r2 = http("POST", f"{FNB}/functions/v1/call-followup?token=" + "x" * 48, raw='{"transcript":"x"}')[0]
r3 = http("POST", REPLY_URL, {"id": "test", "phone": "0000000000", "name": "Test", "message": "349 check"})
good = r1 == 401 and r2 == 401 and r3[0] == 200
(say if good else bad)(("  ✓ " if good else "") + f"a wrong link code is refused (reply catcher {r1}, call reader {r2}); the right one is accepted ({r3[0]}, and a number not on the roster is ignored)")
t0 = dt.datetime.now(dt.timezone.utc).isoformat()
say()
say("  A · THE CALL READER (P3)")
pause("Press Enter to put the call reader's address on your clipboard.")
subprocess.run([PBCOPY], input=CALL_URL.encode(), check=False)
say("  ✓ the address is on your clipboard (not shown). In GoHighLevel:")
say("    1. Automation → Workflows → open the call workflow if it's there (it stopped sending on July 31), or Create Workflow.")
say("    2. Trigger: the call transcript being ready (in the trigger list it's the Transcript Generated / call transcript trigger).")
say("    3. Action: Webhook · Method POST · URL: paste (Cmd+V).")
say("    4. Custom data, in this order, using the merge-field picker for each value:")
say("         contactId = contact id · first_name · last_name · phone · email · direction = the call direction · transcript = the transcript (LAST)")
say("    5. Save and publish. Then make a short test call between two staff phones (say it's a test; no client details).")
pause("When the test call has ended (give it a minute for the transcript), press Enter.")
arrived = None
for _ in range(int(os.environ.get("SB_WAIT_TRIES", "12"))):
    arrived = sql(f"""select count(*)::int as n, max(x->>'stage') filter (where x->>'stage' <> 'received') as last_stage from app_data a,
                     jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
                     where a.key = 'call_followup_log' and x->>'stage' = 'received' and x->>'at' > '{t0}'""")
    if arrived and arrived[0]["n"]: break
    time.sleep(float(os.environ.get("SB_WAIT_SEC", "15")))
if arrived and arrived[0]["n"]: say(f"  ✓ the call reader received {arrived[0]['n']} call(s) since this step began. Its draft (if it was a family call) waits in Post-Call Follow-Up; nothing was sent.")
else: bad("no call reached the call reader yet. Check the workflow is published and the trigger is the transcript one; you can run 349's check again later (Claude has a read-only look).")
say()
say("  B · CLOCK-IN REPLIES (C3)")
pause("Press Enter to put the reply catcher's address on your clipboard.")
subprocess.run([PBCOPY], input=REPLY_URL.encode(), check=False)
say("  ✓ the address is on your clipboard (not shown). In GoHighLevel:")
say("    1. Automation → Workflows → Create Workflow (a copy of the coverage replies one is fine).")
say("    2. Trigger: Customer Replied · filter: contact has tag timekeeper-asked.")
say("    3. Action: Webhook · Method POST · URL: paste (Cmd+V).")
say("    4. Custom data, in this order: id = contact id · phone = contact phone · name = contact first name · message = the message body (LAST).")
say("    5. Save and publish, then use the workflow's Test with any contact.")
pause("When you've run the test, press Enter.")
got = None
for _ in range(int(os.environ.get("SB_WAIT_TRIES", "12"))):
    got = sql(f"""select count(*)::int as n from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
                  where a.key = 'clockin_reply_log' and x->>'at' > '{t0}'""")
    if got and got[0]["n"]: break
    time.sleep(float(os.environ.get("SB_WAIT_SEC", "15")))
if got and got[0]["n"]: say(f"  ✓ the reply catcher received {got[0]['n']} test post(s). Real replies attach to a caregiver's open missed clock-in.")
else: bad("no test reached the reply catcher yet. Check the workflow is published; Claude can look again later.")
say()
say("RESULT: " + ("DONE · finished calls reach the call reader again (drafts wait for approval), and caregivers' replies reach the missed clock-in alerts." if not fails else "CHECK THE ✗ LINES."))
say("Your clipboard was cleared. No link code, key, name or number was printed. Rollback: turn either workflow off in GoHighLevel.")
done(0 if not fails else 8)
