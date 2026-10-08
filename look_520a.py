#!/usr/bin/env python3
# 520a · GHE CHECK: LOOK ONLY (Samantha 2026-10-08: "right now we are not compliant on the GHEs"). Reads the Hub's nurse
# board, GHE forms, nurse list, Medicaid leads and active clients straight from the database with read-only SELECTs, and
# reports where the GHE gaps are. Nothing is deployed, written, texted or emailed. Client names appear (this report is for
# the office); no phone number or email address does.
# The rule it checks against (her approval page, 2026-10-08): Agency Model personal care and APC clients get two GHEs a
# year, in the 4th and 10th months after the (re)assessment, by an RN or an LPN with RN oversight (MAN 3.15 rev. Jul 2026;
# INFO 05-26-02; INFO 08-26-01). Upload to Fusion by the earlier of 10 working days (MAN 8.00 App. 4) or the 15th of the
# next month (HCBS 08-26-01). Not for CDS-only, ADW-only or ILW-only clients.
import json, os, re, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
TODAY = os.environ.get("SB_TODAY") or dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-520a/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def sql(q):
    assert re.match(r"^\s*select\b", q, re.I) and ";" not in q.strip().rstrip(";"), "read-only SELECTs only"
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    if s not in (200, 201): return None, f"HTTP {s}: {str(b)[:200]}"
    try: return json.loads(b), None
    except Exception: return None, str(b)[:200]
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was changed. Tell Claude.")
    open(REPORT, "w").write("\n".join(lines) + "\n")
sys.excepthook = _crash

TEST = re.compile(r"\b(test|zz|sample|preview|demo)\b", re.I)
def ym(d): return str(d or "")[:7]
def add_months(m, n):
    y, mo = int(m[:4]), int(m[5:7]) + n
    y += (mo - 1) // 12; mo = (mo - 1) % 12 + 1
    return f"{y:04d}-{mo:02d}"
def working_days_after(d, n):
    x = dt.date.fromisoformat(d)
    while n:
        x += dt.timedelta(days=1)
        if x.weekday() < 5: n -= 1
    return x.isoformat()
def upload_due(visit):
    """Earlier of 10 working days after the visit, or the 15th of the next month."""
    a = working_days_after(visit, 10)
    nm = add_months(visit[:7], 1) + "-15"
    return min(a, nm)
def norm(s): return re.sub(r"\s+", " ", str(s or "").strip().lower())

