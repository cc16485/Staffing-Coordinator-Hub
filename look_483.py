#!/usr/bin/env python3
# Desktop 483 · READ ONLY · before moving real clients onto the client journey: every open start of care, every open
# First-shift launch, every waiting admission card and every client-start project or item, with what is already ticked.
# Nothing is changed or sent. Phone numbers and emails are never printed. (was: Desktop 481 · READ ONLY · Samantha 2026-10-06: "ed andrews was added into axiscare and is not showing up in clients list or
# in live schedule". Where a new AxisCare client is in the chain: the status watcher (every few hours) -> the admission scan
# (opens a card) -> a person confirms -> the client list. Was based on 475b · Ed Anderson coming home: what the Hub knows today, so his project starts from what is true
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
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-483/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        say(f"  ✗ the database refused a read ({e.code}: {e.read().decode()[:160]}). Nothing was changed."); done(3)
    except Exception as e:
        say(f"  ✗ could not reach the database ({type(e).__name__}: {str(e)[:160]}). Nothing was changed."); done(3)
def key(k):
    r = sql(f"select data from public.app_data where key = '{k}'")
    d = r[0]["data"] if r else []
    if isinstance(d, str): d = json.loads(d)
    if isinstance(d, dict): d = list(d.values())
    out = [x for x in (d or []) if isinstance(x, dict)]
    say(f"  (read {len(out)} records from {k})")
    return out

def rows(q):
    r = sql(q); return r if isinstance(r, list) else []
def blob(k):
    r = rows(f"select data from public.app_data where key = '{k}'")
    d = r[0]["data"] if r else None
    if isinstance(d, str): d = json.loads(d)
    return d
def lst(k):
    d = blob(k)
    if isinstance(d, dict): d = list(d.values())
    return [x for x in (d or []) if isinstance(x, dict)]
def payer(fs):
    s = str(fs or "").lower()
    if not s: return "not set"
    if re.search(r"cds|self.?direct", s): return "CDS"
    if re.search(r"medicaid|hcbs|ihs", s): return "Medicaid"
    if re.search(r"\bva\b|veteran", s): return "VA"
    if re.search(r"ltc|long.?term", s): return "LTC"
    if "private" in s: return "Private"
    return "Other"
who = lambda e: str(e or "").split("@")[0] or "nobody"
def nm(l):
    n = (str(l.get("client_first_name") or "") + " " + str(l.get("client_last_name") or "")).strip()
    return n or (str(l.get("first_name") or "") + " " + str(l.get("last_name") or "")).strip() or ("lead " + str(l.get("id")))
day = lambda s: str(s or "")[:10] or "?"
say("483 · BEFORE THE MOVE-OVER: WHAT WOULD MOVE ONTO THE CLIENT JOURNEY (read only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ no Supabase access token. Nothing was read."); done(2)

say("A · SWITCHES AND TIMED JOBS")
ops = blob("ops_settings") or {}
ops = ops if isinstance(ops, dict) else {}
for k in ("client_journey_live", "client_start_live"): say(f"  · {k}: " + ("ON" if ops.get(k) is True else "off"))
say("  · default Care Coordinator for new journeys: " + (who(ops.get("client_journey_default_cc")) if ops.get("client_journey_default_cc") else "not set (falls back to the lead's coordinator, then whoever opens it)"))
for j in rows("select jobname, schedule, active from cron.job where jobname in ('client-start-run','client-journey-sweep','launch-evidence','client-admission-scan') or jobname ilike '%admission%' order by jobname"):
    say(f"  · job {j['jobname']} · {j['schedule']} · " + ("on" if j['active'] else "OFF"))
say()

leads = [l for l in lst("leads") if not l.get("archived") and l.get("status") != "Lost"]
say(f"B · OPEN LEADS ({len(leads)} not archived and not Lost)")
withsoc = [l for l in leads if isinstance(l.get("soc"), dict) and not l["soc"].get("abandoned")]
nosoc = [l for l in leads if l not in withsoc]
say(f"  {len(withsoc)} have the old Start of Care checklist:")
for l in sorted(withsoc, key=lambda x: str(x["soc"].get("started_at") or "")):
    s = l["soc"]; st = [x for x in (s.get("steps") or []) if isinstance(x, dict)]
    dn = [x for x in st if x.get("done_at")]
    nxt = next((x.get("label") for x in st if not x.get("done_at")), "all ticked")
    stage = "launch done" if s.get("launch_completed_at") else "handed to First shift" if s.get("launch_upserted_at") else "ready for staffing" if s.get("ready_for_staffing_at") else "before staffing"
    say(f"  · {nm(l)} · {payer(l.get('funding_source'))} · path {s.get('pathway') or '?'} · {len(dn)}/{len(st)} ticked · {stage} · started {day(s.get('started_at'))}"
        + f" · AxisCare #{l.get('axiscare_client_id') or 'none'} · coordinator {who(l.get('assigned_coordinator'))} · status {l.get('status') or '?'}"
        + (" · TEST" if l.get("is_test") else ""))
    say(f"      next unticked: {str(nxt)[:110]}")
    for x in dn: say(f"      ✓ {str(x.get('label'))[:90]} · {day(x.get('done_at'))} by {who(x.get('done_by'))}")
