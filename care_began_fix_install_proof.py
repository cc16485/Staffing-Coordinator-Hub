#!/usr/bin/env python3
# Gate 2a fix · proof of the care-began fix and its installer on a disposable Postgres (real Journey foundation). Never touches production.
import os, sys, json, hashlib, subprocess, shutil, tempfile
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "client_fact_install_proof.py")).read()
exec(compile(src[:src.index("def run(")], "cluster", "exec"))      # the same realistic database as the 2a installer proof
FIX = os.path.join(H, "client-fact-care-began-fix.sql")
FSHA = hashlib.sha256(open(FIX, "rb").read()).hexdigest()
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:500]))
def install_base(sock):
    rep = tempfile.mktemp()
    p = subprocess.run([sys.executable, os.path.join(H, "client_fact_install.py")], capture_output=True, text=True,
        env=dict(os.environ, SB_MIGFILE=SQL, SB_EXPECTED_SHA=SHA, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_SKIP_FUNCTION="1"))
    return p.returncode, open(rep).read()
def run_fix(sock, sha=FSHA):
    rep = tempfile.mktemp()
    p = subprocess.run([sys.executable, os.path.join(H, "care_began_fix_install.py")], capture_output=True, text=True,
        env=dict(os.environ, SB_MIGFILE=FIX, SB_EXPECTED_SHA=sha, SB_REPORT=rep, SB_LOCAL_SOCK=sock))
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr

d, srv, sock, s = cluster()
# like production: every lead's Journey opens with its INQUIRY date as its beginning (the lead mirror)
s.run("""update app_data set data = '[{"id":"L1","created_at":"2026-09-01T10:00:00Z"},{"id":"L2","created_at":"2026-09-10T10:00:00Z"}]' where key='leads'""")
s.run("set role service_role")
s.run("select public.episode_open_provisional(p_origin_system => 'lead', p_origin_ref => 'L2', p_began_on => '2026-09-10')")
s.run("reset role")
rc, out = install_base(sock); ck("the 2a install goes in first, as in production", rc == 0, out)
began = lambda: s.run("""select count(*) filter (where (public.care_began_for_episode(e.episode_id)->>'began')::boolean) from journey_episode e
                         where exists (select 1 from episode_source x where x.episode_id = e.episode_id and x.system='lead' and x.role='origin')""")[0][0]
ck("before the fix: a lead's inquiry date is wrongly read as care having begun", began() >= 1)
rc, out = run_fix(sock, sha="0" * 64); ck("a file that isn't the proven fix: stops before changing anything", rc == 2 and began() >= 1, out)
rc, out = run_fix(sock)
ck("the real run: every line of the report is a ✓ or a plain note, and the result is FIXED", rc == 0 and "✗" not in out and "RESULT: FIXED" in out, out)
ck("…after the fix, no lead's inquiry date counts as care", began() == 0)
ck("…an intake fact could be recorded on a lead (then undone), and nothing was left behind",
   "an intake fact can be recorded" in out and s.run("select (select count(*) from fact_kind)+(select count(*) from client_fact)")[0][0] == 0, out)
rc, out = run_fix(sock); ck("running it again: sees the fix is already in and stops", rc == 4 and "✗ the fix isn't in yet" in out, out)
s.close(); srv.cleanup(); shutil.rmtree(d, ignore_errors=True)
for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
print("client-fact-care-began-fix.sql sha256", FSHA)
