#!/usr/bin/env python3
# practice_run_lib.py · SLICE 10, THE PRACTICE RUN (Samantha "yes to all" + "approve the two fixes", 2026-10-11).
# The one made-up hire and how every Desktop step of the run finds Pat's records. Imported by practice_run_58x.py; each of
# those runs from a worktree pinned to one reviewed commit (cc_step_lib). Pat is reachable only at practice addresses
# (555-0180 to 555-0189, @practice.invalid), which the opt-out door refuses for every sender whatever any switch says.
import json, os, re, urllib.request, urllib.error
from cc_step_lib import sql, http, lit, say, bad, API, MG, HIDE
HUB = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"
FNB = f"https://{HUB}.supabase.co"; TRB = f"https://{TRN}.supabase.co"
LABEL = "Slice 10 practice run"
FIRST, LAST = "Pat", "Practice"
PHONE = "4175550183"; EMAIL = "pat.practice@practice.invalid"
AXID = "990000183"                               # a made-up AxisCare caregiver number, checked unused before anything starts
OUT = os.environ.get("SB_PR_OUT") or os.path.expanduser("~/Desktop/Slice 10 practice run")
# every switch on the path: the sending ones must be off for the whole run
MUST_BE_OFF = ["offer_send_live", "offer_reminders_live", "step1_auto_live", "step2_send_live", "step2_reminders_live", "wc_auto_invite_live",
               "approve_work_axiscare_live", "approve_work_text_live", "axiscare_hire_date_live", "axiscare_level_live", "training_sync_live",
               "oig_monthly_live", "audit_sweep_live", "eligibility_sweep_live", "obligations_live", "obligations_live_lapses"]
SHOWN_ONLY = ["cg_connect_live", "orient_remind_live", "client_audit_live", "lead_docs_purge_live"]

def switches():
    ok_, r = sql(HUB, "select data from public.app_data where key = 'ops_settings'")
    return (r[0]['data'] or {}) if ok_ and r else None

def offer():
    ok_, r = sql(TRN, f"select * from public.job_offers where offered_by = {lit(LABEL)} order by created_at desc limit 1")
    return r[0] if ok_ and r else None

def person_rows(offer_id):
    """Pat's Background & References record and roster record (the elements carrying this offer id)"""
    out = {}
    for key in ("candidates", "caregivers"):
        ok_, r = sql(HUB, f"select x as rec from public.app_data, jsonb_array_elements(data) x where key = {lit(key)} and x->>'offer_id' = {lit(str(offer_id))}")
        out[key] = [row['rec'] for row in r] if ok_ else []
    return out

def journey(offer_id):
    ok_, r = sql(HUB, f"select * from public.client_journey where subject = 'caregiver' and offer_id = {lit(str(offer_id))} order by created_at desc limit 1")
    return r[0] if ok_ and r else None

def keys():
    """the project's public and server keys (for the proof calls); hidden in every line of the report"""
    s_, b_ = http("GET", f"{API}/v1/projects/{HUB}/api-keys?reveal=true", headers=MG()); anon = svc = ""
    try:
        arr = json.loads(b_) if s_ == 200 else []
        if isinstance(arr, dict): arr = arr.get("keys") or []
        anon = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "anon" and str(k.get("api_key", "")).startswith("eyJ")), "")
        svc = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
    except Exception: pass
    HIDE.extend([anon, svc]); return anon, svc

def trn_service():
    s_, b_ = http("GET", f"{API}/v1/projects/{TRN}/api-keys?reveal=true", headers=MG()); svc = ""
    try:
        arr = json.loads(b_) if s_ == 200 else []
        if isinstance(arr, dict): arr = arr.get("keys") or []
        svc = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
    except Exception: pass
    HIDE.append(svc); return svc

def save_object(base, svc, bucket, path, dest_name):
    """download one private file with the server key into the run's Desktop folder; True when saved"""
    os.makedirs(OUT, exist_ok=True)
    req = urllib.request.Request(f"{base}/storage/v1/object/{bucket}/{path}", headers={"Authorization": "Bearer " + svc, "apikey": svc})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: data = r.read()
        open(os.path.join(OUT, dest_name), "wb").write(data); return len(data)
    except Exception: return 0

def safe_name(s): return re.sub(r"[^A-Za-z0-9 ._()-]+", "_", str(s))[:120]
