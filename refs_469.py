#!/usr/bin/env python3
# 469 · CLOSE THE OLD REFERENCE CARDS. Samantha 2026-10-06 after 468: "close the reference cards too".
# 468 left 18 items more than a week past due open because the Hub might reopen them. The reference cards among them come
# from reference-chase ("No email for this reference" / "Reference has not replied", id ops_ref_<request>, kind request):
# that job makes one per reference and never reopens one that exists (it checks source_id), so closing them sticks.
# They close into 468's Fresh start batch, so ONE Undo (Hub settings > Fresh start > Undo, 7 days) reopens 468 and 469.
# Left open: "more reference(s) needed" cards (kind reference, from references-run, which rewrites them while the
# candidate still needs references) and anything else the Hub reopens by itself; the report lists what is left.
# Nothing is texted or emailed. No phone number or email is printed.
import json, os, re, urllib.request, urllib.error, datetime as dt, sys, collections
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
BY, BY_NAME = "samantha@mo-care.com", "Samantha Troutman"
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
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-469/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return False, e.read().decode(errors="replace")[:300]
    except Exception as e: return False, type(e).__name__
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
def t(x):
    if not x: return None
    v = str(x).strip().replace("Z", "+00:00")
    for c in (v, v[:19], v[:10] + "T12:00:00"):
        try: d = dt.datetime.fromisoformat(c); return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
        except Exception: pass
    return None
def as_list(x):
    if isinstance(x, str):
        try: x = json.loads(x)
        except Exception: return []
    if isinstance(x, dict): x = list(x.values())
    return [i for i in (x or []) if isinstance(i, dict)]
def as_obj(x):
    if isinstance(x, str):
        try: x = json.loads(x)
        except Exception: return {}
    return x if isinstance(x, dict) else {}

say("469 · CLOSE THE OLD REFERENCE CARDS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
ok, r = sql("select data from public.app_data where key = 'ops_items'")
if not ok or not r: bad("couldn't read Needs Attention. Nothing was changed."); done(3)
items = as_list(r[0]["data"])
ok, r = sql("select data->'fresh_start_last' as last from public.app_data where key = 'ops_settings'")
last = as_obj(r[0]["last"]) if ok and r else {}
now = dt.datetime.now(dt.timezone.utc); at = now.isoformat().replace("+00:00", "Z")
same = bool(last.get("id", "").startswith("fs_468_") and not last.get("undone_at") and t(last.get("at")) and (now - t(last.get("at"))).total_seconds() < 7 * 86400)
batch = last["id"] if same else "fs_469_" + now.strftime("%Y%m%d%H%M")
say(f"  · " + ("they join 468's Fresh start batch, so one Undo covers both" if same else "468's batch isn't the latest Fresh start any more, so these get their own batch (Undo reopens just these)"))
late = lambda i: (lambda d: d is not None and (now - d).total_seconds() > 7 * 86400)(t(i.get("due")))
op = [i for i in items if i.get("status") == "open"]
close = [i for i in op if late(i) and str(i.get("id", "")).startswith("ops_ref_") and i.get("kind") == "request" and str(i.get("source_id", "")).startswith("ref_")]
rest = [i for i in op if late(i) and i not in close]
say(f"  · reference cards more than a week past due, to close: {len(close)}" + (" (" + ", ".join(f"{n} {k}" for k, n in collections.Counter('no email' if 'No email' in str(i.get('title')) else 'no reply' if 'not replied' in str(i.get('title')) else 'other' for i in close).items()) + ")" if close else ""))
say(f"  · other items more than a week past due that stay open: {len(rest)}")
for i in rest: say(f"      [{i.get('kind')}] {str(i.get('title') or i.get('about') or '')[:90]}")

say(); say("PART 2 · CHANGE")
if close:
    patches = {str(i["id"]): {"set": {"status": "done", "closed_at": at, "closed_by": BY, "resolution_code": "fresh_start", "fresh_start": batch,
               "close_note": "Fresh start " + at[:10] + ": old reference card, more than a week past due, cleared without action", "last_activity_at": at},
               "hist": [{"at": at, "by": BY_NAME + " (Desktop 469)", "text": "Cleared in the fresh start (old reference card)"}]} for i in close}
    ok, r = sql(f"""with p as (select {lit(json.dumps(patches))}::jsonb as m),
      upd as (update public.app_data a set data = (
        select coalesce(jsonb_agg(case when (select m from p) ? (x->>'id') and x->>'status' = 'open'
                 then (x || ((select m from p)->(x->>'id')->'set')) || jsonb_build_object('history', coalesce(case when jsonb_typeof(x->'history') = 'array' then x->'history' end, '[]'::jsonb) || ((select m from p)->(x->>'id')->'hist'))
                 else x end order by o), '[]'::jsonb)
        from jsonb_array_elements(a.data) with ordinality e(x, o)), version = coalesce(a.version, 0) + 1
      where a.key = 'ops_items' and jsonb_typeof(a.data) = 'array' returning 1)
      select count(*)::int as n from upd""")
    if not ok or not r or r[0]["n"] != 1: bad("the clean-up didn't save: " + str(r)[:200]); say("  Nothing was changed."); done(7)
    ids = [str(i["id"]) for i in close]
    rec = dict(last, ids=list(last.get("ids") or []) + ids) if same else {"id": batch, "at": at, "by": BY, "by_name": BY_NAME, "ids": ids, "source": "Desktop 469"}
    ok, r = sql(f"""update public.app_data set data = jsonb_set(case when not {'true' if same else 'false'} and data ? 'fresh_start_last' then data || jsonb_build_object('fresh_start_prev', data->'fresh_start_last') else data end,
                    '{{fresh_start_last}}', {lit(json.dumps(rec))}::jsonb) where key = 'ops_settings' and jsonb_typeof(data) = 'object' returning key""")
    chk(ok and r, "recorded for Hub settings > Fresh start > Undo")
    say(f"  ✓ {len(close)} reference cards closed")
else: say("  · no old reference cards to close")

say(); say("PART 3 · READ BACK")
ok, r = sql("select data from public.app_data where key = 'ops_items'")
after = {str(i.get("id")): i for i in as_list(r[0]["data"])} if ok and r else {}
if close: chk(all(after.get(str(i["id"]), {}).get("status") == "done" and after[str(i["id"])].get("fresh_start") == batch for i in close), f"all {len(close)} read back closed")
ok, r = sql("select data->'fresh_start_last' as last from public.app_data where key = 'ops_settings'")
l2 = as_obj(r[0]["last"]) if ok and r else {}
if close: chk(l2.get("id") == batch and all(str(i["id"]) in (l2.get("ids") or []) for i in close), f"Undo is ready ({len(l2.get('ids') or [])} items in the batch, 7 days)")
left = [i for i in after.values() if i.get("status") == "open"]
say(f"  · open now: {len(left)} · with nobody on them: {sum(1 for i in left if not i.get('owner'))}")
say(); say("RESULT: " + ("DONE · the old reference cards are closed." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed. To reopen: Hub settings > Fresh start > Undo (7 days).")
done(0 if not fails else 8)
