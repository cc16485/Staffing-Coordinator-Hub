#!/usr/bin/env python3
# Desktop 475 · READ ONLY · Ed Anderson coming home: what the Hub knows today, so his project starts from what is true
# (Samantha 2026-10-06: "we need both 7 days per week", 9am-2pm and 4pm-9pm). Nothing is changed or sent. Shows the
# Team Builder plans for him (each day and shift: who, and what they said), his lead/client records, open work about him,
# and the caregivers on the roster whose skills say Hoyer lift or bed bound care. No phone numbers or emails are printed.
import json, os, re, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
WHO = os.environ.get("SB_WHO", "anderson")
lines = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    s = re.sub(r"\(?\b\d{3}\)?[ .\-]?\d{3}[ .\-]\d{4}\b", "(a number)", s); print(s, flush=True); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED: " + type(e).__name__ + ": " + str(e)[:200] + " (nothing was changed). Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-475/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read().decode())
    except Exception: return None
def key(k):
    r = sql(f"select data from public.app_data where key = '{k}'")
    d = r[0]["data"] if r else []
    if isinstance(d, str): d = json.loads(d)
    if isinstance(d, dict): d = list(d.values())
    return [x for x in (d or []) if isinstance(x, dict)]
hit = lambda *vals: any(WHO in str(v or "").lower() for v in vals)
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
say("475 · ED ANDERSON COMING HOME: WHAT THE HUB KNOWS TODAY (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ no Supabase access token. Nothing was read."); done(2)
plans = [p for p in key("staffing_plans") if hit(p.get("client"), p.get("client_name"))]
say(f"A · TEAM BUILDER PLANS FOR HIM: {len(plans)}")
for p in plans:
    say(f"  · plan {str(p.get('id'))[-8:]} · client: {p.get('client')} · created {str(p.get('created_at') or '')[:10]} · days: {', '.join(p.get('days') or [])}")
    for s in p.get("slots") or []:
        say(f"    {s.get('label') or s.get('k')} ({s.get('start')}-{s.get('end')}):")
        for d in DAYS:
            if d not in (p.get("days") or []): continue
            c = (p.get("cells") or {}).get(f"{d}|{s.get('k')}") or {}
            say(f"      {d.title()}: " + (f"{c.get('name')} · {c.get('status')}" + (f" (asked {str(c.get('at') or '')[:10]} by {c.get('by')})" if c.get('status') in ('asked', 'yes', 'no') else '') if c.get("name") else "NOBODY"))
    asks = p.get("asks") or []
    if asks: say(f"    texts sent from the board: {len(asks)} · " + "; ".join(f"{a.get('caregiver')} {str(a.get('sent_at'))[:10]}" for a in asks[-8:]))
say()
leads = [l for l in key("leads") if hit(l.get("first_name"), l.get("last_name"), l.get("client_name"))]
say(f"B · LEAD / CLIENT RECORDS: {len(leads)}")
for l in leads: say(f"  · {l.get('first_name')} {l.get('last_name')} · status {l.get('status')} · assessment {l.get('assessment_at') or '-'} · archived {bool(l.get('archived'))}")
r = sql("select count(*)::int as n from information_schema.tables where table_name = 'clients'")
say()
ops = [i for i in key("ops_items") if i.get("status") == "open" and hit(i.get("about"), i.get("title"))]
say(f"C · OPEN WORK ABOUT HIM: {len(ops)}")
for i in ops: say(f"  · [{i.get('kind')}] {str(i.get('title'))[:90]} · owner {str(i.get('owner_name') or i.get('owner') or 'nobody').split('@')[0]}")
cases = [c for c in key("coverage_cases") if c.get("status") == "open" and hit(c.get("client"))]
say(f"   open coverage cases for him: {len(cases)}")
say()
cgs = key("caregivers")
def skills(c):
    s = c.get("skills") or c.get("skill_tags") or []
    if isinstance(s, dict): s = [k for k, v in s.items() if v]
    return [str(x).lower() for x in s]
fit = [c for c in cgs if not c.get("terminated") and any(k in " ".join(skills(c)) for k in ("hoyer", "bed_bound", "bedbound", "transfer"))]
say(f"D · CAREGIVERS ON THE ROSTER WHOSE SKILLS SAY HOYER / BED BOUND / TRANSFERS: {len(fit)}")
for c in fit[:40]: say(f"  · {c.get('first')} {c.get('last')} · {', '.join(s for s in skills(c) if any(k in s for k in ('hoyer', 'bed', 'transfer')))}")
say(); say("Nothing was changed, texted or emailed.")
done(0)
