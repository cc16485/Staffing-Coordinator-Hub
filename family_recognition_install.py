# I3 · RECOGNISING FAMILY · see it in the Family Circle (Desktop 325). Adds the read the Hub uses to show, next to each
# member, whether their calls are recognised or why not; and records where family numbers came from (kept 'probable':
# recognising is never permission to text). Part 1 (read only): the script is the reviewed build; I2 is there.
# Also corrects I1/I2: replying STOP to texts stops texts, not recognition.
# Part 2: family-recognition.sql (one transaction, self-checked). Part 3: read back, counts only.
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-i3/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return False, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
say("I3 · RECOGNISING FAMILY · SEE IT IN THE FAMILY CIRCLE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
got = hashlib.sha256(open(SQL, "rb").read()).hexdigest()
say(("  ✓ " if got == SQL_SHA else "  ✗ ") + "the change is the reviewed script")
if got != SQL_SHA: say("  STOP. Nothing was run."); done(2)
FAMNUM = """select coalesce(p.source_system, 'not recorded') as src, p.confidence as conf, count(*) as n from public.phone_index p
  join public.person_source_id s on s.person_id = p.person_id and s.system = 'hub' and s.entity_type = 'contact' group by 1, 2 order by 1, 2"""
ok, r = sql("""select to_regprocedure('public.person_link_family_all()') is not null as wired,
  to_regprocedure('public.family_recognition()') is not null as present""")
if not ok or not r: say("  ✗ could not read the database. Nothing was changed."); done(4)
r = r[0]
if not r["wired"]: say("  ✗ the Family Circle wiring (I2) is not installed. Nothing was changed."); done(4)
say("  ✓ the Family Circle wiring is there · this step is " + ("already installed (an earlier run)" if r["present"] else "not installed yet"))
ok, f = sql(FAMNUM)
say("  · family numbers before: " + (", ".join(f"{x['n']} from {x['src']} ({x['conf']})" for x in f) if ok and f else "none"))
say(); say("PART 2 · CHANGE")
if not r["present"]:
    ok, out = sql(open(SQL).read())
    say(("  ✓ " if ok else "  ✗ ") + "installed (one transaction, self-checked)" + ("" if ok else ": " + str(out)[:240]))
    if not ok: say("  STOP. Nothing changed (the install undid itself)."); done(5)
else: say("  · nothing to install")
say(); say("PART 3 · CHECK (read back)")
ok, g = sql("""select to_regprocedure('public.family_recognition()') is not null and to_regprocedure('public.family_recognition_all()') is not null as fns,
  has_function_privilege('authenticated','public.family_recognition()','execute') as staff,
  not has_function_privilege('anon','public.family_recognition()','execute') and not has_function_privilege('authenticated','public.family_recognition_all()','execute') as out""")
g = g[0] if ok and g else {}
good = g.get("fns") is True and g.get("staff") is True and g.get("out") is True
say(("  ✓ " if good else "  ✗ ") + "the Hub can ask (signed-in staff who see leads only); outside visitors cannot")
ok, f = sql(FAMNUM)
allp = ok and bool(f) and all(x["src"] != "not recorded" and x["conf"] == "probable" for x in f)
say(("  ✓ " if allp else "  ✗ ") + "family numbers now: " + (", ".join(f"{x['n']} from {x['src']} ({x['conf']})" for x in f) if ok and f else "none") + " · none is treated as safe to text")
good = good and allp
ok, st = sql("select outcome, count(*) as n from public.identity_door_audit where workflow = 'correction: STOP is not leaving' group by 1 order by 1")
say("  ✓ people who had replied STOP to texts, now recognised on calls (still never texted): " + (", ".join(f"{x['outcome']} {x['n']}" for x in st) if ok and st else "none needed"))
ok, c = sql("select state, count(*) as n from public.family_recognition_all() group by 1 order by 2 desc")
WORD = {"recognised": "calls recognised", "home_line": "on the client's home line", "shared": "shared number", "no_number": "no number",
        "clash": "a clash for you to decide", "not_recognised": "not recognised (a reason is shown)", "left": "no longer in the circle", "not_checked": "not checked yet"}
if ok and c: say("  ✓ what the Family Circle will show: " + ", ".join(f"{WORD.get(x['state'], x['state'])} {x['n']}" for x in c))
else: say("  ✗ the list did not come back"); good = False
say()
say("RESULT: " + ("INSTALLED · once the Hub update is merged, each Family Circle member shows whether their calls are recognised." if good else "CHECK THE ✗ LINES."))
say("No name, number or relationship was printed. Rollback if ever needed: family-recognition-rollback.sql.")
done(0 if good else 7)
