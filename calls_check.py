#!/usr/bin/env python3
# P0 · phone calls into the profile · what is in place today (READ ONLY; yes/no, counts and dates only).
#  1. The call reader (call-followup) and the six other features that use the Anthropic key: deployed, version,
#     gateway setting.
#  2. The secrets they need are set (names only, never a value).
#  3. When the call reader last received a call.
#  4. Anything from calls stored on our side: transcripts on leads, unreviewed AI suggestions, drafts, recordings.
# Changes nothing, calls nothing. No name, number, transcript or key is printed.
import json, os, sys, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); LOCAL = os.environ.get("SB_LOCAL_SOCK"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
AI_FNS = ["call-followup", "call-disposition", "ai-draft-followup", "ai-draft-careplan", "profile-polish", "ai-ltc-policy", "score-interview"]
SECRETS = ["ANTHROPIC_API_KEY", "CALL_FOLLOWUP_TOKEN", "GHL_TOKEN"]
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  This check changes nothing.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try: rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]; return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e: return False, str(e)[:200]
        finally: c.close()
    req = urllib.request.Request(API + f"/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-p0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
def api_get(path):
    req = urllib.request.Request(API + f"/v1/projects/{REF}" + path, headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "cc-p0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
yn = lambda b: "yes" if b else "no"
ARR = lambda key: f"jsonb_array_elements(coalesce((select case when jsonb_typeof(data)='array' then data else '[]'::jsonb end from public.app_data where key='{key}'),'[]'::jsonb))"

say("P0 · PHONE CALLS INTO THE PROFILE · WHAT IS IN PLACE (read only; yes/no, counts and dates only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else "")); say()
say("1 · THE CALL READER AND THE OTHER FEATURES THAT USE THE AI KEY")
if LOCAL: say("  (not checked on a test target)")
else:
    st, lst = api_get("/functions")
    dep = {f.get("slug"): f for f in lst} if st == 200 and isinstance(lst, list) else {}
    if st != 200: say(f"  ✗ could not list the functions ({st})")
    for fn in AI_FNS:
        f = dep.get(fn)
        say(f"  {fn}: " + (f"deployed (version {f.get('version')}, gateway sign-in required: {yn(f.get('verify_jwt'))})" if f else "NOT deployed"))
say(); say("2 · THE SECRETS THEY NEED (names only)")
if LOCAL: say("  (not checked on a test target)")
else:
    st, sec = api_get("/secrets")
    names = {s.get("name") for s in sec} if st == 200 and isinstance(sec, list) else set()
    if st != 200: say(f"  ✗ could not list the secrets ({st})")
    for n in SECRETS: say(f"  {n} is set: {yn(n in names)}")
say(); say("3 · WHEN THE CALL READER LAST HEARD FROM GOHIGHLEVEL")
ok, r = sql(f"""select count(*) as n, max(e->>'at') as last_at,
  count(*) filter (where e->>'stage' = 'received') as received from {ARR('call_followup_log')} e""")
if ok and r:
    r = r[0]; say(f"  entries in its arrival log: {r['n']} · calls received: {r['received']} · last entry: {(r['last_at'] or 'never')[:16].replace('T',' ')}")
else: say("  ✗ could not read: " + str(r)[:200])
say(); say("4 · ANYTHING FROM CALLS STORED ON OUR SIDE")
ok, r = sql(f"""select count(*) as leads,
  count(*) filter (where coalesce(e->>'call_transcript','') <> '') as with_transcript,
  count(*) filter (where jsonb_typeof(e->'ai_suggestions')='array' and jsonb_array_length(e->'ai_suggestions') > 0) as with_suggestions,
  coalesce(sum(case when jsonb_typeof(e->'ai_suggestions')='array' then jsonb_array_length(e->'ai_suggestions') else 0 end),0) as suggestions,
  coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(e->'ai_suggestions')='array' then e->'ai_suggestions' else '[]'::jsonb end) s
     where coalesce((s->>'reviewed')::boolean, false) = false)),0) as unreviewed
  from {ARR('leads')} e""")
if ok and r:
    r = r[0]
    say(f"  leads: {r['leads']} · holding a call transcript: {r['with_transcript']}")
    say(f"  leads with AI suggestions: {r['with_suggestions']} · suggestions: {r['suggestions']} · not reviewed: {r['unreviewed']}")
else: say("  ✗ could not read the leads: " + str(r)[:200])
ok, r = sql(f"""select count(*) as n, count(*) filter (where e->>'status'='pending_approval') as waiting,
  count(*) filter (where coalesce(e->>'transcript','') <> '' or coalesce(e->>'call_transcript','') <> '') as with_transcript
  from {ARR('post_call_followups')} e""")
if ok and r: r = r[0]; say(f"  drafted follow-ups: {r['n']} · waiting for approval: {r['waiting']} · holding a transcript: {r['with_transcript']}")
else: say("  ✗ could not read the drafts: " + str(r)[:200])
ok, r = sql("select to_regclass('public.recordings') is not null as present")
if ok and r and r[0]["present"]:
    ok2, r2 = sql("select count(*) as n from public.recordings")
    say(f"  recordings kept: {r2[0]['n'] if ok2 and r2 else 'could not count'}")
else: say("  recordings table: not present")
say()
say("Nothing was changed or called. No name, number, transcript or key was printed.")
done(0)
