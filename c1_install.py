#!/usr/bin/env python3
# C1 · MISSED CLOCK-INS (Desktop 346). Samantha approved 2026-09-29 ("all as suggested", "go build C1").
# Part 1 (read only): the reviewed builds; the live timekeeper-watch is exactly GitHub (c1_accept.json; stops and
#   keeps a copy otherwise); clockin-alert doesn't exist yet; the link secret (S3) is there; the current settings.
# Part 2: deploys timekeeper-watch (gateway setting kept) and the new clockin-alert (sign-in check on: the page sends
#   the public key, and the link itself is the real check). Then the settings: 5 minutes, the stored caregiver wording
#   (if any) removed so the new short one applies, the admin texts in PRACTICE (timekeeper_admin_loop_live false).
#   The previous values are kept in ops_settings.c1_previous for rollback.
# Part 3 (proof, nothing is sent): the link page refuses no link, a forged link and a plain GET; the watcher still
#   refuses outsiders and accepts its schedule; a practice call (?dry=1, writes and sends nothing) reports the new
#   settings, the admin count and who has no phone. Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
KEEP = os.environ.get("SB_KEEP_DIR", os.path.expanduser("~/Claude/c1-live-copy"))
VAULT_NAME = "hub_job_secret"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-c1/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:200]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: j = json.loads(b) if s == 200 else None
    except Exception: j = None
    return s, j
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()