def analyse(data, roles, cron, today=TODAY):
    """Pure: everything the report says comes from here (the test drives it with sample rows)."""
    month = today[:7]
    clients = [c for c in data.get("nurse_clients", []) if c.get("active") is not False and not TEST.search(str(c.get("name", "")))]
    visits = data.get("nurse_visits", []); forms = [f for f in data.get("ghe_forms", []) if not TEST.search(str(f.get("client", "")))]
    staff = data.get("nurse_staff", []); leads = data.get("leads", [])
    beats = {b.get("automation"): b for b in data.get("automation_heartbeats", []) if isinstance(b, dict)}
    R = {"month": month}

    def handled(c, m):
        return any(norm(f.get("client")) == norm(c.get("name")) and ym(f.get("visit_date")) == m for f in forms) or \
            any(str(v.get("client_id")) == str(c.get("id")) and str(v.get("type", "")).startswith("ghe") and v.get("status") == "completed"
                and ym(v.get("completed_on")) == m for v in visits)
    def late_done(c, m):
        """A GHE form or completed GHE visit for this client in the month after the window (done late, not reimbursable)."""
        nm = add_months(m, 1)
        return handled(c, nm)
    def booked(c, w):
        return any(str(v.get("client_id")) == str(c.get("id")) and v.get("type") == w and v.get("status") == "scheduled" for v in visits)

    rows = []
    for c in clients:
        ws = [(w, ym(c.get(w))) for w in ("ghe1", "ghe2") if ym(c.get(w))]
        st = []
        for w, m in ws:
            if handled(c, m): s = "done"
            elif m > month: s = "upcoming"
            elif booked(c, w): s = "booked" if m == month else "overdue (booked late)"
            elif m == month: s = "due this month"
            elif late_done(c, m): s = "done a month late"
            else: s = "missed"
            st.append((w, m, s))
        future = [m for _, m in ws if m >= month]
        rows.append({"name": c.get("name") or "(unnamed)", "nurse": c.get("assigned_nurse") or "", "ax": str(c.get("axiscare_client_id") or ""),
                     "windows": st, "no_months": not ws, "rolled_off": bool(ws) and not future,
                     "gap": (len(ws) == 2 and abs((int(ws[0][1][:4]) * 12 + int(ws[0][1][5:])) - (int(ws[1][1][:4]) * 12 + int(ws[1][1][5:]))) != 6)})
    R["board"] = rows
    R["missed"] = [(r["name"], m, r["nurse"]) for r in rows for _, m, s in r["windows"] if s == "missed"]
    R["late"] = [(r["name"], m) for r in rows for _, m, s in r["windows"] if s == "done a month late"]
    R["due"] = [(r["name"], m, r["nurse"]) for r in rows for _, m, s in r["windows"] if s in ("due this month", "booked")]
    R["no_months"] = [r["name"] for r in rows if r["no_months"]]
    R["rolled_off"] = [r["name"] for r in rows if r["rolled_off"]]
    R["not_six"] = [r["name"] for r in rows if r["gap"]]
    R["no_nurse"] = [r["name"] for r in rows if not r["nurse"]]
    R["unlinked"] = [r["name"] for r in rows if not r["ax"]]

    # Active clients (AxisCare-linked Hub people) against the nurse board
    active = [x for x in roles if not TEST.search(str(x.get("name", "")))]
    act_ax = {str(x["ax"]): x for x in active if x.get("ax")}
    board_ax = {r["ax"] for r in rows if r["ax"]}
    board_names = {norm(r["name"]) for r in rows}
    R["board_not_active"] = [r["name"] for r in rows if r["ax"] and r["ax"] not in act_ax]
    def is_med(l):
        return str(l.get("funding_source", "")).lower() == "medicaid" or "medicaid" in str(l.get("payer", "")).lower()
    med_ax = {}
    for l in leads:
        ax = str(l.get("axiscare_client_id") or "")
        if ax and is_med(l): med_ax[ax] = l
    R["active_total"] = len(active)
    R["active_medicaid"] = sorted(act_ax[a]["name"] for a in med_ax if a in act_ax)
    R["medicaid_not_on_board"] = sorted(act_ax[a]["name"] for a in med_ax if a in act_ax and a not in board_ax and norm(act_ax[a]["name"]) not in board_names)
    R["active_unknown_payer"] = sum(1 for a in act_ax if a not in {str(l.get("axiscare_client_id") or "") for l in leads if l.get("axiscare_client_id")})
    R["active_no_ax"] = sum(1 for x in active if not x.get("ax"))

    # GHE forms
    by = {}
    for f in forms: by.setdefault(f.get("status") or "draft", []).append(f)
    R["forms_by_status"] = {k: len(v) for k, v in by.items()}
    ready = []
    for f in by.get("ready", []):
        vd = str(f.get("visit_date") or "")[:10]
        due = upload_due(vd) if re.match(r"\d{4}-\d{2}-\d{2}$", vd) else ""
        ready.append((f.get("client") or "(unnamed)", vd, due, bool(due) and due < today))
    R["ready"] = ready
    R["rn_review"] = [(f.get("client") or "(unnamed)", str(f.get("visit_date") or "")[:10]) for f in by.get("rn_review", [])]
    R["drafts_old"] = [(f.get("client") or "(unnamed)", str(f.get("visit_date") or "")[:10]) for f in by.get("draft", []) if str(f.get("visit_date") or "")[:10] and str(f.get("visit_date"))[:10] < (dt.date.fromisoformat(today) - dt.timedelta(days=7)).isoformat()]
    R["uploaded_no_date"] = len(by.get("uploaded", []))
    cred = {norm(s.get("name")): s.get("cred") for s in staff}
    R["forms_by_cred"] = {}
    for f in forms:
        k = cred.get(norm(f.get("nurse")), "unknown"); R["forms_by_cred"][k] = R["forms_by_cred"].get(k, 0) + 1
    R["forms_no_rn_sig"] = [f.get("client") or "(unnamed)" for f in forms if f.get("status") in ("ready", "uploaded") and not f.get("sig_sup")]

    # Nurses
    nurses = []
    for s in staff:
        exp = str(s.get("expires") or "")[:10]
        lic = "no expiry on file" if not exp else ("EXPIRED " + exp if exp < today else ("expires " + exp))
        load = sum(1 for r in rows if r["nurse"] == s.get("name"))
        nurses.append((s.get("name") or "(unnamed)", s.get("cred") or "?", bool(str(s.get("email") or "").strip()), lic, load))
    R["nurses"] = nurses
    R["rn_count"] = sum(1 for n in nurses if n[1] == "RN")
    R["assigned_unknown_nurse"] = sorted({r["nurse"] for r in rows if r["nurse"] and r["nurse"] not in {s.get("name") for s in staff}})

    # The reminder job
    hb = beats.get("ghe-reminders") or {}
    R["cron"] = cron
    R["heartbeat"] = (hb.get("at") or "", hb.get("note") or "")
    return R

