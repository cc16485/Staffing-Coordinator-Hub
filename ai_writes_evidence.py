#!/usr/bin/env python3
# Desktop 290 · READ ONLY · the unchecked AI lead writes: is call-followup live, what triggers it, what it writes,
# has it written production records, how many, and can its writes be told apart from a person's?
# Counts and dates only: no names, phone numbers, transcripts or care details are printed. Nothing is changed.
import json, os, re, sys, urllib.request, urllib.error, urllib.parse, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); HUB = "zngsgedlsxinbygwmxwn"
lines = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
sys.excepthook = lambda t, e, tb: (say(f"✗ The check stopped unexpectedly ({t.__name__}: {str(e)[:160]}). Everything above is accurate; nothing was changed."), done(8))
def http(method, url, body=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers={"Content-Type": "application/json", "User-Agent": "cc-ai-writes/1.0", "Authorization": "Bearer " + TOKEN})
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
Q_LOG = f"""select count(*) as entries, min(e->>'at') as first_at, max(e->>'at') as last_at,
  count(*) filter (where e->>'stage' = 'received') as received,
  count(*) filter (where e->>'stage' = 'analyzed') as analyzed,
  count(*) filter (where e->>'stage' = 'analyzed' and e->>'is_client_lead' = 'true') as client_calls,
  count(*) filter (where e->>'stage' = 'analyzed' and e->>'is_client_lead' = 'false') as not_client_calls
from public.app_data ad, {ARR} e where ad.key = 'call_followup_log'"""
TOUCHED = "coalesce(e->>'last_call_at', '') <> ''"
NE = lambda k: f"coalesce(e->>'{k}', '') not in ('', '[]')"
Q_LEADS = f"""select count(*) as leads,
  count(*) filter (where {TOUCHED}) as ai_touched,
  count(*) filter (where coalesce(e->>'call_transcript', '') <> '') as with_ai_transcript,
  min(e->>'last_call_at') filter (where {TOUCHED}) as first_ai_write,
  max(e->>'last_call_at') filter (where {TOUCHED}) as last_ai_write,
  count(*) filter (where {TOUCHED} and e->>'created_at' = e->>'last_call_at') as created_by_ai,
  count(*) filter (where {TOUCHED} and e->>'created_at' <> e->>'last_call_at') as existing_lead_rewritten,
  count(*) filter (where {TOUCHED} and e->>'awaiting_followup_review' = 'true') as still_awaiting_review,
  count(*) filter (where {TOUCHED} and coalesce(e->>'updated_at', '') > e->>'last_call_at') as changed_again_after_ai,
  count(*) filter (where {TOUCHED} and {NE('needs')}) as f_needs,
  count(*) filter (where {TOUCHED} and {NE('medical_conditions')}) as f_conditions,
  count(*) filter (where {TOUCHED} and {NE('mobility')}) as f_mobility,
  count(*) filter (where {TOUCHED} and {NE('urgency')}) as f_urgency,
  count(*) filter (where {TOUCHED} and {NE('funding_source')}) as f_payer,
  count(*) filter (where {TOUCHED} and {NE('relationship')}) as f_relationship,
  count(*) filter (where {TOUCHED} and {NE('rate_discussed')}) as f_rate,
  count(*) filter (where {TOUCHED} and {NE('ai_needs_summary')}) as f_summary,
  count(*) filter (where not ({TOUCHED}) and {NE('ai_needs_summary')}) as summary_button_only,
  count(*) filter (where coalesce(e->'last_call_transcript'->>'text', '') <> '') as with_gohighlevel_call_transcript,
  count(*) filter (where {TOUCHED} and e->>'status' in ('Converted')) as ai_touched_now_clients
from public.app_data ad, {ARR} e where ad.key = 'leads'"""
Q_MONTHS = f"""select substr(e->>'last_call_at', 1, 7) as month, count(*) as leads
from public.app_data ad, {ARR} e where ad.key = 'leads' and {TOUCHED} group by 1 order by 1"""
Q_FUPS = f"""select count(*) filter (where e->>'ai_generated' = 'true') as ai_drafts,
  count(*) filter (where e->>'ai_generated' = 'true' and e->>'status' = 'pending_approval') as pending,
  count(*) filter (where e->>'ai_generated' = 'true' and e->>'status' <> 'pending_approval') as handled,
  min(e->>'created_at') filter (where e->>'ai_generated' = 'true') as first_at,
  max(e->>'created_at') filter (where e->>'ai_generated' = 'true') as last_at
from public.app_data ad, {ARR} e where ad.key = 'post_call_followups'"""

say("THE UNCHECKED AI LEAD WRITES · READ ONLY EVIDENCE")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + " · counts and dates only, nothing changed"); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was run."); done(1)

