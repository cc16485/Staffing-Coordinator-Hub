#!/usr/bin/env python3
# 471 · OLD "ASSESSMENT SCHEDULED" LEADS ARE SPAM. Samantha 2026-10-06, seeing them on My Work: "clear all past, those were
# spam". Every lead still marked Assessment Scheduled (not archived, not already spam) whose assessment date has passed or
# was never saved gets the Hub's own Mark as spam, exactly as the lead profile does it (lpMarkSpam): status Lost, reason
# "Spam (not a real inquiry)", archived, do not contact, and what it was before kept in lead.spam.before, so the profile's
# "Not spam" puts it back exactly as it was for 7 days. Upcoming assessments are left alone.
# Part 1 (read only): who would be marked, who stays. Part 2: one statement on the leads list (only leads still in that
# state at that moment). Part 3: read back. Nothing is texted or emailed; nobody is contacted.
import json, os, re, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
BY = "samantha@mo-care.com"; REASON = "Spam (not a real inquiry)"
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    s = re.sub(r"\(?\b\d{3}\)?[ .\-]?\d{3}[ .\-]\d{4}\b", "(a number)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200] + ". Nothing was texted. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-471/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return False, e.read().decode(errors="replace")[:300]
    except Exception as e: return False, type(e).__name__
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
def as_list(x):
    if isinstance(x, str):
        try: x = json.loads(x)
        except Exception: return []
    if isinstance(x, dict): x = list(x.values())
    return [i for i in (x or []) if isinstance(i, dict)]
def day_of(x):   # the Hub's btChi, date part only: '2026-10-08', '2026-10-08T14:00', 'Thursday, October 8, 2026 2:00 PM'
    s = str(x or "").strip()
    if not s: return None
    m = re.match(r"^(\d{4}-\d\d-\d\d)", s)
    if m: return m.group(1)
    m = re.search(r"([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})", s)
    if m:
        mi = next((i for i, n in enumerate(MONTHS) if m.group(1).lower().startswith(n)), -1)
        if mi >= 0: return f"{m.group(3)}-{mi + 1:02d}-{int(m.group(2)):02d}"
    return None
name = lambda l: " ".join(x for x in [str(l.get("first_name") or "").strip(), str(l.get("last_name") or "").strip()] if x) or "(no name)"
is_spam = lambda l: isinstance(l.get("spam"), dict) and l["spam"].get("at")

say("471 · OLD \"ASSESSMENT SCHEDULED\" LEADS MARKED AS SPAM"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
ok, r = sql("select data from public.app_data where key = 'leads'")
if not ok or not r: bad("couldn't read the leads. Nothing was changed."); done(3)
leads = as_list(r[0]["data"])
today = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5)).strftime("%Y-%m-%d")   # Central daylight time
sched = [l for l in leads if str(l.get("status") or "") == "Assessment Scheduled" and not l.get("archived") and not is_spam(l)]
mark = [l for l in sched if not day_of(l.get("assessment_at")) or day_of(l.get("assessment_at")) < today]
stay = [l for l in sched if l not in mark]
say(f"  · {len(leads)} leads · {len(sched)} still say Assessment Scheduled")
say(f"  · to mark as spam (past date or no date): {len(mark)}")
for l in mark: say(f"      {name(l)} · assessment " + (str(l.get('assessment_at')) if l.get("assessment_at") else "no date saved"))
say(f"  · left alone (assessment still ahead): {len(stay)}" + ("" if not stay else ": " + ", ".join(f"{name(l)} ({day_of(l.get('assessment_at'))})" for l in stay)))

say(); say("PART 2 · CHANGE")
now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
if mark:
    keep = lambda l, k: l.get(k) if l.get(k) is not None else None
    patches = {}
    for l in mark:
        before = {"status": keep(l, "status"), "lost_reason": keep(l, "lost_reason"), "lost_at": keep(l, "lost_at"), "archived": bool(l.get("archived")),
                  "archived_at": keep(l, "archived_at"), "archived_by": keep(l, "archived_by"), "archive_reason": keep(l, "archive_reason"),
                  "do_not_contact": bool(l.get("do_not_contact")), "do_not_contact_at": keep(l, "do_not_contact_at"), "do_not_contact_reason": keep(l, "do_not_contact_reason")}
        patches[str(l["id"])] = {"spam": {"at": now, "by": BY, "note": "Old Assessment Scheduled lead, spam (Samantha, Desktop 471)", "before": before},
            "status": "Lost", "lost_reason": REASON, "lost_at": now, "archived": True, "archived_at": now, "archived_by": BY, "archive_reason": "Spam",
            "do_not_contact": True, "do_not_contact_at": now, "do_not_contact_reason": "Marked spam"}
    ok, r = sql(f"""with p as (select {lit(json.dumps(patches))}::jsonb as m),
      upd as (update public.app_data a set data = (
        select coalesce(jsonb_agg(case when (select m from p) ? (x->>'id') and x->>'status' = 'Assessment Scheduled' and not coalesce((x->>'archived')::boolean, false) and x->'spam' is null
                 then x || ((select m from p)->(x->>'id')) else x end order by o), '[]'::jsonb)
        from jsonb_array_elements(a.data) with ordinality e(x, o)), version = coalesce(a.version, 0) + 1
      where a.key = 'leads' and jsonb_typeof(a.data) = 'array' returning 1)
      select count(*)::int as n from upd""")
    if not ok or not r or r[0]["n"] != 1: bad("the change didn't save: " + str(r)[:200]); say("  Nothing was changed."); done(7)
    say(f"  ✓ {len(mark)} lead{'s' if len(mark) != 1 else ''} marked as spam")
else: say("  · nothing to mark")

say(); say("PART 3 · READ BACK")
ok, r = sql("select data from public.app_data where key = 'leads'")
after = {str(l.get("id")): l for l in as_list(r[0]["data"])} if ok and r else {}
if mark: chk(all(is_spam(after.get(str(l["id"]), {})) and after[str(l["id"])].get("status") == "Lost" and after[str(l["id"])].get("archived") is True for l in mark), f"all {len(mark)} read back as spam (Lost, archived, do not contact)")
if stay: chk(all(after.get(str(l["id"]), {}).get("status") == "Assessment Scheduled" for l in stay), "the upcoming ones are untouched")
say(f"  · still Assessment Scheduled now: {sum(1 for l in after.values() if str(l.get('status') or '') == 'Assessment Scheduled' and not l.get('archived'))}")
say(); say("RESULT: " + ("DONE · the old leads are spam: off every list and count, never contacted." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed. To put one back (7 days): open the lead and press Not spam.")
done(0 if not fails else 8)
