#!/usr/bin/env python3
# 1004 · WHO EACH SETTING POINTS TO (server jobs off Samantha, batch 1; Samantha 2026-10-18: "Build batch 1: a read-only
# Desktop step that shows who each setting points to").
# READ ONLY: one SELECT, nothing is changed, nothing is sent. It reports, in plain words, where the server's routine
# notices, alerts and escalations go today, and lists first everything that lands on Samantha:
#   · each work area's owner (Owners Hub Admin page, Work areas), and so who gets that area's routine notices
#     (the owner, else the Springfield lead, else Samantha: _shared/notice-to.ts)
#   · the Springfield lead, the owners
#   · the coverage / clock-in alert list, the backstop phone (last 4 digits only), the morning brief list, the
#     afternoon-interviews name, the duty defaults (In charge, Leadership, Staffing, Operations), the leadership backup,
#     the bonus decider and payroll person, the HR lead, the new-lead alert list
#   · how many duty-schedule windows exist per seat
# Things set outside the database (function secrets such as LEAD_DIGEST_EMAILS, BACKUP_EMAIL) cannot be read here; the
# report says so.
import json, os, re
os.environ.setdefault("SB_STEP", "1004")
import cc_step_lib as L
from cc_step_lib import say, bad, done, sql, start

REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SAM = os.environ.get("SB_OWNER_EMAIL", "samantha@mo-care.com")
ok = lambda s: say("  ✓ " + s)

start("WHO EACH SETTING POINTS TO (read only)")
good, rows = sql(REF, """select jsonb_build_object(
  'domains', (select coalesce(jsonb_agg(to_jsonb(d) order by d.code), '[]'::jsonb) from public.domains d where d.entity = 'cc_ihs'),
  'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.person_id, 'name', p.full_name, 'email', lower(coalesce(p.primary_email, '')), 'active', p.active)), '[]'::jsonb) from public.persons p),
  'roles', (select coalesce(jsonb_agg(jsonb_build_object('id', r.person_id, 'role', r.role)), '[]'::jsonb) from public.staff_roles r where r.entity = 'cc_ihs' and r.role in ('springfield_lead', 'owner_admin')),
  'settings', (select data from public.app_data where key = 'ops_settings'),
  'duty', (select data from public.app_data where key = 'duty_windows'),
  'alerts', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.applicant_alerts a where coalesce((to_jsonb(a)->>'active')::boolean, true))
) as r""")
if not good: bad(f"could not read the settings: {str(rows)[:300]}"); say("  RESULT: STOPPED. Nothing was changed. Tell Claude."); done(2)
X = rows[0]["r"]; X = json.loads(X) if isinstance(X, str) else X
P = {str(p["id"]): p for p in (X.get("people") or [])}
EM = {p["email"]: p for p in P.values() if p.get("email")}
def who(v):
    """an email or a person id -> 'Name (email)'"""
    v = str(v or "").strip()
    if not v: return "nobody"
    p = P.get(v) or EM.get(v.lower())
    if p: return (p.get("name") or p["email"]) + (" (switched off)" if p.get("active") is False else "")
    return v
def isSam(v):
    v = str(v or "").strip().lower(); p = P.get(v) or EM.get(v)
    return (p and p.get("email") == SAM) or v == SAM
def phone(v):
    d = re.sub(r"\D", "", str(v or "")); return ("ending " + d[-4:]) if len(d) >= 4 else ("not set" if not d else "set")
S = X.get("settings") or {}; S = S if isinstance(S, dict) else {}
roles = X.get("roles") or []
lead = sorted([P[str(r["id"])] for r in roles if r["role"] == "springfield_lead" and str(r["id"]) in P and P[str(r["id"])].get("active") is not False and P[str(r["id"])].get("email")], key=lambda p: p["email"])
owners = [P[str(r["id"])] for r in roles if r["role"] == "owner_admin" and str(r["id"]) in P]
lines, mine = [], []
def row(label, value, sam):
    lines.append((label, value)); 
    if sam: mine.append(label + ": " + value)

say("WORK AREAS (who gets each area's routine notices: the owner, else the Springfield lead, else Samantha)")
leadName = (lead[0].get("name") or lead[0]["email"]) if lead else ""
for d in X.get("domains") or []:
    code = d.get("code"); label = d.get("name") or d.get("label") or code
    if d.get("active") is False: say(f"  · {label}: switched off"); continue
    o = d.get("owner_person"); op = P.get(str(o)) if o else None
    if op and op.get("active") is not False and op.get("email"): to, sam, why = op.get("name") or op["email"], op["email"] == SAM, "the owner"
    elif lead: to, sam, why = leadName, lead[0]["email"] == SAM, "nobody owns it, so the Springfield lead"
    else: to, sam, why = "Samantha", True, "nobody owns it and there is no Springfield lead, so Samantha"
    esc = d.get("escalation_person")
    say(f"  · {label} ({code}): {to} ({why})" + (f"; escalation: {who(esc)}" if esc else ""))
    if sam: mine.append(f"{label} routine notices ({why})")
    if esc and isSam(esc): mine.append(f"{label} escalation person")