say("C1 · MISSED CLOCK-INS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
need = {"timekeeper-watch", "clockin-alert", "_shared/clockin-links", "_shared/clockin-admins", "_shared/job-auth", "_shared/outreach", "c1_accept.json"}
badb = False
for name, want in SHAS.items():
    p = os.path.join(REPO, name) if name.endswith(".json") else (os.path.join(FNROOT, name + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts"))
    if not os.path.exists(p) or sha(p) != want: bad(f"{name} is not the reviewed build"); badb = True
if badb or not need <= set(SHAS): say("  STOP. Nothing was run."); done(2)
say("  ✓ the watcher, the link page's server side, the two shared helpers and the comparison list are the reviewed builds")
s1, m1 = fmeta("timekeeper-watch"); s2, m2 = fmeta("clockin-alert")
if s1 != 200 or not isinstance((m1 or {}).get("verify_jwt"), bool): bad("could not read the watcher's settings. Nothing was changed."); done(4)
if s2 == 200: bad("a function called clockin-alert already exists (unexpected). Nothing was changed."); done(4)
VJ = m1["verify_jwt"]
ok, vx = sql(f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if not ok or not vx or vx[0]["n"] != 1 or "HUB_JOB_SECRET" not in names: bad("the jobs' secret (S3), which also seals the links, isn't there. Nothing was changed."); done(4)
# the live watcher is GitHub's
ACC = json.load(open(os.path.join(REPO, "c1_accept.json")))["timekeeper-watch"]["files"]
tmp = tempfile.mkdtemp(prefix="c1-live-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
d = subprocess.run([SUPA, "functions", "download", "timekeeper-watch", "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if d.returncode != 0: bad("could not download the live watcher to compare. Nothing was changed."); done(4)
diff, seen = [], set()
for root, _, files in os.walk(tmp):
    for f in files:
        if not f.endswith(".ts"): continue
        lp = os.path.join(root, f); tail = "/".join(os.path.relpath(lp, tmp).replace(os.sep, "/").split("/")[-2:])
        hits = [r for r in ACC if r.endswith(tail)]
        if len(hits) != 1: diff.append(tail + " (not expected)"); continue
        seen.add(hits[0]); h = sha(lp)
        if h not in (ACC[hits[0]]["base"], ACC[hits[0]]["deploy"]): diff.append(hits[0])
for r in ACC:
    if r not in seen: diff.append(r + " (not found live)")
if diff:
    shutil.rmtree(KEEP, ignore_errors=True); shutil.copytree(tmp, KEEP)
    bad("the live watcher is NOT the version on GitHub (" + ", ".join(sorted(set(diff))) + f"). Nothing was changed; the live copy is kept at {KEEP} for Claude.")
    shutil.rmtree(tmp, ignore_errors=True); done(5)
shutil.rmtree(tmp, ignore_errors=True)
say(f"  ✓ the live watcher is exactly GitHub's · its gateway sign-in check is {'on' if VJ else 'off'} (kept) · the link page doesn't exist yet · the link secret is there")
ok, st = sql("""select (data->>'timekeeper_grace_min') as grace, (data ? 'timekeeper_msg') as has_msg, coalesce((data->>'timekeeper_admin_loop_live')::boolean, false) as loop_live,
                coalesce((data->>'timekeeper_watch_live')::boolean, false) as watch, coalesce((data->>'timekeeper_text_live')::boolean, false) as text_on,
                jsonb_array_length(case when jsonb_typeof(data->'coverage_alert_admins') = 'array' then data->'coverage_alert_admins' else '[]'::jsonb end) as n_admins
                from app_data where key = 'ops_settings'""")
if not ok or not st: bad("could not read the settings. Nothing was changed."); done(4)
S0 = st[0]
say(f"  · now: caregiver text at {S0['grace'] or 'the standard 3'} minutes · a stored caregiver wording: {'yes' if S0['has_msg'] else 'no'} · the watcher {'on' if S0['watch'] else 'OFF'}, caregiver texts {'on' if S0['text_on'] else 'OFF'}"
    + f" · admins on the call-in list: {S0['n_admins'] or 'none set (Samantha and Krystal by default)'}")

say(); say("PART 2 · CHANGE")
for fn, vj in (("clockin-alert", True), ("timekeeper-watch", VJ)):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn}: deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting isn't as intended ({(mN or {}).get('verify_jwt')})")
    say(f"  ✓ {fn} deployed" + (" (new; sign-in check on)" if fn == "clockin-alert" else f", now version {(mN or {}).get('version')} (was {m1.get('version')}), gateway setting kept"))
ok, _ = sql("""update app_data set data = (data - 'timekeeper_msg') || jsonb_build_object(
                 'c1_previous', jsonb_build_object('at', now(), 'timekeeper_grace_min', data->'timekeeper_grace_min', 'timekeeper_msg', data->'timekeeper_msg',
                                                   'timekeeper_office_after_min', data->'timekeeper_office_after_min', 'timekeeper_alert_phones', data->'timekeeper_alert_phones'),
                 'timekeeper_grace_min', 5, 'timekeeper_admin_loop_live', false)
               where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'c1_previous')""")
ok2, st2 = sql("""select (data->>'timekeeper_grace_min')::int as grace, (data ? 'timekeeper_msg') as has_msg, (data->>'timekeeper_admin_loop_live')::boolean as loop_live,
                  (data ? 'c1_previous') as kept from app_data where key = 'ops_settings'""")
S1 = st2[0] if ok2 and st2 else {}
if ok and S1.get("grace") == 5 and S1.get("has_msg") is False and S1.get("loop_live") is False and S1.get("kept"):
    say("  ✓ settings: the caregiver text at 5 minutes, in the new short wording · the admin texts in PRACTICE (recorded, not sent) · the old values kept for rollback")
else: bad("the settings are not as intended: " + json.dumps(S1)[:200])

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
ok, kk = True, None
s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
CA = f"{FNB}/functions/v1/clockin-alert"; H = {"apikey": ANON, "Authorization": "Bearer " + ANON}
r0 = http("POST", CA, {"action": "view"}, H)[0]
r1 = http("POST", CA, {"c": "tk_1", "a": "0" * 16, "e": int(time.time()) + 3600, "t": "A" * 43, "action": "resolve", "reason": "other"}, H)[0]
r2 = http("GET", CA + "?c=tk_1", None, H)[0]
r3 = http("POST", CA, {"action": "view"}, {})[0]
good = r0 == 401 and r1 == 401 and r2 in (401, 405) and r3 == 401
(say if good else bad)(("  ✓ " if good else "") + f"the link page: no link {r0}, a forged link {r1}, a plain GET {r2}, no key {r3} → refused")
TK = f"{FNB}/functions/v1/timekeeper-watch"
a1 = http("POST", TK + "?auth_check=1", {}, H)[0]; a2 = http("POST", TK + "?auth_check=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
(say if a1 == 401 and a2[0] == 200 else bad)(("  ✓ " if a1 == 401 and a2[0] == 200 else "") + f"the watcher: public key {a1} → refused · your server key {a2[0]} → accepted")
ok, rq = sql("select net.http_post(url := " + lit(TK + "?auth_check=1") + ", headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', "
             + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), body := '{}'::jsonb) as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
(say if got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron" else bad)(("  ✓ " if got and got["status_code"] == 200 else "") + "the watcher's schedule still gets in" + ("" if got and got["status_code"] == 200 else f" ({got['status_code'] if got else 'no answer'})"))
sD, bD = http("POST", TK + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
se = j.get("settings_in_effect", {}); al = j.get("admin_loop", {})
good = sD == 200 and se.get("grace_min") == 5 and se.get("admin_repeat_min") == 5 and (se.get("switches") or {}).get("timekeeper_admin_loop_live") is False and al.get("links") is True
(say if good else bad)(("  ✓ " if good else "") + f"a practice call (writes and sends nothing): caregiver text at {se.get('grace_min')} min · admin text every {se.get('admin_repeat_min')} min · admin texts {'LIVE' if (se.get('switches') or {}).get('timekeeper_admin_loop_live') else 'practice'} · links {'ready' if al.get('links') else 'NOT ready'}")
if isinstance(al.get("admins"), int):
    say(f"  · admins who would be texted: {al['admins']}" + (f" · {al['admins_without_phone']} of them have no phone in the staff list, so they won't get texts (fix it in My Team or Settings)" if al.get("admins_without_phone") else " · all have a phone on file"))
say()
say("RESULT: " + ("DONE · caregivers now get the short text at 5 minutes; the admin texts are in practice. Merge the Hub change, then after a day turn them on in Settings, Missed clock-ins." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: redeploy timekeeper-watch from the commit before this one and restore ops_settings from c1_previous (Claude can do this); the link page can simply stay.")
done(0 if not fails else 8)