def report(R):
    say(f"PART 2 · WHAT THE HUB SHOWS (as of {TODAY})"); say()
    say(f"  Nurse board: {len(R['board'])} active clients.")
    say(f"  GHE windows missed and never done: {len(R['missed'])}")
    for n, m, nu in R["missed"]: say(f"      · {n}: window {m}" + (f" (nurse {nu})" if nu else " (no nurse)"))
    say(f"  Done a month late (not paid unless the delay was outside our control): {len(R['late'])}")
    for n, m in R["late"]: say(f"      · {n}: window {m}")
    say(f"  Due this month: {len(R['due'])}")
    for n, m, nu in R["due"]: say(f"      · {n}" + (f" (nurse {nu})" if nu else " (NO NURSE)"))
    say()
    say(f"  On the board with NO GHE months entered: {len(R['no_months'])}" + (": " + ", ".join(R["no_months"]) if R["no_months"] else ""))
    say(f"  Both GHE months already passed, next year's never entered: {len(R['rolled_off'])}" + (": " + ", ".join(R["rolled_off"]) if R["rolled_off"] else ""))
    say(f"  GHE months not 6 months apart (check against Fusion): {len(R['not_six'])}" + (": " + ", ".join(R["not_six"]) if R["not_six"] else ""))
    say(f"  No nurse assigned: {len(R['no_nurse'])}" + (": " + ", ".join(R["no_nurse"]) if R["no_nurse"] else ""))
    say(f"  Not linked to their AxisCare record: {len(R['unlinked'])}")
    say(f"  On the board but no longer an active client: {len(R['board_not_active'])}" + (": " + ", ".join(R["board_not_active"]) if R["board_not_active"] else ""))
    say()
    say(f"  Active clients in the Hub: {R['active_total']} (+{R['active_no_ax']} with no AxisCare link)")
    say(f"  Of those, known Medicaid from their Hub lead: {len(R['active_medicaid'])}")
    say(f"  Known Medicaid clients NOT on the nurse board (no GHE reminder at all): {len(R['medicaid_not_on_board'])}")
    for n in R["medicaid_not_on_board"]: say(f"      · {n}")
    say(f"  Active clients with no Hub lead, so their payer is unknown to the Hub: {R['active_unknown_payer']}")
    say("    (AxisCare has no payer field, so these need a person to say Medicaid or not.)")
    say()
    say("  GHE forms by status: " + (", ".join(f"{k} {v}" for k, v in sorted(R["forms_by_status"].items())) or "none"))
    say(f"  Signed and waiting to go into Fusion: {len(R['ready'])}")
    for n, vd, due, late in R["ready"]: say(f"      · {n}: visit {vd or '?'}, upload due {due or '?'}" + ("  PAST DUE" if late else ""))
    say(f"  Waiting for RN review: {len(R['rn_review'])}" + (": " + ", ".join(f"{n} ({d})" for n, d in R["rn_review"]) if R["rn_review"] else ""))
    say(f"  Drafts more than a week after the visit: {len(R['drafts_old'])}" + (": " + ", ".join(f"{n} ({d})" for n, d in R["drafts_old"]) if R["drafts_old"] else ""))
    say(f"  Marked Uploaded: {R['uploaded_no_date']} (the Hub keeps no upload date, only when the record was last changed)")
    say(f"  Ready or uploaded with no supervisor/RN signature: {len(R['forms_no_rn_sig'])}" + (": " + ", ".join(R["forms_no_rn_sig"]) if R["forms_no_rn_sig"] else ""))
    say("  Forms by the nurse's credential: " + (", ".join(f"{k} {v}" for k, v in sorted(R["forms_by_cred"].items())) or "none"))
    say()
    say(f"  Nurses on the license list: {len(R['nurses'])} ({R['rn_count']} RN)")
    for n, c, em, lic, load in R["nurses"]: say(f"      · {n} ({c}): {'can sign in to the Nurse Portal' if em else 'NO portal sign-in (no email)'}, license {lic}, {load} clients")
    if R["assigned_unknown_nurse"]: say("  Clients assigned to a nurse who is not on the license list: " + ", ".join(R["assigned_unknown_nurse"]))
    say()
    c = R["cron"]
    say("  GHE reminder emails: " + ("scheduled" + ("" if all(x.get("active") for x in c) else " but switched OFF") if c else "NO schedule found"))
    hb = R["heartbeat"]
    say("  Last reminder run: " + (f"{hb[0][:16].replace('T', ' ')} UTC ({hb[1]})" if hb[0] else "never reported"))

