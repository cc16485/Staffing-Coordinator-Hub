#!/usr/bin/env python3
# Step 0 · 0b-1 · install the Hub's opt-out record (Desktop 273).
#   Part 1, READ ONLY: how the shared save function (upsert_app_data_item) treats updated_at (the question left
#     open by 272), and the opt-out signals that already exist today. Nothing is changed by Part 1.
#   Part 2: contact-optout.sql, only if it is the exact proven build (sha-checked). Additive: two new append-only
#     tables, one view, three doors. It touches no existing table, no switch, no function a sender uses.
#   Part 3: verify every object, that both tables are empty, the privileges, and that no switch moved.
# No sender uses the record yet (0b-2 and 0b-3 wire them, each after its own approval). Nothing is sent to anyone.
import json, os, hashlib, urllib.request, urllib.error, datetime as dt
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
REPORT = os.environ["SB_REPORT"]; API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
MIG = open(os.environ["SB_MIGFILE"], "rb").read(); EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
lines = []; fails = []
def say(s=""): print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-contact-optout/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode(errors='replace')[:500]}"
    except Exception as e: return False, f"{type(e).__name__}: {e}"
def obj(v): return v if isinstance(v, (dict, list)) else json.loads(v or "null")
SWITCHES = ("inquiry_ack_live", "inquiry_followups_live", "timekeeper_text_live", "timekeeper_watch_live")
def switches():
    ok, r = sql("select data from app_data where key = 'ops_settings'")
    if not ok or not r: return None
    d = obj(r[0]["data"]) or {}
    return {k: d.get(k, "(absent)") for k in SWITCHES}

