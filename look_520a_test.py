#!/usr/bin/env python3
# Rehearsal for 520a: drives analyse() with sample rows and checks every finding, plus the read-only guard. python3 look_520a_test.py
import os, sys, tempfile, importlib.util
os.environ["SB_REPORT"] = tempfile.mktemp(); os.environ["SB_TODAY"] = "2026-10-08"
spec = importlib.util.spec_from_file_location("l", os.path.join(os.path.dirname(os.path.abspath(__file__)), "look_520a.py"))
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
R_ = []; ok = lambda n, c, d="": R_.append((n, bool(c), d))
data = {
  "nurse_clients": [
    {"id": "a", "name": "Ann Missed", "ghe1": "2026-04", "ghe2": "2026-10", "assigned_nurse": "Rita RN", "axiscare_client_id": "1"},
    {"id": "b", "name": "Bob Done", "ghe1": "2026-04", "ghe2": "2026-10", "assigned_nurse": "Lena LPN", "axiscare_client_id": "2"},
    {"id": "c", "name": "Cal Late", "ghe1": "2026-08", "ghe2": "2027-02", "assigned_nurse": "", "axiscare_client_id": "3"},
    {"id": "d", "name": "Dee Nomonths", "assigned_nurse": "Rita RN", "axiscare_client_id": "4"},
    {"id": "e", "name": "Eve Rolled", "ghe1": "2025-11", "ghe2": "2026-05", "assigned_nurse": "Ghost Nurse", "axiscare_client_id": ""},
    {"id": "f", "name": "Fay Odd", "ghe1": "2026-11", "ghe2": "2027-01", "assigned_nurse": "Rita RN", "axiscare_client_id": "99"},
    {"id": "z", "name": "ZZ Test", "ghe1": "2026-01"},
    {"id": "g", "name": "Gone", "active": False, "ghe1": "2026-01"},
  ],
  "nurse_visits": [
    {"client_id": "b", "type": "ghe1", "status": "completed", "completed_on": "2026-04-20"},
    {"client_id": "c", "type": "ghe1", "status": "completed", "completed_on": "2026-09-03"},
  ],
  "ghe_forms": [
    {"client": "Bob Done", "visit_date": "2026-10-02", "status": "ready", "nurse": "Lena LPN", "sig_sup": ""},
    {"client": "Ann Missed", "visit_date": "2026-09-10", "status": "ready", "nurse": "Rita RN", "sig_sup": "x"},
    {"client": "Hal", "visit_date": "2026-09-01", "status": "draft", "nurse": "Rita RN"},
    {"client": "Ivy", "visit_date": "2026-09-20", "status": "rn_review", "nurse": "Lena LPN"},
    {"client": "Jo", "visit_date": "2026-05-01", "status": "uploaded", "nurse": "Rita RN", "sig_sup": "x"},
  ],
  "nurse_staff": [{"name": "Rita RN", "cred": "RN", "email": "rita@x.com", "expires": "2027-01-01"},
                  {"name": "Lena LPN", "cred": "LPN", "email": "", "expires": "2026-09-01"}],
  "leads": [{"axiscare_client_id": "1", "funding_source": "medicaid"}, {"axiscare_client_id": "5", "funding_source": "medicaid"},
            {"axiscare_client_id": "6", "funding_source": "private"}],
  "automation_heartbeats": [{"automation": "ghe-reminders", "at": "2026-10-06T15:00:01Z", "note": "due 1, overdue 3"}],
}
roles = [{"name": "Ann Missed", "ax": "1"}, {"name": "Bob Done", "ax": "2"}, {"name": "Cal Late", "ax": "3"}, {"name": "Dee Nomonths", "ax": "4"},
         {"name": "Kim Medicaid", "ax": "5"}, {"name": "Lou Private", "ax": "6"}, {"name": "Max Nolead", "ax": "7"}, {"name": "Ned", "ax": None},
         {"name": "Test Person", "ax": "8"}]
