#!/usr/bin/env python3
# 449 · STAND-UP AND TEAM MEETINGS MOVE INTO THE CC HUB (Today). Samantha approved 2026-10-04/05 with the suggested
# choices (https://claude.ai/artifact/2BZP14QkBcLjPy34dXJ9Ab): the board and meetings are tabs under Today in the CC Hub,
# the no-sign-in quick-add page is retired, meeting action items are board items. Internal only: no texts or emails.
# Part 1 (read only): the reviewed SQL (pinned); its test passes here; the new Hub page and the retired quick-add page are
#   the ones live (so closing the old door can't break a page anyone uses); the database's set-up.
# Part 2: standup_move.sql (quick-add function closed to the public key and to signed-in pages; CC Hub staff reach the
#   two lists; the team video room name copied into the CC Hub's own settings).
# Part 3 (proof, all undone): the function can't be called from outside; acting as a person whose only hub is the CC
#   Hub, the board and meetings can be read and an item added; someone with only the old Staffing hub still can't see
#   the board; the Team Hub's own settings stay out of the CC Hub's reach. If the proof isn't exactly right, the change
#   is taken back off (standup_move_rollback.sql). Prints yes/no and counts only, nothing on the board.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys

REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"; ROOT = os.environ["SB_REPO"]
HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com/"); TEAM = os.environ.get("SB_TEAM_BASE", "https://hub.mo-care.com/")

lines = []; fails = []
def say(s=""):
    s = str(s)
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-449/1.0", "Cache-Control": "no-cache"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def probe(q):
    """The proof always ends by raising PROBE_RESULT: {json}; read that JSON exactly."""
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
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

say("449 · STAND-UP AND TEAM MEETINGS MOVE INTO THE CC HUB"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in (("standup_move.sql", os.environ.get("SB_SQL_SHA", "")), ("standup_move_proof.sql", os.environ.get("SB_PROOF_SHA", "")), ("standup_move_rollback.sql", os.environ.get("SB_ROLLBACK_SHA", ""))):
    if not os.path.exists(os.path.join(ROOT, f)) or sha(os.path.join(ROOT, f)) != want: bad(f"{f} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the change, its proof and its undo are the reviewed build")
try:
    if os.environ.get("SB_REHEARSAL_SKIP_SQL_TEST") == "1": raise ImportError
    import pgserver  # noqa: F401
    p = subprocess.run([sys.executable, "standup_move_sql_test.py"], cwd=ROOT, capture_output=True, text=True, timeout=600)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"standup_move_sql_test.py failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ standup_move_sql_test.py: {last.strip()} (on a throwaway database on this Mac, set up like the real one)")
except ImportError: say("  · the database tests were not re-run here (they passed when built)")

# the pages people use must already be the new ones
s1, b1 = http("GET", HUB + "standup-board.js?449=" + dt.datetime.now().strftime("%H%M%S"))
s2, b2 = http("GET", HUB + "index.html?449=" + dt.datetime.now().strftime("%H%M%S"))
s3, b3 = http("GET", TEAM + "quick-add.html?449=" + dt.datetime.now().strftime("%H%M%S"))
if s1 != 200 or "SAFE CHANGES" not in b1 or s2 != 200 or 'id="tab-standup"' not in b2:
    bad("the CC Hub isn't showing the new Stand-Up tab yet (Claude merges the Hub change first; GitHub can take a few minutes)"); say("  STOP. Nothing was changed."); done(3)
say("  ✓ the CC Hub live has the Stand-Up and Team Meetings tabs")
if s3 != 200 or "submit_standup_note_public" in b3 or "cc.mo-care.com/#standup" not in b3:
    bad("the Team Hub's old quick-add page is still the live one (Claude merges the Team Hub change first; GitHub can take a few minutes)"); say("  STOP. Nothing was changed."); done(3)
say("  ✓ the Team Hub's quick-add page live is the 'moved' page (it no longer writes to the board)")

ok, st = sql("""select
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_standup_note_public')::int as fns,
  (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_standup_note_public') as anon_can,
  to_regclass('public.app_data_key_hub_map') is not null as map,
  to_regprocedure('public.jwt_hub_access()') is not null as jwt_fn,
  to_regprocedure('public.upsert_app_data_item(text, jsonb)') is not null as saver,
  (select count(*) from public.app_data_key_hub_map where hub_slug = 'care_coordinator' and data_key in ('standup_notes', 'team_meetings'))::int as mapped,
  (select string_agg(distinct hub_slug, ',' order by hub_slug) from public.app_data_key_hub_map where data_key in ('standup_notes', 'team_meetings')) as hubs_now,
  (select jsonb_typeof(data) from public.app_data where key = 'ops_settings') as ops_shape,
  (select (data ? 'team_video_room') from public.app_data where key = 'ops_settings' and jsonb_typeof(data) = 'object') as room_there,
  (select count(*) from public.app_data t, jsonb_array_elements(case when jsonb_typeof(t.data) = 'array' then t.data else '[]'::jsonb end) x
    where t.key = 'team_hub_settings' and x->>'id' = 'video_room' and x->>'room_name' ~ '^[A-Za-z0-9_-]{12,80}$')::int as team_room""")
