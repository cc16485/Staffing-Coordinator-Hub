#!/usr/bin/env python3
# 466 · MY DESK, STAGE 6b: KIND WORDS FOUND IN SHIFT NOTES, IN PRACTICE. Samantha approved Stage 6 on 2026-10-06 (plan
# decision 6: suggestions the Hub finds wait for an owner or coordinator to say "yes, that's kind"; practice first).
# The shift-note reader (care-notes, every two hours) also asks a second, separate question of each note: did the client
# or family SAY something kind? The words must be the note's own, word for word. With the switch on, each becomes a
# suggestion in the jar's "Waiting for a yes"; only a person's yes puts it in the jar and on desks.
# Part 1 (read only): the reviewed build; the desk storage (463) and kind-word delivery (465) are there; the switches.
# Part 2: deploy care-notes. The kind-words switch is NOT turned on (that is hers, on the Owners Hub Admin page).
# Part 3: the public key is refused; a suggestion can be saved by the server and nobody but a decider can read it (tried
#   inside a test that is undone); a PRACTICE over the last two days: counts only, nothing saved, nothing sent.
# Never contacts anyone. No note's words, name or number is printed.
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-466/1.0"}, **(headers or {})))
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

say("466 · MY DESK: KIND WORDS FOUND IN SHIFT NOTES (PRACTICE)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build of the shift-note reader")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: before = json.loads(b) if s == 200 else {}
except Exception: before = {}
if not isinstance(before.get("verify_jwt"), bool): bad("could not read the shift-note reader's setting. Nothing was changed."); done(4)
ok, st = sql("""select to_regclass('public.kind_words') is not null as kw,
  coalesce((select prosrc like '%kind_word_deliver%' from pg_proc where oid = to_regprocedure('public.kind_word_decide(uuid,boolean)')), false) as delivers,
  (select coalesce((data->>'care_notes_flag_live')::boolean, false) from public.app_data where key = 'ops_settings') as notes_live,
  (select coalesce((data->>'kind_words_suggest_live')::boolean, false) from public.app_data where key = 'ops_settings') as kind_live,
  (select count(*)::int from cron.job where jobname = 'care-notes-flag' and active) as job""")
if not ok or not st: bad("couldn't read the database's set-up: " + str(st)[:200] + ". Nothing was changed."); done(3)
s0 = st[0]
if not s0["kw"] or not s0["delivers"]: bad("the Kind Words jar (463) or its delivery (465) isn't there. Nothing was changed. Tell Claude."); done(3)
say("  ✓ the Kind Words jar (463) and its delivery to desks (465) are there")
say(f"  · shift-note flags (every two hours): {'on' if s0['notes_live'] else 'OFF'} · schedule {'running' if s0['job'] == 1 else 'NOT running'}")
say(f"  · kind-word suggestions switch: {'ON (left as it is)' if s0['kind_live'] else 'off (stays off; it is yours, on the Owners Hub Admin page)'}")
if not s0["notes_live"] or s0["job"] != 1: say("    note: kind-word suggestions ride on the shift-note run, so they wait until shift-note flags run too")

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if before["verify_jwt"] else ["--no-verify-jwt"]),
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. The shift-note reader is unchanged."); done(6)
say("  ✓ the shift-note reader deployed (it now also looks for kind words, only while the switch is on)")

say(); say("PART 3 · PROOF AND THE PRACTICE RUN (nothing saved or sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: after = json.loads(b) if s == 200 else {}
except Exception: after = {}
chk(after.get("verify_jwt") == before["verify_jwt"] and isinstance(after.get("version"), int) and after["version"] > (before.get("version") or 0),
    f"gateway setting kept · now running version {after.get('version')} (was {before.get('version')})")
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}?flag=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 == 401, f"the public key → refused ({s1})")
res, err = probe("""do $p$ declare v uuid; seen_auth int; begin
  set local role service_role;
  insert into public.kind_words (quote, who, about, about_role, source, source_ref, said_on, link, status, suggested_by)
  values ('466 test words', 'Test', 'Test', 'caregiver', 'shift_note', 'carenote:466|test', current_date, '{"type":"client","ax":"0","name":"Test"}'::jsonb, 'suggested', 'care-notes')
  returning id into v;
  reset role;
  set local role authenticated; perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000"}', true);
  select count(*) into seen_auth from public.kind_words where id = v;
  reset role;
  raise exception 'PROBE_RESULT: %', jsonb_build_object('saved', v is not null, 'stranger_sees', seen_auth,
    'drops', (select count(*) from public.kind_word_drops where kind_word_id = v));
end $p$;""")
if res is None: bad("the proof didn't answer: " + str(err))
else:
    chk(res.get("saved") is True, "the server can save a suggestion (tried inside a test that was undone)")
    chk(res.get("stranger_sees") == 0, "someone who isn't an owner or coordinator can't see a suggestion")
    chk(res.get("drops") == 0, "a suggestion is on nobody's desk until a person says yes")
say("  running the practice over the last two days (this can take a few minutes)…")
s2, b2 = http("POST", f"{FNB}/functions/v1/{FN}?flag=1&practice=1&hours=48", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b2)
except Exception: j = None
if s2 != 200 or not isinstance(j, dict) or j.get("error") or "kind_asked" not in j: bad(f"the practice run did not answer ({s2}): " + str((j or {}).get("error") if isinstance(j, dict) else b2)[:160])
else:
    say(f"  ✓ practice, last {j['window_hours']} hours: {j['visits_finished']} shifts finished · {j['days_with_words']} caregiver-client-days with words")
    say(f"    kind words: the AI read {j['kind_asked']} and found {j['kind_found']} it could quote word for word"
        + (f" · {j['kind_not_in_note']} thrown away (not the note's own words)" if j.get("kind_not_in_note") else "")
        + (f" · {j['kind_ai_failed']} it couldn't read" if j.get("kind_ai_failed") else ""))
    say(f"    (the same run's concern count, for comparison: would flag {j['flagged']} of {j['asked']})" + (" · AxisCare asked us to slow down, so some weren't read" if j.get("stopped_early") else ""))
    if not j.get("kind_found"): say("    none in the last two days is normal: caregivers rarely write down what families say. The switch can still go on.")
say()
say("RESULT: " + ("INSTALLED WITH THE SWITCH OFF · nothing is suggested until you turn on \"Kind words from shift notes\" on the Owners Hub Admin page." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed, and no note's words, name or number was printed. Rollback: care-notes from the commit before this one.")
done(0 if not fails else 8)