say("1. IS IT DEPLOYED, AND CAN IT BE CALLED?")
s, b = http("GET", f"{API}/v1/projects/{HUB}/functions/call-followup"); f = jl(b) if s == 200 else {}
if s == 200:
    upd = f.get("updated_at"); upd = dt.datetime.fromtimestamp(upd / 1000, dt.timezone.utc).strftime("%Y-%m-%d") if isinstance(upd, (int, float)) else str(upd or "?")
    say(f"  deployed: yes · version {f.get('version')} · last deployed {upd} · platform sign-in check {'ON' if f.get('verify_jwt') else 'off (it is called by a GoHighLevel webhook with its own token)'}")
else: say(f"  deployed: {'no' if s == 404 else 'could not tell (HTTP ' + str(s) + ')'}")
s, b = http("GET", f"{API}/v1/projects/{HUB}/secrets"); names = {x.get("name") for x in (jl(b) if isinstance(jl(b), list) else [])}
say(f"  its webhook token (CALL_FOLLOWUP_TOKEN) is set: {'yes' if 'CALL_FOLLOWUP_TOKEN' in names else 'no'} · the AI key is set: {'yes' if 'ANTHROPIC_API_KEY' in names else 'no'}")
say("  trigger: a GoHighLevel workflow on 'call completed' posting the transcript to it. GoHighLevel's workflows can't be listed")
say("  with the current key (Desktop 285 was refused), so whether that workflow exists is shown below by what actually arrived.")
say()
say("2. HAS ANYTHING ACTUALLY ARRIVED? (its own arrival log, which keeps only the last 50 entries)")
lg = sql(Q_LOG)[0]
if not int(lg.get("entries") or 0): say("  no arrivals logged, ever (or the log was never created)")
else:
    say(f"  {lg['entries']} log entries from {str(lg['first_at'])[:10]} to {str(lg['last_at'])[:10]}: {lg['received']} calls received, {lg['analyzed']} read by the AI")
    say(f"    the AI judged {lg['client_calls']} to be prospective-client calls and {lg['not_client_calls']} not (those create nothing)")
say()
say("3. HAS IT WRITTEN PRODUCTION LEAD RECORDS?")
ld = sql(Q_LEADS)[0]; t = int(ld.get("ai_touched") or 0)
say(f"  leads on file: {ld['leads']} · leads the AI wrote to: {t}" + (f" (first {str(ld['first_ai_write'])[:10]}, last {str(ld['last_ai_write'])[:10]})" if t else ""))
if t:
    say(f"    created by the AI: {ld['created_by_ai']} · existing leads it rewrote: {ld['existing_lead_rewritten']} · of those, now clients: {ld['ai_touched_now_clients']}")
    say(f"    still flagged 'awaiting follow-up review': {ld['still_awaiting_review']} · changed again later by someone or something: {ld['changed_again_after_ai']}")
    say(f"    fields it left filled in: needs {ld['f_needs']} · medical conditions {ld['f_conditions']} · mobility {ld['f_mobility']} · urgency {ld['f_urgency']}")
    say(f"      payer {ld['f_payer']} · relationship {ld['f_relationship']} · rate discussed {ld['f_rate']} · AI summary {ld['f_summary']}")
    say(f"    leads holding a full AI call transcript: {ld['with_ai_transcript']} (never shown on screen, never deleted)")
    for m in sql(Q_MONTHS): say(f"      {m['month']}: {m['leads']} lead(s)")
say(f"  separately, the profile's 'AI summary' button (a person clicks it) wrote a summary on {ld['summary_button_only']} other lead(s)")
say(f"  and GoHighLevel's own call summaries/transcripts (call-disposition, not this AI) sit on {ld['with_gohighlevel_call_transcript']} lead(s)")
say()
say("4. THE DRAFTED EMAILS AND TEXTS (these DO wait for a person)")
fu = sql(Q_FUPS)[0]
if not int(fu.get("ai_drafts") or 0): say("  none")
else: say(f"  {fu['ai_drafts']} AI drafts from {str(fu['first_at'])[:10]} to {str(fu['last_at'])[:10]}: {fu['pending']} still waiting for approval, {fu['handled']} handled")
say()
say("5. CAN AI WRITES BE TOLD APART FROM A PERSON'S?")
say("  Which leads the AI touched, and when it last did: YES (it stamps last_call_at, the transcript and 'awaiting review').")
say("  Which field VALUES came from the AI: NO. It overwrites needs, conditions, mobility, urgency, payer and relationship")
say("  in place and records no source per field, so a value a person typed and a value the AI heard look the same.")
say("  The fields it names ai_... (summary, care flags) are the only ones that say 'AI' by their name.")
say()
say("NOTHING WAS CHANGED. Bring this report to Claude; the decision about the live behaviour is yours.")
done(0)
