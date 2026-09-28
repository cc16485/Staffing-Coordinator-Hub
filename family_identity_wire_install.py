#!/usr/bin/env python3
# I2 · RECOGNISING FAMILY · keep it current (Desktop 323). From now on, joining or leaving a Family Circle keeps the
# identity layer in step. People already in circles are NOT linked by this step: it runs the one-time pass as a practice
# run (everything undone) and reports only the counts, for the owner to see before the real pass (Desktop 324).
# Part 1 (read only): the script is the reviewed build; the family rule (I1) is there.
# Part 2: family-identity-wire.sql (one transaction, self-checked).
# Part 3: read back (the wiring is there, only our server can run the pass) and the practice run's counts.
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-i2/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return False, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
say("I2 · RECOGNISING FAMILY · KEEP IT CURRENT"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
got = hashlib.sha256(open(SQL, "rb").read()).hexdigest()
say(("  ✓ " if got == SQL_SHA else "  ✗ ") + "the wiring is the reviewed script")
if got != SQL_SHA: say("  STOP. Nothing was run."); done(2)
ok, r = sql("""select to_regprocedure('public.person_link_family_contact(text,text,text,text)') is not null as rule,
  to_regprocedure('public.person_link_family_all()') is not null as present""")
if not ok or not r: say("  ✗ could not read the database. Nothing was changed."); done(4)
r = r[0]
if not r["rule"]: say("  ✗ the family rule (I1) is not installed. Nothing was changed."); done(4)
say("  ✓ the family rule is there · the wiring is " + ("already installed (an earlier run)" if r["present"] else "not installed yet"))
say(); say("PART 2 · CHANGE")
if not r["present"]:
    ok, out = sql(open(SQL).read())
    say(("  ✓ " if ok else "  ✗ ") + "the wiring is installed (one transaction, self-checked)" + ("" if ok else ": " + str(out)[:240]))
    if not ok: say("  STOP. Nothing changed (the install undid itself)."); done(5)
else: say("  · nothing to install")
say(); say("PART 3 · CHECK (read back)")
ok, r = sql("""select (select count(*) from pg_trigger where tgname in ('family_circle_member_sync','family_circle_sync') and not tgisinternal) as triggers,
  has_function_privilege('service_role','public.person_link_family_all()','execute') as svc,
  not has_function_privilege('authenticated','public.person_link_family_all()','execute') and not has_function_privilege('anon','public.person_link_family_all()','execute')
  and not has_function_privilege('authenticated','public.person_link_family_practice()','execute') as browsers_out,
  (select count(*) from public.identity_door_audit where op = 'link_family' and outcome = 'linked') as linked""")
g = r[0] if ok and r else {}
good = g.get("triggers") == 2 and g.get("svc") is True and g.get("browsers_out") is True
say(("  ✓ " if good else "  ✗ ") + "joining and leaving a Family Circle now keep the identity layer in step · only our server can run the pass")
say(f"  · linked so far (people added since the install): {g.get('linked')}")
say(); say("THE PRACTICE RUN · the one-time pass over everyone already in a circle, then undone (counts only)")
ok, r = sql("select public.person_link_family_practice() as c")
counts = None
if ok and r:
    counts = r[0]["c"]; counts = json.loads(counts) if isinstance(counts, str) else counts
if counts is None: say("  ✗ the practice run did not come back: " + str(r)[:200]); good = False
else:
    def n(pred): return sum(v for k, v in counts.items() if pred(k))
    say(f"  would be recognised by their own number: {n(lambda k: k.endswith(' · linked'))}")
    say(f"  would be linked, but their number is the client's home line (calls stay with the client): {n(lambda k: 'shares the client' in k)}")
    say(f"  would be linked, sharing a number with another family member (identifies neither): {n(lambda k: 'shared with another family member' in k)}")
    say(f"  would be linked, no usable number: {n(lambda k: 'no usable phone' in k)}")
    say(f"  already linked: {n(lambda k: k.startswith('already_linked'))}")
    say(f"  a clash (their number is someone else's, for you to decide): {n(lambda k: k == 'conflict')}")
    for k, v in sorted(counts.items()):
        if k.startswith("refused"): say(f"  not linked, {k.split(' · ', 1)[-1]}: {v}")
    say(f"  total: {sum(counts.values())}")
    ok2, r2 = sql("select (select count(*) from public.identity_door_audit where op = 'link_family' and outcome = 'linked') as linked")
    after = r2[0]["linked"] if ok2 and r2 else None
    say(("  ✓ " if after == g.get("linked") else "  ✗ ") + "the practice run left nothing behind")
    if after != g.get("linked"): good = False
say()
say("RESULT: " + ("INSTALLED · new joins and leaves are kept in step. Nobody already in a circle is linked yet: that is 324, after you've seen these counts." if good else "CHECK THE ✗ LINES."))
say("No name, number or relationship was printed. Rollback if ever needed: family-identity-wire-rollback.sql.")
done(0 if good else 7)
