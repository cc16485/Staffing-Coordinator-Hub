# 760 · runs the read-only access report against a throwaway local Postgres shaped like the hub project, then proves it
# told the truth AND changed nothing (every table's contents hashed before and after). python3 access_report_760_test.py
import os, sys, subprocess, tempfile, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from access_760_fixture import make
c, sock = make()
def fingerprint():
    tabs = [r[0] for r in c.run("select format('%I.%I', schemaname, tablename) from pg_tables where schemaname in ('public','auth') order by 1")]
    h = hashlib.sha256()
    for t in tabs: h.update((t + str(c.run(f"select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]')::text from {t} x"))).encode())
    h.update(str(c.run("select policyname, qual from pg_policies order by 1")).encode())
    h.update(str(c.run("select proname, prosrc from pg_proc where pronamespace = 'public'::regnamespace order by 1, 2")).encode())
    return h.hexdigest()
before = fingerprint()
pages = tempfile.mkdtemp(prefix="pages760-")
os.makedirs(os.path.join(pages, "tests"))
open(os.path.join(pages, "index.html"), "w").write("x\n  const OWNERS=['samantha@mo-care.com','zach@mo-care.com'];\nconst DISC_APPROVERS=['samantha@mo-care.com','zach@mo-care.com'];\n  return ['samantha@mo-care.com','krystal@mo-care.com']\n")
open(os.path.join(pages, "tests", "t.js"), "w").write("const X=['test@mo-care.com'];\n")
rep = tempfile.mktemp()
p = subprocess.run([sys.executable, os.path.join(HERE, "access_report_760.py")], capture_output=True, text=True,
                   env=dict(os.environ, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_PAGES="cc-hub=" + pages))
out = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
print(out); print(p.stderr[-2000:])
after = fingerprint()
res = []
def ck(n, cond): res.append((n, bool(cond)))
ck("finished cleanly", p.returncode == 0 and "STOPPED" not in out)
ck("changed nothing (tables, rules, functions identical)", before == after)
ck("lists Krystal with her role and a BLANK list", "Krystal Example <krystal@mo-care.com>" in out and "role: care_coordinator · hubs: BLANK (today that means every hub)" in out)
ck("lists a login with no staff record", "(no staff record linked) <rn@example.invalid>" in out and "hubs: rn_review" in out)
ck("owner opens leads + owner money", "Samantha Example: opens 8 of 9 keys" in out)
ck("blank-list coordinator opens everything except owner money",
   "Krystal Example: opens 7 of 9 keys" in out and "cannot open: budget_lines, finance_snapshots" in out)
ck("staffing-only login cannot open leads", "Angiel Example: opens 2 of 9 keys" in out)
seg3 = out.split("3 · WHAT A NEW LOGIN")[1].split("4 ·")[0]
ck("a new blank-list login opens leads, assessments, medicaid plans",
   "BLANK hub list: opens 7 of 9 keys" in seg3 and seg3.count("leads: YES · care_assessments: YES · medicaid_plans: YES") == 2)
ck("a visitor opens nothing", "not signed in: opens 0 of 9 keys" in seg3)
ck("identity tables read in full by any login", "phone_index: 2 rows · new login, blank list: every row · Care Coordinator only: every row · not signed in: refused" in out)
ck("all five identity tables reported", all(f"    {t}:" in out for t in ("person_identity", "person_source_id", "person_role", "person_relationship", "phone_index")))
ck("wide-open table and owner view found", "open_notes (table, row rules OFF): every row" in out and "identity_completeness (view): every row" in out)
ck("closed table not listed", "closed_notes" not in out)
ck("blank-is-all functions listed", "can_access_data_key(k text)" in out and "desk_hub_ok()" in out)
ck("identity reader function listed", "identify_caller(p_phone text) · runs as owner, ignores row rules · callable by any signed-in login" in out)
ck("page email lists found, tests skipped", "index.html:2  OWNERS: samantha@mo-care.com, zach@mo-care.com" in out
   and "index.html:3  DISC_APPROVERS" in out and "index.html:4  returned list: samantha@mo-care.com, krystal@mo-care.com" in out and "test@mo-care.com" not in out)
ck("live rule text copied", "CREATE OR REPLACE FUNCTION public.can_access_data_key" in out and "app_data.app_data_owner_keys_sel · RESTRICTIVE" in out)
ck("no record content or phone printed", "SECRET" not in out and "5550100" not in out)
g = subprocess.run([sys.executable, "-c", "import os,sys;os.environ['SB_REPORT']='/dev/null';exec(open(%r).read().split('day = lambda')[0]);_guard('update public.app_data set data=null')" % os.path.join(HERE, "access_report_760.py")], capture_output=True, text=True)
ck("refuses a write if one is ever added", g.returncode != 0 and "refuses" in g.stderr)
for n, ok in res: print(("PASS " if ok else "FAIL ") + n)
print(f"{sum(ok for _, ok in res)}/{len(res)}")
sys.exit(0 if all(ok for _, ok in res) else 1)
