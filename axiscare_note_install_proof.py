#!/usr/bin/env python3
# C2b · proof of the Desktop 305 INSTALLER on a disposable Postgres. Never touches production.
import os, sys, hashlib, subprocess, tempfile
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "client_fact_install_proof.py")).read()
exec(compile(src[:src.index("def run(")], "cluster", "exec"))
KSQL = os.path.join(H, "axiscare-change-log.sql"); KSHA = hashlib.sha256(open(KSQL, "rb").read()).hexdigest()
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:600]))
def runp(sha, sock):
    rep = tempfile.mktemp()
    p = subprocess.run([sys.executable, os.path.join(H, "axiscare_note_install.py")], capture_output=True, text=True,
        env=dict(os.environ, SB_MIGFILE=KSQL, SB_EXPECTED_SHA=sha, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_SKIP_FUNCTION="1"))
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
d, srv, sock, s = cluster()
rc, out = runp(KSHA, sock); ck("before the staff sign-in tables exist: stops, nothing changed", rc == 4 and "✗ the staff sign-in check's tables exist" in out, out)
s.run("create table auth_identities (auth_user_id uuid, project_ref text, person_id uuid)"); s.run("create table staff_roles (person_id uuid, entity text, role text)")
rc, out = runp("0" * 64, sock); ck("a file that isn't the proven build: stops", rc == 2, out)
rc, out = runp(KSHA, sock); ck("the real run: every line is a ✓", rc == 0 and "✗" not in out and "RESULT: INSTALLED" in out, out)
ck("…a line was recorded and a bad one refused, and the record is left empty", "a line was recorded" in out and s.run("select count(*) from axiscare_change_log")[0][0] == 0, out)
rc, out = runp(KSHA, sock); ck("running it again: stops (already installed)", rc == 4 and "✗ not installed yet" in out, out)
s.close(); srv.cleanup()
for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
print("axiscare-change-log.sql sha256", KSHA)
print("axiscare-note/index.ts sha256", hashlib.sha256(open(os.path.join(H, "supabase/functions/axiscare-note/index.ts"), "rb").read()).hexdigest())
