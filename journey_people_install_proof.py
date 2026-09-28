#!/usr/bin/env python3
# Gate 4a · proof of the people INSTALLER on a disposable Postgres (real Journey foundation + the installed fact record + fix). Never touches production.
import os, sys, json, hashlib, subprocess, shutil, tempfile
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "client_fact_install_proof.py")).read()
exec(compile(src[:src.index("def run(")], "cluster", "exec"))
KSQL = os.path.join(H, "journey-people.sql"); KSHA = hashlib.sha256(open(KSQL, "rb").read()).hexdigest()
FIX = os.path.join(H, "client-fact-care-began-fix.sql")
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:500]))
def runp(script, mig, sha, sock):
    rep = tempfile.mktemp()
    p = subprocess.run([sys.executable, os.path.join(H, script)], capture_output=True, text=True,
        env=dict(os.environ, SB_MIGFILE=mig, SB_EXPECTED_SHA=sha, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_SKIP_FUNCTION="1"))
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
d, srv, sock, s = cluster()
s.run("set role service_role"); s.run("select public.episode_open_provisional(p_origin_system => 'lead', p_origin_ref => 'L1b', p_began_on => '2026-09-10')"); s.run("reset role")
rc, out = runp("journey_people_install.py", KSQL, KSHA, sock)
ck("before the fact record exists: stops, nothing changed", rc in (3, 4) and s.run("select to_regclass('public.journey_person')")[0][0] is None, out)
runp("client_fact_install.py", SQL, SHA, sock)
runp("care_began_fix_install.py", FIX, hashlib.sha256(open(FIX, "rb").read()).hexdigest(), sock)
rc, out = runp("journey_people_install.py", KSQL, "0" * 64, sock); ck("a file that isn't the proven build: stops", rc == 2, out)
rc, out = runp("journey_people_install.py", KSQL, KSHA, sock)
ck("the real run: every line is a ✓", rc == 0 and "✗" not in out and "RESULT: INSTALLED" in out, out)
ck("…a made-up person went through the door on an inquiry, and nothing was kept", "a made-up person was added" in out and s.run("select count(*) from journey_person")[0][0] == 0, out)
rc, out = runp("journey_people_install.py", KSQL, KSHA, sock); ck("running it again: stops (already installed)", rc == 4, out)
s.close(); srv.cleanup(); shutil.rmtree(d, ignore_errors=True)
for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
print("journey-people.sql sha256", KSHA)
print("client-fact/index.ts sha256", hashlib.sha256(open(os.path.join(H, "supabase/functions/client-fact/index.ts"), "rb").read()).hexdigest())
