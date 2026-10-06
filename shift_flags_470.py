#!/usr/bin/env python3
# 470 · SHIFT-NOTE FLAGS: RED OR YELLOW, WHY, AND WHAT HAPPENS NEXT (practice first). Samantha 2026-10-06: "Can the shift
# notes be more clear on why they are listed on the hub, is it a yellow or red flag... Also a better flow on what to do";
# she loved the mockup and said yes to every recommendation.
# Part 1 (read only): the reviewed build; who owns Client Care; whether an "Incidents" area exists (red flags also go on
#   its owner's My Work); the switches.
# Part 2: deploy care-notes (it can now give red / yellow / none, why, the caregiver's words, the pattern rule, and the
#   daytime red-flag text). If there is no Incidents area yet, add one owned by Samantha with Zach as escalation (her
#   answer: "you as the Incidents owner"); change it any time where the Hub's areas are owned.
#   The switches stay OFF (hers: Owners Hub Admin page or Hub Settings > Shift-note flags).
# Part 3: the public key is refused; a PRACTICE over the last two days: how many reds, yellows and normal days, and the old
#   yes/no for comparison. Counts only: nothing saved, nobody texted.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "care-notes"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-470/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def probe(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    texts = []
    try:
        j = json.loads(b); texts.append(j.get("message") if isinstance(j, dict) else str(j))
    except Exception: pass
    texts.append(b.replace('\\"', '"'))
    for t in texts:
        if not t or "PROBE_RESULT: " not in t: continue
        try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + len("PROBE_RESULT: "):])[0], None
        except Exception: continue
    return None, f"HTTP {s}: {b[:240]}"
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

lit = lambda v: "'" + str(v).replace("'", "''") + "'"
FN = "care-notes"
say("470 · SHIFT-NOTE FLAGS: RED OR YELLOW (PRACTICE)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", name.split("/", 1)[1] + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build of the shift-note reader")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: before = json.loads(b) if s == 200 else {}
except Exception: before = {}
if not isinstance(before.get("verify_jwt"), bool): bad("could not read the shift-note reader's setting. Nothing was changed."); done(4)
ok, st = sql("""select
  (select p.full_name from public.domains d join public.persons p on p.person_id = d.owner_person where d.entity = 'cc_ihs' and d.code = 'client_care') as client_care,
  (select p.full_name from public.domains d left join public.persons p on p.person_id = d.owner_person where d.entity = 'cc_ihs' and d.code = 'incidents') as incidents,
  exists (select 1 from public.domains where entity = 'cc_ihs' and code = 'incidents') as has_incidents,
  (select person_id::text from public.persons where lower(primary_email) = 'samantha@mo-care.com' limit 1) as sam,
  (select person_id::text from public.persons where lower(primary_email) like 'zach%@mo-care.com' limit 1) as zach,
  (select coalesce((data->>'care_notes_flag_live')::boolean, false) from public.app_data where key = 'ops_settings') as notes_live,
  (select coalesce((data->>'care_notes_levels_live')::boolean, false) from public.app_data where key = 'ops_settings') as levels_live,
  (select coalesce((data->>'care_notes_red_text_live')::boolean, false) from public.app_data where key = 'ops_settings') as text_live""")
if not ok or not st: bad("couldn't read the set-up: " + str(st)[:200] + ". Nothing was changed."); done(3)
s0 = st[0]
say(f"  · Client Care is owned by {s0['client_care'] or 'nobody yet'}: red and yellow flags go to them")
say(f"  · Incidents area: " + (f"there, owned by {s0['incidents'] or 'nobody yet'}" if s0["has_incidents"] else "not there yet (it will be added, owned by Samantha)"))
say(f"  · switches: shift-note flags {'on' if s0['notes_live'] else 'OFF'} · red and yellow {'ON (left as it is)' if s0['levels_live'] else 'off (stays off)'} · red flag texts {'ON (left as it is)' if s0['text_live'] else 'off (stays off)'}")

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if before["verify_jwt"] else ["--no-verify-jwt"]),
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. The shift-note reader is unchanged."); done(6)
say("  ✓ the shift-note reader deployed (red and yellow only once you switch them on)")
if not s0["has_incidents"]:
    if not s0["sam"]: bad("couldn't find Samantha's record to own the Incidents area; red flags will go to Client Care only")
    else:
        ok, r = sql(f"""insert into public.domains (entity, code, label, owner_person, escalation_person)
                       values ('cc_ihs', 'incidents', 'Incidents', {lit(s0['sam'])}::uuid, {lit(s0['zach']) + '::uuid' if s0['zach'] else 'null'})
                       on conflict do nothing returning code""")
        chk(ok and r, "the Incidents area is added, owned by Samantha" + (" with Zach as escalation" if s0["zach"] else ""))

say(); say("PART 3 · PROOF AND THE PRACTICE RUN (nothing saved or sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: after = json.loads(b) if s == 200 else {}
except Exception: after = {}
chk(after.get("verify_jwt") == before["verify_jwt"] and isinstance(after.get("version"), int) and after["version"] > (before.get("version") or 0),
    f"gateway setting kept · now running version {after.get('version')} (was {before.get('version')})")
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}?flag=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 == 401, f"the public key → refused ({s1})")
ok, r = sql("select p.full_name from public.domains d left join public.persons p on p.person_id = d.owner_person where d.entity = 'cc_ihs' and d.code = 'incidents'")
if ok and r: say(f"  · the Incidents area is owned by {r[0]['full_name'] or 'nobody'}")
say("  running the practice over the last two days (this can take a few minutes)…")
s2, b2 = http("POST", f"{FNB}/functions/v1/{FN}?flag=1&practice=1&hours=48", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b2)
except Exception: j = None
if s2 != 200 or not isinstance(j, dict) or j.get("error") or "red" not in j: bad(f"the practice run did not answer ({s2}): " + str((j or {}).get("error") if isinstance(j, dict) else b2)[:160])
else:
    read = j["red"] + j["yellow"] + j["normal_day"]
    say(f"  ✓ practice, last {j['window_hours']} hours: {j['visits_finished']} shifts finished · {j['days_with_words']} caregiver-client-days with words")
    say(f"    red and yellow: {j['red']} red, {j['yellow']} yellow, {j['normal_day']} normal days (no card)" + (f" · {j['pattern_red']} of the reds are a pattern (3 yellows in 14 days)" if j.get("pattern_red") else "") + (f" · {j['ai_could_not_read']} the AI couldn't read" if j.get("ai_could_not_read") else ""))
    if j.get("by_level_kind"): say("    by kind: " + ", ".join(f"{k} {v}" for k, v in sorted(j["by_level_kind"].items(), key=lambda x: (-x[1], x[0]))))
    say(f"    the older yes/no on the same notes would flag {j['flagged']} of {j['asked']}")
say()
say("RESULT: " + ("INSTALLED WITH THE SWITCHES OFF · turn on \"Shift notes: red and yellow flags\" (Owners Hub Admin page, or Hub Settings > Shift-note flags) once the practice looks right." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed, and no note's words, name or number was printed. Rollback: care-notes from the commit before this one.")
done(0 if not fails else 8)