say(); say("PEOPLE")
say("  · Springfield lead: " + (", ".join(p.get("name") or p["email"] for p in lead) or "nobody (routine notices with no area owner fall to Samantha)"))
if not lead: mine.append("no Springfield lead, so every unowned routine notice")
say("  · Owners: " + (", ".join(p.get("name") or p["email"] for p in owners) or "nobody"))
say(); say("SETTINGS (Hub Settings and the Owners Hub Admin page)")
caa = S.get("coverage_alert_admins") if isinstance(S.get("coverage_alert_admins"), list) else []
v = ", ".join(who(x) for x in caa) if caa else "empty, so the Scheduling and coverage area's owner and the Springfield lead"
say("  · Coverage and clock-in alerts: " + v); 
if any(isSam(x) for x in caa): mine.append("coverage and clock-in alerts (on the list)")
say("  · Backstop phone (missed-call escalation texts, last stop): " + phone(S.get("fallback_phone")))
mb = S.get("morning_brief_recipients")
mbl = mb if isinstance(mb, list) else [x.strip() for x in str(mb or "").split(",") if x.strip()]
say("  · Morning brief: " + (", ".join(who(x) for x in mbl) if mbl else "not set, so a function secret or the built-in Samantha + Krystal"))
if (not mbl) or any(isSam(x) for x in mbl): mine.append("the morning brief" + ("" if mbl else " (built-in fallback)"))
ai = S.get("afternoon_interviews") or {}
say("  · Afternoon interviews are labelled: " + (str(ai.get("name")) if isinstance(ai, dict) and ai.get("name") else "not set, so 'Samantha' from 2pm"))
if not (isinstance(ai, dict) and ai.get("name")) or str(ai.get("name", "")).lower().startswith("samantha"): mine.append("afternoon interviews label")
for area, lab in (("in_charge", "In charge"), ("owner_escalation", "Leadership"), ("staffing", "Staffing"), ("operations", "Operations")):
    dv = S.get("duty_default_" + area)
    say(f"  · {lab} when nobody is scheduled: " + (who(dv) if dv else "not set, so the first coverage alert person (or the Scheduling owner / Springfield lead)"))
    if dv and isSam(dv): mine.append(f"{lab} seat when nobody is scheduled")
say("  · Leadership backup: " + who(S.get("leadership_backup")))
b = S.get("bonus") if isinstance(S.get("bonus"), dict) else {}
say("  · Bonus decider: " + who(b.get("decider") or SAM) + " · payroll person: " + who(b.get("payroll")))
t = S.get("team") if isinstance(S.get("team"), dict) else {}
say("  · HR lead (management reviews): " + who(t.get("hr_lead") or "zach@mo-care.com"))
al = [a for a in (X.get("alerts") or []) if "lead" in str(a.get("alert_on") or a.get("on") or "")]
say("  · New-lead alert list: " + (", ".join(who(a.get("email") or a.get("name")) for a in al) if al else "empty, so the Family enquiries owner and the Springfield lead"))
if any(isSam(a.get("email")) for a in al): mine.append("new-lead alerts (on the list)")
dw = X.get("duty") or []; dw = dw if isinstance(dw, list) else []
cnt = {}
for w in dw: cnt[w.get("area")] = cnt.get(w.get("area"), 0) + 1
say("  · Duty schedule windows: " + (", ".join(f"{k} {n}" for k, n in sorted(cnt.items(), key=lambda x: str(x[0]))) or "none"))
say(); say("POINTS AT SAMANTHA TODAY (" + str(len(mine)) + ")")
for m in mine: say("  → " + m)
if not mine: ok("nothing routine points at Samantha")
say(); say("  · Not readable here (function secrets): LEAD_DIGEST_EMAILS, BACKUP_EMAIL (the backup stays with owners by design).")
say("  · Owner-only by design and not listed above: bonus decisions, unresolved reviews, owner exceptions, Hep B records.")
say(); say("RESULT: DONE · Read only: nothing was changed and nothing was sent. Tell Claude, who turns this into the list of settings to change.")
done(0)
