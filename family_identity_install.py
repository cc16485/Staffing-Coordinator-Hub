#!/usr/bin/env python3
# I1 · RECOGNISING FAMILY · install (Desktop 322). Installs the family rule in the identity door. Nothing calls it yet
# (I2 wires the Family Circle paths), so nobody is linked by this step.
# Part 1 (read only): the script is the reviewed build; the identity layer and the Family Circle tables are there.
# Part 2: family-identity.sql (one transaction, self-checked).  Part 3: read back: both functions exist, only our server
# can run them, the audit accepts the new operations, and nothing has been linked yet.
import json, os, hashlib, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
SQL = os.environ["SB_SQL"]; SQL_SHA = os.environ["SB_SQL_SHA"]
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Anything done above stays done.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    req = urllib.request.Request(API + f"/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-i1/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return False, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
F = "public.person_link_family_contact(text,text,text,text)"; E = "public.person_end_family_contact(text,text,text,text)"
say("I1 · RECOGNISING FAMILY · INSTALL THE RULE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
got = hashlib.sha256(open(SQL, "rb").read()).hexdigest()
say(("  ✓ " if got == SQL_SHA else "  ✗ ") + "the family rule is the reviewed script")
if got != SQL_SHA: say("  STOP. Nothing was run."); done(2)
ok, r = sql(f"""select to_regprocedure('{F}') is not null as present, to_regclass('public.identity_door_audit') is not null as audit,
  to_regclass('public.person_relationship') is not null and to_regclass('public.phone_index') is not null
  and to_regclass('public.circle_contacts') is not null and to_regclass('public.care_circles') is not null as tables""")
if not ok or not r: say("  ✗ could not read the database. Nothing was changed."); done(4)
r = r[0]
if not (r["audit"] and r["tables"]): say("  ✗ the identity layer or the Family Circle tables are missing. Nothing was changed."); done(4)
say("  ✓ the identity layer and the Family Circle tables are there · the rule is " + ("already installed (an earlier run)" if r["present"] else "not installed yet"))
say(); say("PART 2 · CHANGE")
if not r["present"]:
    ok, out = sql(open(SQL).read())
    say(("  ✓ " if ok else "  ✗ ") + "the family rule is installed (one transaction, self-checked)" + ("" if ok else ": " + str(out)[:240]))
    if not ok: say("  STOP. Nothing changed (the install undid itself)."); done(5)
else: say("  · nothing to install")
say(); say("PART 3 · CHECK (read back)")
ok, r = sql(f"""select to_regprocedure('{F}') is not null and to_regprocedure('{E}') is not null as fns,
  has_function_privilege('service_role','{F}','execute') and has_function_privilege('service_role','{E}','execute') as svc,
  not has_function_privilege('authenticated','{F}','execute') and not has_function_privilege('anon','{F}','execute')
  and not has_function_privilege('authenticated','{E}','execute') as browsers_out,
  exists (select 1 from pg_constraint where conname='identity_door_audit_op_check' and pg_get_constraintdef(oid) like '%link_family%') as audit,
  (select count(*) from public.identity_door_audit where op in ('link_family','end_family')) as linked""")
g = r[0] if ok and r else {}
good = g.get("fns") is True and g.get("svc") is True and g.get("browsers_out") is True and g.get("audit") is True
say(("  ✓ " if good else "  ✗ ") + "both functions exist, only our server can run them, and the audit accepts the new operations")
say(("  ✓ " if g.get("linked") == 0 else "  · ") + f"family linked so far: {g.get('linked')} (nothing is linked until I2)")
say()
say("RESULT: " + ("INSTALLED · the rule is in place. Nobody is linked yet; I2 connects the Family Circle to it." if good else "CHECK THE ✗ LINES."))
say("Rollback if ever needed: family-identity-rollback.sql (only while nothing has been linked).")
done(0 if good else 7)
