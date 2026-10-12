#!/usr/bin/env python3
# 623 · EVERY AXISCARE CAREGIVER IN THE HUB, WITH A GOHIGHLEVEL CONTACT? (read only; Samantha 2026-10-12: "all caregivers that
# are in axiscare should be in the hub and have a ghl contact"). For every ACTIVE AxisCare caregiver: on the Hub roster (by
# AxisCare id)? if not, why (an open connect card, a person's block, no phone or email); a GoHighLevel contact (by phone or
# email, from the Hub's last GoHighLevel scan)? And the live GoHighLevel workflows, to review before any contact is created
# (a new contact or a tag can start a workflow that texts on its own). Reads only; nothing is created, sent or changed.
# Also saves the list as a spreadsheet beside this report.
import os, json, re, csv
os.environ.setdefault("SB_STEP", "623")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNB = f"https://{REF}.supabase.co/functions/v1"
d10 = lambda v: re.sub(r"\D", "", str(v or ""))[-10:]
start("EVERY AXISCARE CAREGIVER IN THE HUB, WITH A GOHIGHLEVEL CONTACT? (READ ONLY)")
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); SVC = ""
try:
    arr = json.loads(b2) if s2 == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    SVC = next((str(k.get("api_key")) for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: SVC = ""
if not SVC: bad("could not read the project's server key"); done(3)
H = {"apikey": SVC, "Authorization": "Bearer " + SVC}
s, b = http("POST", f"{FNB}/caregiver-census-report", {}, H)
try: census = json.loads(b)
except Exception: census = {}
if s != 200 or "caregivers" not in census: bad(f"the AxisCare census did not answer: {s} {str(b)[:200]}"); done(3)
active = [g for g in census["caregivers"] if g.get("active")]
say(f"  · AxisCare: {census.get('total')} caregivers, {len(active)} active" + (" (TRUNCATED: more than 20 pages)" if census.get("truncated") else ""))
ok, r = sql(REF, """select (select data::jsonb from public.app_data where key = 'caregivers') as roster,
  (select coalesce(jsonb_agg(x), '[]'::jsonb) from public.app_data, jsonb_array_elements(data::jsonb) x where key = 'ops_items' and x->>'kind' = 'caregiver_connect' and coalesce(x->>'status','open') = 'open') as cards,
  (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from public.caregiver_connect_blocked b) as blocked,
  coalesce((select data->>'cg_connect_live' from public.app_data where key = 'ops_settings'), 'not set') as connect_live,
  (select max(scanned_at) from public.identity_scan_cache) as scanned, (select count(*) from public.identity_scan_cache) as ghl_n""")
if not ok: bad(f"could not read the Hub: {r}"); done(3)
x = r[0]; roster = x["roster"] or []
on = {d10(c.get("axiscare_id")) for c in roster if c.get("axiscare_id")}
cards = {str(c.get("axiscare_id")): c for c in (x["cards"] or [])}
blocked = {str(c.get("axiscare_id")): c for c in (x["blocked"] or [])}
say(f"  · the Hub roster: {len(roster)} records ({len(on)} with an AxisCare id); caregiver auto-connect switch: {x['connect_live']}")
say(f"  · GoHighLevel: the Hub's last scan has {x['ghl_n']} contacts (scanned {str(x['scanned'])[:16]}); a contact created since then is not seen here")
ok, g = sql(REF, "select ghl_contact_id, phone, email from public.identity_scan_cache")
gp, ge = {}, {}
for c in (g or []):
    if c.get("phone"): gp.setdefault(d10(c["phone"]), c["ghl_contact_id"])
    if c.get("email"): ge.setdefault(str(c["email"]).strip().lower(), c["ghl_contact_id"])
rows = []
for a in active:
    ax = re.sub(r"\D", "", a["id"]); name = f"{a.get('first','')} {a.get('last','')}".strip()
    nurse = any(re.search(r"nurse|\bRN\b|\bLPN\b", k, re.I) for k in a.get("classes", []))
    in_hub = ax in on
    why = "" if in_hub else ("waiting on a Needs Attention connect card: " + str(cards[ax].get("title") or cards[ax].get("detail") or "")[:120]) if ax in cards else ("a person chose not to give them a Hub record (" + str(blocked[ax].get("kind")) + ")") if ax in blocked else "no phone and no email in AxisCare" if not (a.get("mobile") or a.get("email")) else "not connected yet (no card; the hourly connect has not picked them up)"
    ghl = gp.get(d10(a.get("mobile"))) if d10(a.get("mobile")) else None
    ghl = ghl or (ge.get(str(a.get("email") or "").strip().lower()) if a.get("email") else None)
    rows.append({"axiscare_id": ax, "name": name, "nurse": "yes" if nurse else "", "phone": a.get("mobile") or "", "email": a.get("email") or "", "in_hub": "yes" if in_hub else "NO", "why_not_in_hub": why, "ghl_contact": "yes" if ghl else ("NO" if (a.get("mobile") or a.get("email")) else "NO (no phone or email to make one)")})
miss_hub = [r_ for r_ in rows if r_["in_hub"] == "NO"]; miss_ghl = [r_ for r_ in rows if r_["ghl_contact"] != "yes"]
say(); say(f"NOT IN THE HUB: {len(miss_hub)} of {len(rows)} active AxisCare caregivers")
for r_ in miss_hub: say(f"  · {r_['name']} (AxisCare {r_['axiscare_id']}{', nurse' if r_['nurse'] else ''}): {r_['why_not_in_hub']}")
say(); say(f"NO GOHIGHLEVEL CONTACT FOUND: {len(miss_ghl)} of {len(rows)}")
for r_ in miss_ghl: say(f"  · {r_['name']} (AxisCare {r_['axiscare_id']}): {r_['ghl_contact']}")
s3, b3 = http("POST", f"{FNB}/ghl-inventory", {}, H)
try: inv = json.loads(b3)
except Exception: inv = {}
say(); say("GOHIGHLEVEL WORKFLOWS TO REVIEW BEFORE ANY CONTACT IS CREATED (a new contact or a tag can start one)")
wf = inv.get("workflows")
if isinstance(wf, list):
    live = [w for w in wf if str(w.get("status", "")).lower() in ("published", "active", "live")]
    say(f"  · {len(wf)} workflows, {len(live)} live (published). Live ones:")
    for w in live: say(f"     - {w.get('name')} (changed {w.get('updated')})")
else: say(f"  · could not list the workflows: {wf}")
tg = inv.get("tags")
if isinstance(tg, list): say("  · tags our code adds that exist in GoHighLevel: " + ", ".join(t["tag"] for t in tg if t.get("exists")))
out = os.path.join(os.path.dirname(REPORT), "623 AxisCare caregivers, Hub and GoHighLevel.csv")
try:
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["axiscare_id"]); w.writeheader(); w.writerows(rows)
    say(); say(f"  ✓ the full list is saved beside this report: {os.path.basename(out)}")
except Exception as e: say(f"  · the spreadsheet could not be saved: {e}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · read only; nothing was created, sent or changed. Send this report to Claude."); done(0)
