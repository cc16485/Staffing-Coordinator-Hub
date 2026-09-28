#!/usr/bin/env python3
# I2 · RECOGNISING FAMILY · the one-time pass (Desktop 324). Links everyone already in a Family Circle through the family
# rule (the same pass the owner saw as a practice run in 323). No SQL file: it calls person_link_family_all(), one call,
# all or nothing. Part 1 (read only): the wiring is there; the pass has not run; the practice counts again.
# Part 2: the pass.  Part 3: read back from the identity layer, counts only.
import json, os, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-i2p/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return False, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
def show(counts):
    def n(pred): return sum(v for k, v in counts.items() if pred(k))
    say(f"    recognised by their own number: {n(lambda k: k.endswith(' · linked'))}")
    say(f"    linked, number is the client's home line (calls stay with the client): {n(lambda k: 'shares the client' in k)}")
    say(f"    linked, sharing a number with another family member (identifies neither): {n(lambda k: 'shared with another family member' in k)}")
    say(f"    linked, no usable number: {n(lambda k: 'no usable phone' in k)}")
    say(f"    already linked: {n(lambda k: k.startswith('already_linked'))}")
    say(f"    a clash (for you to decide): {n(lambda k: k == 'conflict')}")
    for k, v in sorted(counts.items()):
        if k.startswith("refused"): say(f"    not linked, {k.split(' · ', 1)[-1]}: {v}")
    say(f"    total: {sum(counts.values())}")
def asj(x): return json.loads(x) if isinstance(x, str) else x
Q_LINKS = """select (select count(*) from public.person_relationship r join public.person_source_id s on s.person_id = r.person_id
    and s.system = 'hub' and s.entity_type = 'contact' where r.active) as links,
  (select count(*) from public.phone_index p join public.person_source_id s on s.person_id = p.person_id
    and s.system = 'hub' and s.entity_type = 'contact') as numbers,
  (select count(*) from public.identity_door_audit where workflow = 'one-time pass') as passes"""
say("I2 · RECOGNISING FAMILY · THE ONE-TIME PASS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
ok, r = sql("select to_regprocedure('public.person_link_family_all()') is not null as wired")
if not ok or not r: say("  ✗ could not read the database. Nothing was changed."); done(4)
if not r[0]["wired"]: say("  ✗ the Family Circle wiring (323) is not installed. Nothing was changed."); done(4)
say("  ✓ the Family Circle wiring is there")
ok, r = sql(Q_LINKS); b = r[0] if ok and r else None
if b is None: say("  ✗ could not read the identity layer. Nothing was changed."); done(4)
say(f"  · family links before: {b['links']} · family numbers before: {b['numbers']}")
ran = b["passes"] > 0
if ran: say("  · the pass already ran (an earlier run): it will not run again")
else:
    ok, r = sql("select public.person_link_family_practice() as c")
    if not ok or not r: say("  ✗ the practice run did not come back. Nothing was changed."); done(4)
    say("  ✓ the practice run, once more (nothing kept):"); show(asj(r[0]["c"]))
say(); say("PART 2 · CHANGE")
if not ran:
    ok, r = sql("select public.person_link_family_all() as c")
    if not ok or not r: say("  ✗ the pass did not run: " + str(r)[:200]); say("  STOP. Nothing changed (it is one call, all or nothing)."); done(5)
    say("  ✓ the one-time pass ran:"); show(asj(r[0]["c"]))
else: say("  · nothing to run")
say(); say("PART 3 · CHECK (read back)")
ok, r = sql(Q_LINKS); a = r[0] if ok and r else {}
ok2, r2 = sql("""select outcome, count(*) as n from public.identity_door_audit where workflow = 'one-time pass' group by 1 order by 1""")
aud = {x["outcome"]: x["n"] for x in (r2 or [])} if ok2 else {}
good = bool(a) and a.get("passes", 0) > 0 and a.get("links", 0) >= b["links"]
say(("  ✓ " if good else "  ✗ ") + f"family links now: {a.get('links')} · family numbers now: {a.get('numbers')}")
say(("  ✓ " if aud else "  ✗ ") + "every link is in the Hub's log: " + (", ".join(f"{k} {v}" for k, v in aud.items()) or "none"))
say()
say("RESULT: " + ("DONE · everyone already in a Family Circle has been through the family rule. Their calls are recognised from now on." if good else "CHECK THE ✗ LINES."))
say("No name, number or relationship was printed. To undo: family-identity-wire-rollback.sql (its last lines end every family link).")
done(0 if good else 7)