if not ok or not st: bad("couldn't read the database's set-up: " + str(st)[:200] + ". Nothing was changed."); done(3)
s0 = st[0]
if not (s0["map"] and s0["jwt_fn"] and s0["saver"]): bad("the hub-access map, the hub list reader or the item save isn't there as expected. Nothing was changed. Tell Claude."); done(3)
if s0["ops_shape"] != "object": bad("the CC Hub settings list isn't in the expected shape. Nothing was changed. Tell Claude."); done(3)
say(f"  · the old quick-add function: {s0['fns']} found, " + ("callable with the public key now" if s0["anon_can"] else "already closed to the public key"))
say(f"  · the board and meetings are reachable from: {s0['hubs_now'] or '(no hub)'}" + (" (CC Hub already included)" if s0["mapped"] == 2 else ""))
say("  · team video room: " + ("there is one in the Team Hub" if s0["team_room"] else "the Team Hub has none yet") + ("; the CC Hub already has its copy" if s0["room_there"] else ""))
fresh = s0["mapped"] == 0 and not s0["room_there"] and (s0["anon_can"] or s0["fns"] == 0)   # nothing was in place before, so undo is exact

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(ROOT, "standup_move.sql")).read() + "\ncommit;")
if not ok: bad("the change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the quick-add door is closed, the CC Hub can reach the board and meetings, and the video room is copied")

say(); say("PART 3 · PROOF (acting as a signed-in person whose only hub is the CC Hub; all of it undone)")
res, err = probe(open(os.path.join(ROOT, "standup_move_proof.sql")).read())
if res is None: bad("the proof didn't answer: " + str(err))
else:
    chk(not res.get("anon_can_call") and not res.get("signed_in_can_call") and not res.get("everyone_can_call"),
        "the old quick-add function can't be called from outside any more" + ("" if res.get("functions") else " (it isn't there at all)")
        + ("" if not (res.get("anon_can_call") or res.get("signed_in_can_call") or res.get("everyone_can_call")) else f" (public key {res.get('anon_can_call')}, signed in {res.get('signed_in_can_call')}, everyone {res.get('everyone_can_call')})"))
    if not res.get("claim_read"): bad("the proof couldn't act as a CC Hub-only person (the database reads the hub list some other way). Tell Claude.")
    else:
        chk(res.get("cc_sees_board") == res.get("board_exists") and res.get("cc_sees_meetings") == res.get("meetings_exist") and res.get("cc_sees_settings") == 1,
            f"a CC Hub-only person can read the board ({res.get('cc_sees_board')} of {res.get('board_exists')}), the meetings ({res.get('cc_sees_meetings')} of {res.get('meetings_exist')}) and the CC Hub settings")
        chk(res.get("cc_can_add") == "went in", f"...and add an item to the board ({res.get('cc_can_add')})")
        chk(res.get("staffing_only_sees_board") == 0, "someone with only the old Staffing hub still can't see the board")
        say("  " + ("✓ the Team Hub's own settings stay out of the CC Hub's reach" if res.get("cc_sees_team_hub_settings") == 0
                    else "· note: the Team Hub's settings list was already open to the CC Hub before this (449 didn't change that)"))
    if res.get("team_room"): chk(res.get("room_copied_same") is True, "the CC Hub's video room is the same room as the Team Hub's")
    else: say("  · there was no team video room to copy; the Hub's button says so until one is made")
if fails:
    if fresh:
        ok, r = sql(open(os.path.join(ROOT, "standup_move_rollback.sql")).read())
        (say if ok else bad)(("  ✓ " if ok else "") + "because the proof wasn't exactly right, the change was taken back off (nothing else changed)" + ("" if ok else ": " + str(r)[:160]))
    else: say("  · part of this was already in place before this run, so it was left as it is for Claude to look at")
say()
say("RESULT: " + ("DONE · Stand-Up and Team Meetings work in the CC Hub, and the old no-sign-in door is closed." if not fails else "NOT DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, and nothing on the board or in the meetings was changed.")
say("Rollback: standup_move_rollback.sql (Claude can run it).")
done(0 if not fails else 8)
