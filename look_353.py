#!/usr/bin/env python3
# Desktop 353 · READ ONLY · why 352's practice applications came back with no grade. Nothing is changed or sent.
# The report holds counts and dates only: no name, email, number or note.
# It also saves the live screening code (function and trigger definitions: code, no applicant data) to
# ~/Claude/screen-live-copy.sql, so any fix is written on top of what is really running rather than the old files.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
KEEP = os.environ.get("SB_KEEP_FILE", os.path.expanduser("~/Claude/screen-live-copy.sql"))
OLD = os.environ.get("SB_OLD_DIR", os.path.expanduser("~/Claude"))
lines = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-353/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q})
    if s not in (200, 201): return None
    try: return json.loads(b)
    except Exception: return None
def old_body(fname, fn):
    """The function body as the old file wrote it (what Postgres keeps as its source), or None."""
    try: t = open(os.path.join(OLD, fname)).read()
    except Exception: return None
    m = re.search(r"create or replace function public\." + fn + r"\([\s\S]*?as \$\$([\s\S]*?)\$\$;", t)
    return m.group(1) if m else None
md5 = lambda s: hashlib.md5(s.encode()).hexdigest()

say("353 · WHY APPLICATIONS AREN'T GRADED (READ ONLY)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
trg = sql("""select tgname, tgenabled::text as enabled, pg_get_triggerdef(t.oid) as def from pg_trigger t
             where tgrelid = 'public.job_applicants'::regclass and not tgisinternal order by tgname""")
fns = sql("""select p.proname, pg_get_functiondef(p.oid) as def, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('applicant_screen','applicant_screen_trigger','apply_save','applicant_screen_prn','applicant_screen_prn_trigger','applicant_prn_pay_guard')
             order by p.proname""")
if trg is None or fns is None: say("  ✗ could not read the database. Nothing was changed."); done(4)
say("A · WHAT RUNS WHEN AN APPLICATION IS SAVED")
for t in trg:
    when = re.search(r"WHEN \((.*?)\)\s+EXECUTE", t["def"])
    say(f"  · trigger {t['tgname']}: {'on' if t['enabled'] != 'D' else 'OFF'}" + (f" · only when {when.group(1)}" if when else " · always"))
depth1 = [t["tgname"] for t in trg if "pg_trigger_depth() = 1" in t["def"]]
if depth1:
    say(f"  ! {', '.join(depth1)} runs only when called from inside another trigger (pg_trigger_depth() = 1). An application saved by")
    say("    the apply page is not inside a trigger, so this condition is never true there: the screen never runs on its own.")
old = {"applicant_screen": old_body("recruit-screening.sql", "applicant_screen"), "applicant_screen_trigger": old_body("recruit-screening.sql", "applicant_screen_trigger"),
       "apply_save": old_body("recruit-profile.sql", "apply_save")}
for f in fns:
    o = old.get(f["proname"])
    if o is not None:
        say(f"  · {f['proname']}: live is {'the same as' if md5(f['prosrc']) == md5(o) else 'DIFFERENT from'} the old file on this Mac")
calls = sql("select count(*)::int as n from cron.job where command ilike '%applicant_screen%'")
say(f"  · scheduled jobs that run the screen: {calls[0]['n'] if calls else '?'}")

say(); say("B · APPLICATIONS BY MONTH (counts only)")
m = sql("""select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
             count(*)::int as all_apps,
             count(*) filter (where completed_at is not null)::int as finished,
             count(*) filter (where completed_at is not null and screen_grade is null)::int as finished_no_grade,
             count(*) filter (where screen_grade = 'qualified')::int as qualified,
             count(*) filter (where screen_grade = 'review')::int as review,
             count(*) filter (where screen_grade in ('declined','duplicate'))::int as declined_dup,
             count(*) filter (where to_jsonb(a)->>'office_alerted_at' is not null)::int as office_told
           from public.job_applicants a group by 1 order by 1""")
if m is None: say("  ✗ could not count applications")
if m:
    say("  month     all  finished  finished-no-grade  cleared  needs-a-look  declined/dup  office-texted")
    for r in m:
        say(f"  {r['month']}  {r['all_apps']:>4}  {r['finished']:>8}  {r['finished_no_grade']:>17}  {r['qualified']:>7}  {r['review']:>12}  {r['declined_dup']:>12}  {r['office_told']:>13}")
last = sql("""select max(created_at)::date::text as last_graded from public.job_applicants where screen_grade is not null and screen_grade <> 'declined';
""")
last_ng = sql("select min(created_at)::date::text as first_ungraded from public.job_applicants where completed_at is not null and screen_grade is null")
say(f"  · the last application that got a cleared/needs-a-look/duplicate grade was made on {(last or [{}])[0].get('last_graded') or 'never'}")
say(f"  · the first finished application with no grade was made on {(last_ng or [{}])[0].get('first_ungraded') or 'none'}")
al = sql("select count(*)::int as n from public.applicant_alerts where active")
say(f"  · office people set to be texted about good applicants: {al[0]['n'] if al else '?'}")

out = ["-- Live screening code, copied " + dt.datetime.now(dt.timezone.utc).isoformat() + " by Desktop 353 (read only). Code only, no applicant data.", ""]
for t in trg: out += [t["def"] + ";", ""]
for f in fns: out += [f["def"].rstrip() + ";", ""]
open(KEEP, "w").write("\n".join(out))
say(); say(f"The live code was saved to {KEEP} for Claude.")
say("RESULT: DONE · nothing was changed or sent.")
done(0)
