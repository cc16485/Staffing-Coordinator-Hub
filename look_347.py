#!/usr/bin/env python3
# Desktop 347 · READ ONLY · two looks, nothing changed or sent. Counts and yes/no only: no name, email, number or note.
# A · TEAM ACCESS A0 (the Sept 28 plan, approved 2026-09-29): is the invite function there; how many access changes it
#     has recorded; do sign-in emails go through our own mail or Supabase's built-in sender (limited, spam-prone); is
#     cc.mo-care.com an allowed return address for invitation links; how many on the Team Hub's old list have no
#     sign-in; how many sign-ins have each hub.
# B · SHIFT-NOTE FLAGS (N2, live since 2026-09-29 06:27 UTC): how many notes were flagged, by kind, urgent, "could not
#     read", still open vs closed and how staff closed them, and how many families were told. Decides whether "something
#     else worth a look" needs tightening.
import json, os, re, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-347/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q})
    if s not in (200, 201): return None
    try: return json.loads(b)
    except Exception: return None
arr = lambda k: f"case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end"

say("347 · TWO READ-ONLY LOOKS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("A · TEAM ACCESS (the check before My Team gives every hub)")
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/hub-access")
say(f"  · the invite function (hub-access): {'deployed' if s == 200 else 'NOT found (' + str(s) + ')'}")
r = sql(f"""select count(*)::int as n, max(x->>'at') as last from app_data a, jsonb_array_elements({arr('a')}) x where a.key = 'admin_audit'""")
say(f"  · access changes it has recorded: {r[0]['n'] if r else '?'}" + (f", the last on {str(r[0]['last'])[:10]}" if r and r[0]['last'] else ""))
s, b = http("GET", f"{API}/v1/projects/{REF}/config/auth")
try: cfg = json.loads(b) if s == 200 else {}
except Exception: cfg = {}
if not cfg: bad("could not read the sign-in settings")
else:
    smtp = bool(cfg.get("smtp_host")); allow = str(cfg.get("uri_allow_list") or ""); site = str(cfg.get("site_url") or "")
    say(f"  · sign-in emails (invitations, password resets) go through: {'our own mail server (custom SMTP)' if smtp else 'Supabase’s built-in sender (a few an hour, often spam)'}"
        + (f" · sender limit {cfg.get('rate_limit_email_sent')} an hour" if cfg.get('rate_limit_email_sent') is not None else ""))
    ok_return = "cc.mo-care.com" in allow or "cc.mo-care.com" in site
    say(f"  · cc.mo-care.com is {'an allowed' if ok_return else 'NOT an allowed'} return address for invitation links" + ("" if ok_return else " (invitations would land on the default site instead)"))
    say(f"  · new sign-ups: {'OFF (only invitations)' if cfg.get('disable_signup') else 'ON'} · email confirmation required: {'no' if cfg.get('mailer_autoconfirm') else 'yes'}")
r = sql(f"""select count(*)::int as n,
              count(*) filter (where not exists (select 1 from auth.users u where lower(u.email) = lower(x->>'email')))::int as no_signin,
              count(*) filter (where coalesce(x->>'status','') <> 'active')::int as not_active
            from app_data a, jsonb_array_elements({arr('a')}) x where a.key = 'user_hub_access_directory'""")
say(f"  · the Team Hub's old list: {r[0]['n']} people · {r[0]['no_signin']} have no sign-in at all · {r[0]['not_active']} not marked active" if r else "  · the Team Hub's old list: could not read")
r = sql("""select count(*)::int as users,
             count(*) filter (where u.raw_app_meta_data->'hub_access' ? 'care_coordinator')::int as cc,
             count(*) filter (where u.raw_app_meta_data->'hub_access' ? 'staffing')::int as st,
             count(*) filter (where u.raw_app_meta_data->'hub_access' ? 'team_hub')::int as th,
             count(*) filter (where jsonb_typeof(u.raw_app_meta_data->'hub_access') is distinct from 'array')::int as no_list,
             count(*) filter (where u.email_confirmed_at is null and u.last_sign_in_at is null)::int as never_accepted
           from auth.users u""")
if r: say(f"  · sign-ins: {r[0]['users']} · Care Coordinator Hub {r[0]['cc']} · Staffing Hub {r[0]['st']} · Team Hub {r[0]['th']} · with no hub list {r[0]['no_list']} · invited and never accepted {r[0]['never_accepted']}")
else: bad("could not count the sign-ins")

say(); say("B · SHIFT-NOTE FLAGS (since they went live)")
r = sql(f"""select x->>'title' as title, x->>'urgency' as urgency, x->>'status' as status, x->>'resolution_code' as how,
              (x->>'detail') like '%%could not read this note%%' as unread, jsonb_array_length(coalesce(x->'family_contacts','[]'::jsonb)) as told
            from app_data a, jsonb_array_elements({arr('a')}) x where a.key = 'ops_items' and x->>'kind' = 'care_note'""")
if r is None: bad("could not read the flags")
else:
    kinds = {}; closed = {}; open_n = 0; urgent = 0; unread = 0; told = 0
    for x in r:
        k = str(x["title"] or "").split("visit: ")[-1] or "?"
        kinds[k] = kinds.get(k, 0) + 1
        if x["urgency"] == "high": urgent += 1
        if x["unread"]: unread += 1
        if (x["told"] or 0) > 0: told += 1
        if x["status"] == "open": open_n += 1
        else: closed[x["how"] or "closed, no reason"] = closed.get(x["how"] or "closed, no reason", 0) + 1
    say(f"  · flagged notes: {len(r)} · urgent {urgent} · the AI couldn't read {unread} · still open {open_n} · families told about {told}")
    if kinds: say("  · by kind: " + ", ".join(f"{k} {n}" for k, n in sorted(kinds.items(), key=lambda y: -y[1])))
    if closed: say("  · how staff closed them: " + ", ".join(f"{k.replace('_', ' ')} {n}" for k, n in sorted(closed.items(), key=lambda y: -y[1])))
    se = kinds.get("something else worth a look", 0)
    if r: say(f"  · \"something else worth a look\" is {round(100 * se / len(r))}% of flags" + (" · worth tightening if most of those were closed with nothing to do" if se else ""))
b2 = sql(f"""select x->>'at' as at, x->>'note' as note from app_data a, jsonb_array_elements({arr('a')}) x where a.key = 'automation_heartbeats' and x->>'id' = 'hb_care-notes-flag'""")
if b2: say(f"  · the flagging run last ran {str(b2[0]['at'])[:16].replace('T', ' ')} UTC: {b2[0]['note']}")
say()
say("RESULT: " + ("DONE · read only; nothing was changed or sent." if not fails else "CHECK THE ✗ LINES."))
done(0 if not fails else 8)