say("STEP 0 · 0b-1 · THE HUB'S OPT-OUT RECORD · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)

# ── Part 1 · read only ─────────────────────────────────────────────────────────
say("PART 1 · READ ONLY · nothing is changed here")
say()
say("1a. The shared save function the hubs use (upsert_app_data_item): does it stamp updated_at?")
ok, fns = sql("""select p.oid::regprocedure::text as sig, p.prosecdef as definer, pg_get_functiondef(p.oid) as def
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'upsert_app_data_item' order by 1""")
ok2, trg = sql("""select tgname, pg_get_functiondef(tgfoid) as def from pg_trigger
                   where tgrelid = 'public.app_data'::regclass and not tgisinternal order by 1""")
if not ok or not ok2: bad("could not read the function or the app_data triggers: " + str(fns if not ok else trg)[:200])
else:
    stamping_trg = [t for t in trg if "updated_at" in (t["def"] or "").lower()]   # read each trigger's function body
    if not fns: say("  ○ no function named upsert_app_data_item exists in this database")
    for f in fns:
        stamps = "updated_at" in (f["def"] or "").lower()
        say(f"  {f['sig']} · runs as {'its owner (definer)' if f['definer'] else 'the caller (invoker)'}")
        say("  " + ("✓ it sets updated_at itself" if stamps else "○ it does NOT mention updated_at: saves through it leave updated_at unchanged"))
    say("  app_data triggers: " + (", ".join(t["tgname"] for t in trg) if trg else "none"))
    if fns and not any("updated_at" in (f["def"] or "").lower() for f in fns):
        say("  → " + ("a trigger stamps updated_at anyway: " + ", ".join(t["tgname"] for t in stamping_trg) if stamping_trg else
                     "nothing stamps updated_at on a hub save, so 'updated_at' cannot be used to find what a hub save changed. This explains the 270 false alarm; the fix is recorded for later, not made here."))
    say("  full definition (for the record):")
    for f in fns:
        for ln in (f["def"] or "").splitlines(): say("    | " + ln)
say()
say("1b. Opt-out signals that exist today (the shared check will read all of them; none are copied)")
ok, a = sql("""select count(*) filter (where (x->>'do_not_contact') = 'true')::int as dnc, count(*)::int as total
                 from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'leads'""")
say(f"  inquiries marked do-not-contact: {a[0]['dnc']} of {a[0]['total']}" if ok and a else "  ✗ inquiries: " + str(a)[:160])
if not ok: fails.append("inquiries unreadable")
ok, b = sql("select count(*) filter (where stopped_at is not null)::int as stopped, count(*)::int as total from circle_contacts")
say(f"  Family Circle contacts marked stopped: {b[0]['stopped']} of {b[0]['total']}" if ok and b else "  ✗ Family Circle: " + str(b)[:160])
if not ok: fails.append("circle_contacts unreadable")
ok, c = sql("""select count(*)::int as n from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'phone_suppress'""")
if ok and c: say(f"  suppressed numbers (the spam/sales list, not a family opt-out; reported only): {c[0]['n']}")
say("  GHL Do Not Disturb: not countable from here; the check reads it on each contact at send time")
ok, e = sql("select to_regclass('public.contact_optout') is not null as t1, to_regclass('public.contact_send_refusal') is not null as t2")
existed = ok and e and (e[0]["t1"] or e[0]["t2"])
say("  the opt-out record: " + ("already installed (a reinstall is allowed only while it is empty)" if existed else "not installed yet"))
if fails: say(); say("✗ STOP: Part 1 could not read everything. Nothing was changed."); done(2)
sw0 = switches()
if sw0 is None: say("✗ STOP: could not read ops_settings. Nothing was changed."); done(2)
say()

# ── Part 2 · install ───────────────────────────────────────────────────────────
say("PART 2 · INSTALL")
sha = hashlib.sha256(MIG).hexdigest()
say("  contact-optout.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was changed."); done(3)
ok, r = sql(MIG.decode())
if not ok:
    say("  ✗ STOPPED: the install did not complete, and it is all-or-nothing, so nothing changed:")
    say("    " + str(r)[:400]); done(4)
say("  ✓ committed. Its own self-checks passed inside the install: privileges, address normalisation, and a test")
say("    opt-out recorded through the door, read back, and undone (so the door is proven to WORK, not just to refuse)")
say()

# ── Part 3 · verify ────────────────────────────────────────────────────────────
say("PART 3 · VERIFY")
ok, v = sql("""select to_regclass('public.contact_optout') is not null as t, to_regclass('public.contact_send_refusal') is not null as l,
                      to_regclass('public.contact_optout_current') is not null as vw,
                      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                        and p.proname in ('contact_optout_record','contact_optout_revoke','contact_send_refusal_log','contact_address_norm')) as fns,
                      (select count(*)::int from public.contact_optout) as rows_optout,
                      (select count(*)::int from public.contact_send_refusal) as rows_refusal,
                      (select count(*)::int from pg_trigger where tgrelid in ('public.contact_optout'::regclass, 'public.contact_send_refusal'::regclass) and not tgisinternal) as guards""")
if not ok or not v: bad("could not read the new objects back: " + str(v)[:200])
else:
    v = v[0]
    if v["t"] and v["l"] and v["vw"] and v["fns"] == 4: say("  ✓ both tables, the current-word view, and all four functions exist")
    else: bad("missing objects: " + json.dumps(v))
    if v["rows_optout"] == 0 and v["rows_refusal"] == 0: say("  ✓ both are empty: the self-check left nothing behind")
    else: bad(f"expected empty, found {v['rows_optout']} opt-out row(s) and {v['rows_refusal']} refusal(s)")
    if v["guards"] == 4: say("  ✓ append-only guards on both tables (no edit, delete or truncate)")
    else: bad(f"expected 4 append-only guards, found {v['guards']}")
ok, pv = sql("""select has_table_privilege('anon','public.contact_optout','select') as anon_read,
                       has_table_privilege('authenticated','public.contact_optout','select') as staff_read,
                       has_table_privilege('authenticated','public.contact_optout','insert') as staff_write,
                       has_function_privilege('authenticated','public.contact_optout_record(text,text,text,text,text)','execute') as staff_door,
                       has_function_privilege('anon','public.contact_optout_record(text,text,text,text,text)','execute') as anon_door,
                       has_function_privilege('service_role','public.contact_optout_record(text,text,text,text,text)','execute') as server_door,
                       has_function_privilege('service_role','public.contact_send_refusal_log(text,text,text,jsonb)','execute') as server_log,
                       has_table_privilege('service_role','public.contact_optout_current','select') as server_read,
                       has_table_privilege('service_role','public.contact_optout','delete') as server_delete""")
if not ok or not pv: bad("could not read the privileges: " + str(pv)[:200])
else:
    p = pv[0]
    want = {"anon_read": False, "staff_read": True, "staff_write": False, "staff_door": False, "anon_door": False,
            "server_door": True, "server_log": True, "server_read": True, "server_delete": False}
    wrong = [k for k, w in want.items() if p.get(k) is not w]
    if not wrong: say("  ✓ who can do what: signed-in staff can read only; the public key gets nothing; only the server functions can record, and nobody can delete")
    else: bad("privileges not as designed: " + ", ".join(f"{k}={p.get(k)}" for k in wrong))
sw1 = switches()
if sw1 == sw0: say("  ✓ no switch moved: " + " · ".join(f"{k} {sw1[k]}" for k in SWITCHES))
else: bad(f"a switch changed while this ran: before {sw0} · after {sw1}")
say("  ○ no sender uses the record yet; nothing was sent to anyone")
say()
say("RESULT: " + ("DONE · the opt-out record is installed and empty; senders are wired in 0b-2 and 0b-3, each after your approval" if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
