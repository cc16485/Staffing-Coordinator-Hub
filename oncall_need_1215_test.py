#!/usr/bin/env python3
# Test of 1215 (oncall_need_1215.py, "which on-call shifts are needed most", read only) end to end: the step runs against a FAKE
# Supabase whose database is a throwaway Postgres (PGlite) with made-up cases. Proves it only ever reads, never prints names, and
# that the plain-words answer ranks the right times. Never touches a real project.
#   python3 oncall_need_1215_test.py   (PGLITE=<path to @electric-sql/pglite/dist/index.js>, default the shared copy)
import json, os, re, subprocess, tempfile, threading, http.server, shutil, datetime as dt, sys
HERE = os.path.dirname(os.path.abspath(__file__))
PGLITE = os.environ.get("PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
if not os.path.exists(PGLITE):
    print("SKIP · PGlite not on this Mac"); print("1/1"); raise SystemExit(0)
TODAY = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()
def day_with(wd, back_weeks=1):
    """A date in the past with weekday wd (0 = Monday), at least a few days back."""
    d = TODAY - dt.timedelta(days=7 * back_weeks)
    return (d - dt.timedelta(days=(d.weekday() - wd) % 7)).isoformat()
TUE, SAT, MON = day_with(1), day_with(5), day_with(0, 2)
def z(date, hhmm, hours_before):
    t = dt.datetime.fromisoformat(f"{date}T{hhmm}:00-05:00") - dt.timedelta(hours=hours_before)
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
cases = [
  # Tuesday overnight: three short-notice call-offs, two never filled (the most needed)
  {"id": "cw_1", "status": "done", "resolved_how": "uncovered", "shift_date": TUE, "shift_time": "19:00-23:00", "opened_at": z(TUE, "19:00", 1), "covered_by": "Ann Bee"},
  {"id": "cw_2", "status": "done", "resolved_how": "couldnt_staff", "shift_date": TUE, "shift_time": "22:00-06:00", "opened_at": z(TUE, "22:00", 3)},
  {"id": "cw_3", "status": "done", "resolved_how": "covered", "covered_by": "Ann Bee", "shift_date": TUE, "shift_time": "20:00-23:00", "opened_at": z(TUE, "20:00", 0.5), "confirmed_at": z(TUE, "20:00", 0.1)},
  # Saturday daytime: one short-notice call-off, filled
  {"id": "cw_4", "status": "done", "resolved_how": "covered", "covered_by": "Cal Dee", "shift_date": SAT, "shift_time": "09:00-13:00", "opened_at": z(SAT, "09:00", 5), "confirmed_at": z(SAT, "09:00", 4)},
  # Monday daytime: lots of notice, filled (probably fine)
  {"id": "cw_5", "status": "done", "resolved_how": "covered", "covered_by": "Cal Dee", "shift_date": MON, "shift_time": "08:00-12:00", "opened_at": z(MON, "08:00", 48), "confirmed_at": z(MON, "08:00", 40)},
  # not a staffing need, and an unreadable time
  {"id": "cw_6", "status": "flagged", "shift_date": TUE, "shift_time": "09:00"},
  {"id": "cw_7", "status": "done", "resolved_how": "covered", "shift_date": TUE, "shift_time": "this morning", "opened_at": z(TUE, "09:00", 1)}]
SEED = {"coverage_cases": cases, "coverage_cases_archive": [], "timekeeper_cases": [], "attendance_events": [], "ops_items": []}
TMP = tempfile.mkdtemp(prefix="t1215-")
helper = os.path.join(TMP, "pg.mjs")
open(helper, "w").write("""import { PGlite } from %s
import readline from 'readline'
const db = new PGlite()
await db.exec(`create table app_data(key text primary key, data jsonb, updated_at timestamptz default now());
create table prn_shift_log(id serial, axiscare_caregiver_id text, case_id text, kind text, shift_date date);
create table pay_tracks(applicant_id int, track text, axiscare_caregiver_id text);
create table visit_history(id bigserial, visit_id text, client_axiscare_id text, reason_id text, reason_name text, caregiver_id text, caregiver_name text, state text, start text, "end" text, first_seen boolean default false, seen_at timestamptz default now());
create table late_notices(id bigserial, visit_id text, kind text, status text, shift_date date, shift_start timestamptz, said jsonb default '[]', said_at timestamptz, closed_how text, coverage_case_id text);
create table op_events(id bigserial, at timestamptz default now(), verb text);
create table app_data_item_change(id bigserial, at timestamptz default now(), key text, change text, bulk_removed boolean default false);`)
const seed = JSON.parse(process.argv[2])
for (const [k, v] of Object.entries(seed)) await db.query('insert into app_data(key, data) values ($1, $2)', [k, JSON.stringify(v)])
const rl = readline.createInterface({ input: process.stdin })
for await (const line of rl) {
  const { q } = JSON.parse(line)
  try { const r = await db.query(q); process.stdout.write(JSON.stringify({ ok: true, rows: r.rows }) + '\\n') }
  catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\\n') }
}
""" % json.dumps(PGLITE))
node = shutil.which("node") or "/opt/homebrew/bin/node"
pg = subprocess.Popen([node, helper, json.dumps(SEED)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
LOCK = threading.Lock(); SENT = []
def ask(q):
    with LOCK:
        pg.stdin.write(json.dumps({"q": q}) + "\n"); pg.stdin.flush(); return json.loads(pg.stdout.readline())
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n) or b"{}").get("query", ""); SENT.append(q)
        r = ask(q); b = json.dumps(r["rows"] if r["ok"] else {"message": r["error"]}).encode()
        self.send_response(200 if r["ok"] else 400); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
WT = os.path.join(TMP, "wt"); subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
try:
    rep = os.path.join(TMP, "r.txt")
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=f"http://127.0.0.1:{srv.server_address[1]}", SB_STEP="1215")
    p = subprocess.run([sys.executable, os.path.join(WT, "oncall_need_1215.py")], cwd=WT, env=env, capture_output=True, text=True, timeout=300)
    out = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    ck("runs from a fresh copy against the throwaway Postgres: exit 0, LOOKED, every read worked", p.returncode == 0 and "RESULT: LOOKED · nothing was changed." in out and "✗" not in out, out[-2500:])
    sys.path.insert(0, WT); import oncall_need_1215 as N
    class Bad(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_POST(self):
            self.send_response(401); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b'{"message":"Unauthorized"}')
    bsrv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Bad); threading.Thread(target=bsrv.serve_forever, daemon=True).start()
    rep2 = os.path.join(TMP, "r2.txt")
    p2 = subprocess.run([sys.executable, os.path.join(WT, "oncall_need_1215.py")], cwd=WT, env=dict(env, SB_REPORT=rep2, SB_API_BASE=f"http://127.0.0.1:{bsrv.server_address[1]}"), capture_output=True, text=True, timeout=120)
    out2 = open(rep2).read() if os.path.exists(rep2) else p2.stdout + p2.stderr
    ck("a token Supabase won't accept: stops at once and says how to fix it", p2.returncode == 3 and "didn't accept the access token" in out2 and out2.count("✗") == 1, out2[-800:])
    ck("read only: every statement it sent is a single SELECT, and it refuses anything else", SENT and all(N.is_select_only(q) for q in SENT)
       and not N.is_select_only("update public.app_data set data = '[]'") and not N.is_select_only("select 1; delete from public.app_data") and not N.is_select_only("select upsert_app_data_item('x', '{}')"), [q[:80] for q in SENT if not N.is_select_only(q)])
    ck("no names: nobody's name from the cases appears", "Ann Bee" not in out and "Cal Dee" not in out)
    ck("the slots (7am to 7pm since 2026-10-30): a Tuesday 6pm start is daytime, 7pm and 10pm are Tuesday overnight; a 9am Saturday start is Saturday daytime", N.slot(N.start_of(TUE, "18:00"))[:2] == ("Tue", "day") and N.slot(N.start_of(TUE, "19:00"))[:2] == ("Tue", "night") and N.slot(N.start_of(TUE, "22:00-06:00"))[:2] == ("Tue", "night") and N.slot(N.start_of(SAT, "09:00"))[:2] == ("Sat", "day")
       and N.slot(N.start_of(day_with(2), "02:00"))[:2] == ("Tue", "night") and N.start_of(TUE, "this morning") is None)
    ck("the skips are said: a flag is not a staffing need, a free-text time is not guessed", "not a staffing need" in out and "start time unreadable" in out, out[:3000])
    plain = out[out.index("IN PLAIN WORDS"):] if "IN PLAIN WORDS" in out else ""
    most = plain[plain.index("MOST NEEDED"):plain.index("FINE TO LEAVE")] if "MOST NEEDED" in plain and "FINE TO LEAVE" in plain else plain
    ck("IN PLAIN WORDS: what is open now (the starting set); Tuesdays overnight first (3 short-notice, 2 not filled, not open now), then Saturdays daytime (open)", "Open for sign-up now: Fridays, daytime (7am to 7pm); Saturdays, daytime (7am to 7pm); Sundays, daytime (7am to 7pm) (the starting set)." in plain
       and re.search(r"MOST NEEDED.*\n\s+Tuesdays, overnight \(7pm to 7am\): 3 short-notice needs, 2 not filled, 3 in all  \(not open for sign-up now\)\n\s+Saturdays, daytime \(7am to 7pm\): 1 short-notice need, 0 not filled, 1 in all\n", plain), plain)
    ck("...Monday daytime (lots of notice, filled) is 'probably fine', not most needed", "Probably fine too" in plain and "Mondays, daytime" in plain.split("Probably fine too")[1] and "Mondays" not in most, plain)
    ck("...times with nothing at all are 'fine to leave without on call'", re.search(r"FINE TO LEAVE WITHOUT ON CALL.*Wednesdays, daytime", plain) and "Tuesdays, overnight" not in plain.split("FINE TO LEAVE")[1].split("\n")[0], plain)
    ck("...says how many days it looked at, and to run it again monthly while history is short", re.search(r"about \d+ days of call-offs and open shifts \(still early", plain), plain)
    ck("no em dash, no key or token in the report", "—" not in out and not re.search(r"sbp_\w|eyJ\w", out))
finally:
    pg.kill(); subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