R = L.analyse(data, roles, [{"jobname": "daily-ghe-reminders", "schedule": "0 15 * * *", "active": True}])
ok("missed window: Ann April (never done), Eve Nov 2025 and May 2026; test and inactive clients left out",
   sorted((n, m) for n, m, _ in R["missed"]) == [("Ann Missed", "2026-04"), ("Eve Rolled", "2025-11"), ("Eve Rolled", "2026-05")], R["missed"])
ok("done a month late: Cal (August window, done in September)", R["late"] == [("Cal Late", "2026-08")], R["late"])
ok("due this month: Ann's October window (Bob's is done: his form is dated Oct 2)", [n for n, _, _ in R["due"]] == ["Ann Missed"] and ("Bob Done", "2026-10") not in [(n, m) for n, m, _ in R["missed"]], R["due"])
ok("no months: Dee; rolled off: Eve; not 6 apart: Fay", R["no_months"] == ["Dee Nomonths"] and R["rolled_off"] == ["Eve Rolled"] and R["not_six"] == ["Fay Odd"], (R["no_months"], R["rolled_off"], R["not_six"]))
ok("no nurse: Cal; unlinked: Eve; on the board but not active: Fay (AxisCare 99)", R["no_nurse"] == ["Cal Late"] and R["unlinked"] == ["Eve Rolled"] and R["board_not_active"] == ["Fay Odd"])
ok("Medicaid from the lead: Ann and Kim active; Kim is not on the board", R["active_medicaid"] == ["Ann Missed", "Kim Medicaid"] and R["medicaid_not_on_board"] == ["Kim Medicaid"], (R["active_medicaid"], R["medicaid_not_on_board"]))
ok("payer unknown: active clients with no lead (Bob, Cal, Dee, Max); test person left out; 1 with no AxisCare link", R["active_unknown_payer"] == 4 and R["active_no_ax"] == 1 and R["active_total"] == 8, (R["active_unknown_payer"], R["active_no_ax"], R["active_total"]))
ok("upload clock: Ann's Sept 10 visit due Sept 24 (10 working days) and past due; Bob's Oct 2 visit due Oct 16 (10 working days comes first)",
   ("Ann Missed", "2026-09-10", "2026-09-24", True) in R["ready"] and ("Bob Done", "2026-10-02", "2026-10-16", False) in R["ready"], R["ready"])
ok("rn review, old drafts, no supervisor signature", R["rn_review"] == [("Ivy", "2026-09-20")] and R["drafts_old"] == [("Hal", "2026-09-01")] and R["forms_no_rn_sig"] == ["Bob Done"])
ok("forms by credential", R["forms_by_cred"] == {"LPN": 2, "RN": 3}, R["forms_by_cred"])
ok("nurses: Lena has no portal sign-in and an expired license; a client is assigned to a nurse not on the list",
   ("Lena LPN", "LPN", False, "EXPIRED 2026-09-01", 1) in R["nurses"] and R["rn_count"] == 1 and R["assigned_unknown_nurse"] == ["Ghost Nurse"], R["nurses"])
ok("upload_due: Friday visit Oct 30 → Nov 13 (10 working days) vs Nov 15", L.upload_due("2026-10-30") == "2026-11-13" and L.upload_due("2026-12-28") == "2027-01-11")
try: L.sql("delete from app_data"); ok("read-only guard refuses anything but a SELECT", False)
except AssertionError: ok("read-only guard refuses anything but a SELECT", True)
try: L.sql("select 1; delete from app_data"); ok("...and a SELECT with a second statement", False)
except AssertionError: ok("...and a SELECT with a second statement", True)
L.report(R); txt = "\n".join(L.lines)
ok("the report prints without phone numbers or emails", "rita@x.com" not in txt and "Kim Medicaid" in txt and "PAST DUE" in txt)
for n, c, d in R_: print(("PASS  " if c else "FAIL  ") + n + ("" if c else "  " + str(d)[:400]))
p = sum(1 for _, c, _ in R_ if c); print(f"\n{p} passed, {len(R_) - p} failed"); sys.exit(0 if p == len(R_) else 1)
