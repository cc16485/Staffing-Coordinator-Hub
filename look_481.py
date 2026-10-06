#!/usr/bin/env python3
# Desktop 481 · READ ONLY · Samantha 2026-10-06: "ed andrews was added into axiscare and is not showing up in clients list or
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
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-481/1.0"})
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
hit = lambda *vals: any(WHO in str(v or "").lower() for v in vals)
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
say("481 · WHERE IS ED IN THE HUB? (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ no Supabase access token. Nothing was read."); done(2)
def rows(q):
    r = sql(q); return r if isinstance(r, list) else []
NAME = "(lower(%s) like '%%ander%%' or lower(%s) like '%%andrew%%')"
say("A · THE JOBS THAT BRING NEW AXISCARE CLIENTS IN")
jobs = rows("select jobname, schedule, active from cron.job where jobname ilike '%status%' or jobname ilike '%admission%' or jobname ilike '%client%' order by jobname")
if not jobs: say("  · no scheduled job found for the status watcher or the admission scan")
for j in jobs:
    last = rows(f"select status, start_time from cron.job_run_details d join cron.job c on c.jobid = d.jobid where c.jobname = '{j['jobname']}' order by start_time desc limit 1")
    say(f"  · {j['jobname']} · {j['schedule']} · " + ("on" if j['active'] else "OFF") + (f" · last ran {str(last[0]['start_time'])[:16]} ({last[0]['status']})" if last else " · no run recorded"))
lg = rows("select data from public.app_data where key = 'client_status_log'")
lst = lg[0]["data"] if lg else []
if isinstance(lst, str): lst = json.loads(lst)
lst = lst if isinstance(lst, list) else []
latest = next((x for x in lst if isinstance(x, dict) and x.get("id") == "latest"), None)
trs = [x for x in lst if isinstance(x, dict) and x.get("observed_at")]
say(f"  · the watcher knows {len((latest or {}).get('map') or {})} AxisCare clients; last change it saw: " + (max(x['observed_at'] for x in trs)[:16] if trs else "none recorded"))
active = sorted(k for k, v in ((latest or {}).get("map") or {}).items() if str(v).lower() == "active")
say(f"  · active in AxisCare (as the watcher last saw): {len(active)}")
say()
say("B · ADMISSION CARDS (a new active AxisCare client the Hub doesn't know yet)")
op = rows("select axiscare_client_id, axiscare_name, observed_label, opened_at, status from public.client_admission_case order by opened_at desc limit 200")
say(f"  · {sum(1 for x in op if x['status'] == 'open')} open, {len(op)} in all")
ed = [x for x in op if ('ander' in str(x.get('axiscare_name') or '').lower() or 'andrew' in str(x.get('axiscare_name') or '').lower())]
for x in ed: say(f"  · ED? {x['axiscare_name']} · AxisCare #{x['axiscare_client_id']} · {x['status']} · seen as {x['observed_label']} · opened {str(x['opened_at'])[:16]}")
if not ed: say("  · no admission card with Anderson or Andrews in the name")
for x in [y for y in op if y['status'] == 'open'][:10]: say(f"    open: {x['axiscare_name']} · #{x['axiscare_client_id']} · opened {str(x['opened_at'])[:10]}")
say()
say("C · PEOPLE THE HUB KNOWS BY THAT NAME")
pp = rows("select p.id, p.display_name, r.status as role_status, s.source_id as ax from public.person_identity p left join public.person_role r on r.person_id = p.id and r.role = 'client' left join public.person_source_id s on s.person_id = p.id and s.system = 'axiscare' and s.entity_type = 'client' where " + NAME % ("p.display_name", "p.display_name"))
for x in pp: say(f"  · {x['display_name']} · client role: {x['role_status'] or 'none'} · AxisCare #{x['ax'] or 'not linked'}")
if not pp: say("  · nobody named Anderson or Andrews")
if any(x['ax'] and x['ax'] in (latest or {}).get('map', {}) for x in pp): say("  · (that AxisCare number is in the watcher's list as: " + ", ".join(str((latest or {}).get('map', {}).get(x['ax'])) for x in pp if x['ax']) + ")")
say()
say("D · THE LIVE SCHEDULE shows VISITS only: a client with no visits scheduled in AxisCare yet won't appear there.")
say("  Check: in the Hub, open Ed's project card and tap Find in AxisCare. It looks him up live and says current or former.")
say(); say("Nothing was changed, texted or emailed.")
done(0)