if __name__ == "__main__":
    say("520a · GHE CHECK: LOOK ONLY"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    say("Nothing is written, texted or emailed. Read-only database SELECTs only."); say()
    say("PART 1 · READ")
    if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
    keys = ["nurse_clients", "nurse_visits", "ghe_forms", "nurse_staff", "leads", "automation_heartbeats"]
    rows, err = sql("select key, data from public.app_data where key in (" + ",".join(f"'{k}'" for k in keys) + ")")
    if err: bad("could not read the Hub data: " + err); done(3)
    data = {r["key"]: (r["data"] if isinstance(r["data"], list) else []) for r in rows}
    say("  ✓ read " + ", ".join(f"{k} {len(data.get(k, []))}" for k in keys))
    roles, err = sql("select coalesce(pi.display_name, trim(coalesce(pi.first_name,'')||' '||coalesce(pi.last_name,''))) as name, "
                     "(select ps.source_id from public.person_source_id ps where ps.person_id = pr.person_id and ps.system = 'axiscare' "
                     "and ps.entity_type = 'client' limit 1) as ax from public.person_role pr join public.person_identity pi on pi.id = pr.person_id "
                     "where pr.role = 'client' and pr.status = 'active'")
    if err: bad("could not read the active clients: " + err); done(3)
    say(f"  ✓ read {len(roles)} active client roles")
    cron, err = sql("select jobname, schedule, active from cron.job where jobname ilike '%ghe%'")
    if err: say("  · the reminder schedule could not be read (" + err[:80] + ")"); cron = []
    say()
    report(analyse(data, roles, cron))
    say(); say("  RESULT: read only, nothing changed."); done(0)
