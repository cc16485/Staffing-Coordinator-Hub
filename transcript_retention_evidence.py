#!/usr/bin/env python3
# Desktop 291 · READ ONLY · where call, assessment and interview transcripts and recordings live today, and what
# clean-up actually runs. Counts, dates and rule text only: no transcript, name or care detail is printed.
import json, os, re, sys, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); HUB = "zngsgedlsxinbygwmxwn"
lines = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
sys.excepthook = lambda t, e, tb: (say(f"✗ The check stopped unexpectedly ({t.__name__}: {str(e)[:160]}). Everything above is accurate; nothing was changed."), done(8))
def http(method, url, body=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers={"Content-Type": "application/json", "User-Agent": "cc-transcripts/1.0", "Authorization": "Bearer " + TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, str(e)
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, 180)
    if s not in (200, 201): raise RuntimeError(f"database answered {s}: {b[:160]}")
    return jl(b)
ARR = "jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end)"
Q_ASSESS = f"""select count(*) as assessments,
  count(*) filter (where coalesce(e->>'transcript_text', '') <> '') as with_text,
  count(*) filter (where coalesce(e->>'transcript_link', '') <> '') as with_link,
  count(*) filter (where coalesce(e->>'transcript_text', '') <> '' and e->>'status' = 'Pushed to AxisCare') as pushed_still_holding_text,
  min(coalesce(e->>'visit_date', e->>'created_at')) filter (where coalesce(e->>'transcript_text', '') <> '') as oldest_with_text
from public.app_data ad, {ARR} e where ad.key = 'care_assessments'"""
Q_CFG = "select coalesce((select data->>'auto_clear_transcript' from public.app_data where key = 'cc_hub_config'), '(not set)') as v"
Q_REC_EXISTS = "select to_regclass('public.recordings') is not null as t, to_regproc('public.recordings_due_for_purge') is not null as f, to_regclass('cron.job') is not null as c"
Q_REC = """select kind, count(*) as n,
  count(*) filter (where transcript is not null and transcript <> '') as with_transcript,
  count(*) filter (where storage_path is not null) as audio_kept,
  count(*) filter (where audio_purged_at is not null) as audio_purged,
  count(*) filter (where storage_path is not null and (transcript is null or status <> 'done')) as audio_kept_no_transcript,
  min(created_at) filter (where storage_path is not null)::date as oldest_audio,
  min(created_at)::date as oldest_row
from public.recordings group by kind order by kind"""
Q_PURGE_RULE = "select pg_get_functiondef('public.recordings_due_for_purge'::regproc) as def"
Q_CRON = "select jobname, schedule, active from cron.job where command ilike any (array['%purge-recordings%','%lead-docs-retention%','%retention%','%purge%']) order by jobname"
Q_LEADS = f"""select count(*) as leads,
  count(*) filter (where coalesce(e->>'call_transcript', '') <> '') as ai_call_transcripts,
  count(*) filter (where coalesce(e->'last_call_transcript'->>'text', '') <> '') as gohighlevel_call_transcripts,
  count(*) filter (where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e->'comm_log') = 'array' then e->'comm_log' else '[]'::jsonb end) c
                                 where c->>'by' = 'call summary')) as leads_with_call_summaries
from public.app_data ad, {ARR} e where ad.key = 'leads'"""
Q_FUPS = f"""with f as (select e from public.app_data ad, {ARR} e where ad.key = 'post_call_followups'),
 l as (select e->>'id' as id from public.app_data ad, {ARR} e where ad.key = 'leads')
select count(*) as drafts,
  count(*) filter (where coalesce(f.e->>'call_summary', '') <> '') as with_call_summary,
  count(*) filter (where f.e->>'status' = 'pending_approval' and not exists (select 1 from l where l.id = f.e->>'lead_id')) as pending_with_no_lead
from f"""

say("CALL TRANSCRIPTS AND RECORDINGS · READ ONLY EVIDENCE")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + " · counts, dates and rules only, nothing changed"); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was run."); done(1)

say("1. CALL TRANSCRIPTS ON LEADS")
l = sql(Q_LEADS)[0]
say(f"  leads: {l['leads']} · holding an AI call transcript: {l['ai_call_transcripts']} · holding a GoHighLevel call transcript: {l['gohighlevel_call_transcripts']}")
say(f"  leads whose notes hold a GoHighLevel call summary: {l['leads_with_call_summaries']}")
f = sql(Q_FUPS)[0]
say(f"  drafted follow-ups: {f['drafts']} · holding an AI call summary: {f['with_call_summary']} · waiting for approval with no lead behind them: {f['pending_with_no_lead']}")
say()
say("2. ASSESSMENT TRANSCRIPTS")
a = sql(Q_ASSESS)[0]
say(f"  assessments: {a['assessments']} · with pasted transcript text: {a['with_text']} · with a transcript link: {a['with_link']}")
say(f"    pushed to AxisCare but still holding the text: {a['pushed_still_holding_text']}" + (f" · oldest holding text: {str(a['oldest_with_text'])[:10]}" if a.get('oldest_with_text') else ""))
say(f"  'auto-clear the transcript text once the plan is pushed' (shared setting): {sql(Q_CFG)[0]['v']}")
say()
say("3. RECORDINGS (interviews, and assessments recorded in the Hub)")
ex = sql(Q_REC_EXISTS)[0]
if not ex["t"]: say("  the recordings table does not exist in this project")
else:
    rows = sql(Q_REC)
    if not rows: say("  no recordings")
    for r in rows:
        say(f"  {r['kind']}: {r['n']} (since {r['oldest_row']}) · transcript kept {r['with_transcript']} · audio still stored {r['audio_kept']} · audio deleted {r['audio_purged']}"
            + (f" · audio kept because transcription never finished {r['audio_kept_no_transcript']}" if int(r['audio_kept_no_transcript'] or 0) else "")
            + (f" · oldest stored audio {r['oldest_audio']}" if r.get('oldest_audio') else ""))
    if ex["f"]:
        d = sql(Q_PURGE_RULE)[0]["def"] or ""
        rule = [x.strip() for x in d.splitlines() if re.search(r"interval|where|and |or |now\(\)|status|transcript", x, re.I)]
        say("  when audio becomes due for deletion (the rule itself, from the database):")
        for x in rule[:8]: say("    " + x[:140])
    else: say("  the purge rule (recordings_due_for_purge) is not installed, so the daily purge cannot delete anything")
say()
say("4. SCHEDULED CLEAN-UP JOBS")
if not ex["c"]: say("  the scheduler is not installed")
else:
    jobs = sql(Q_CRON)
    if not jobs: say("  no clean-up or retention job is scheduled")
    for j in jobs: say(f"  {j['jobname']} · {j['schedule']} · {'on' if j['active'] else 'OFF'}")
say()
say("NOTHING WAS CHANGED. Bring this report to Claude.")
done(0)