say()
pre = [l for l in nosoc if l.get("status") != "Converted"]
say(f"  {len(pre)} open leads have NO checklist yet (still being worked as leads):")
cnt = {}
for l in pre: cnt[l.get("status") or "?"] = cnt.get(l.get("status") or "?", 0) + 1
say("    by status: " + ", ".join(f"{k} {v}" for k, v in sorted(cnt.items(), key=lambda kv: -kv[1])))
pc = {}
for l in pre: pc[payer(l.get("funding_source"))] = pc.get(payer(l.get("funding_source")), 0) + 1
say("    by payer: " + ", ".join(f"{k} {v}" for k, v in sorted(pc.items(), key=lambda kv: -kv[1])))
for l in sorted(pre, key=lambda x: str(x.get("created_at") or x.get("added_at") or ""), reverse=True)[:40]:
    say(f"    · {nm(l)} · {l.get('status') or '?'} · {payer(l.get('funding_source'))} · added {day(l.get('created_at') or l.get('added_at'))} · coordinator {who(l.get('assigned_coordinator'))}" + (" · AxisCare #" + str(l.get('axiscare_client_id')) if l.get('axiscare_client_id') else "") + (" · TEST" if l.get("is_test") else ""))
if len(pre) > 40: say(f"    … and {len(pre) - 40} older")
say(f"  {sum(1 for l in nosoc if l.get('status') == 'Converted')} converted leads without a checklist (already clients, not moved)")
say()

say("C · FIRST SHIFT LAUNCHES STILL OPEN (client_queue, not complete)")
F = ["caregiver_assigned","caregiver_called","client_called","schedule_added","evv_verified","first_shift_done","followup_client_done","followup_caregiver_done","dsds_notified"]
cols = {r["column_name"] for r in rows("select column_name from information_schema.columns where table_schema='public' and table_name='client_queue'")}
have = [f for f in F if f in cols]
q = rows("select id, client_name, axiscare_client_id, status, " + ", ".join(c for c in ("episode_n","source","added_at","created_at","caregiver_assigned_name") if c in cols) + (", " if have else "") + ", ".join(have) + " from public.client_queue where coalesce(status,'') <> 'complete' order by 1")
byax = {str(l.get("axiscare_client_id") or "").strip(): l for l in leads if str(l.get("axiscare_client_id") or "").strip()}
say(f"  {len(q)} open")
for c in q:
    tk = [f for f in have if c.get(f)]
    l = byax.get(str(c.get("axiscare_client_id") or "").strip())
    say(f"  · {c.get('client_name')} · AxisCare #{c.get('axiscare_client_id') or 'none'} · episode {c.get('episode_n') or 1} · from {c.get('source') or '?'} · opened {day(c.get('added_at') or c.get('created_at'))}"
        + f" · {len(tk)}/{len(have)} ticked" + (f" · caregiver {c.get('caregiver_assigned_name')}" if c.get('caregiver_assigned_name') else "")
        + (f" · lead: {nm(l)} ({'checklist' if l.get('soc') else 'no checklist'})" if l else " · no lead with that AxisCare number"))
    if tk: say("      ticked: " + ", ".join(tk))
say()

say("D · ADMISSION CARDS WAITING (new active AxisCare client the Hub doesn't know yet)")
ad = rows("select axiscare_client_id, axiscare_name, opened_at from public.client_admission_case where status = 'open' order by opened_at")
for x in ad: say(f"  · {x['axiscare_name']} · AxisCare #{x['axiscare_client_id']} · waiting since {day(x['opened_at'])}")
if not ad: say("  · none")
say()

say("E · OPEN WORK THAT THE JOURNEY WOULD REPLACE (My Work items)")
items = [i for i in lst("ops_items") if str(i.get("status") or "open") not in ("done","closed","cancelled","canceled","dismissed")]
cs = [i for i in items if i.get("kind") == "client_start" or str(i.get("id","")).startswith("cstart_")]
pj = [i for i in items if i.get("kind") == "project" and i.get("template") in ("client_start","care_team")]
jr = [i for i in items if i.get("kind") == "journey"]
say(f"  · {len(cs)} 'start is stuck' items (client-start-run)")
for i in cs: say(f"      {str(i.get('title'))[:100]} · owner {who(i.get('owner') or i.get('assignee'))} · opened {day(i.get('created_at') or i.get('opened_at'))}")
say(f"  · {len(pj)} projects from the client-start / care-team templates")
for i in pj:
    st = [s for s in (i.get("steps") or []) if isinstance(s, dict)]
    say(f"      {str(i.get('title'))[:100]} · {i.get('template')} · {sum(1 for s in st if s.get('done') or s.get('done_at'))}/{len(st)} steps done")
say(f"  · {len(jr)} client journey cards already on My Work")
say()

say("F · CLIENT JOURNEYS THAT EXIST TODAY")
for j in rows("select client_name, payer, is_test, status, created_at from public.client_journey order by created_at"):
    say(f"  · {j['client_name']} · {j['payer']} · {'TEST' if j['is_test'] else 'REAL'} · {j['status']} · {day(j['created_at'])}")
say(); say("Nothing was changed, texted or emailed.")
done(0)
