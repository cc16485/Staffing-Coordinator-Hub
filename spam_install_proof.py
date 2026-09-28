#!/usr/bin/env python3
# Lead numbers S1 · proof of the spam INSTALLER on a disposable Postgres (real Journey foundation + lead mirror + folding). Never touches production.
import os, sys, json, hashlib, subprocess, tempfile
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "lead_fold_install_proof.py")).read()
src = src.replace('MIGF=os.path.join(H,', 'H=' + repr(H) + '; MIGF=os.path.join(H,', 1)
exec(compile(src[:src.index('c,P,s=fixture("lfi")')], "fx", "exec"))
KSQL = os.path.join(H, "lead-journey-spam.sql"); KSHA = hashlib.sha256(open(KSQL, "rb").read()).hexdigest()
res = []
def ck(n, c_, note=""): res.append((n, bool(c_), "" if c_ else str(note)[:600]))
def runp(sha, sock):
    rep = tempfile.mktemp()
    p = subprocess.run([sys.executable, os.path.join(H, "spam_install.py")], capture_output=True, text=True,
        env=dict(os.environ, SB_MIGFILE=KSQL, SB_EXPECTED_SHA=sha, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_SKIP_FUNCTION="1"))
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
c, P, s = fixture("spi")
s.run("""update app_data set data='[{"id":"R1","status":"New","created_at":"2026-09-20T15:00:00Z"}]'::jsonb where key='leads'""")
rc, out = runp(KSHA, c.sock); ck("before the duplicate-folding mirror is installed: stops, nothing changed", rc == 4 and "✗ the lead mirror is the duplicate-folding version" in out, out)
rc, o2 = c.psql(open(os.path.join(H, "lead-journey-fold.sql")).read()); assert rc == 0, o2[-300:]
rc, out = runp("0" * 64, c.sock); ck("a file that isn't the proven build: stops", rc == 2, out)
s.run("create function public.x_out() returns trigger language plpgsql as $$ begin perform pg_notify('x','y'); return new; end $$")
s.run("create trigger x_out_t after update on public.app_data for each row execute function public.x_out()")
rc, out = runp(KSHA, c.sock); ck("a trigger that could call outside the database: stops before anything runs", rc == 4 and "✗ no trigger" in out, out)
s.run("drop trigger x_out_t on public.app_data")
eps0 = s.run("select count(*) from journey_episode")[0][0]; leads0 = s.run("select data::text from app_data where key='leads'")[0][0]
rc, out = runp(KSHA, c.sock)
ck("the real run: every line is a ✓", rc == 0 and "✗" not in out and "RESULT: INSTALLED" in out, out)
ck("…the made-up inquiry's Journey was voided a week after its spam mark, the fresh one got none, and all of it was undone",
   "the mirror voided that Journey (provisional → voided)" in out and "never gets a Journey (spam_skipped)" in out
   and s.run("select count(*) from journey_episode")[0][0] == eps0 and s.run("select data::text from app_data where key='leads'")[0][0] == leads0, out)
rc, out = runp(KSHA, c.sock); ck("running it again: stops (already installed)", rc == 4 and "✗ not installed yet" in out, out)
print(out if "--show" in sys.argv else "", end="")
c.close()
for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
print("lead-journey-spam.sql sha256", KSHA)
print("reports-rollup/index.ts sha256", hashlib.sha256(open(os.path.join(H, "supabase/functions/reports-rollup/index.ts"), "rb").read()).hexdigest())
