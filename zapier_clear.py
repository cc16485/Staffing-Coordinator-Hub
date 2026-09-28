#!/usr/bin/env python3
# Z2 · CLEAR THE STORED ZAPIER ADDRESSES (Desktop 314, after the Z1 Hub pull requests are merged and live)
# Part 1 (read only): the script is the reviewed one; the LIVE pages send nothing to Zapier and have no Zapier boxes.
# Part 2: zapier-clear.sql (one self-checked transaction) takes the Zapier address fields out of the shared settings.
# Part 3 (read back): no settings record holds a Zapier address; other records that mention one are named.
# No address is ever printed.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HERE = os.path.dirname(os.path.abspath(__file__))
SQL = os.environ.get("SB_SQL", os.path.join(HERE, "zapier-clear.sql")); SQL_SHA = os.environ["SB_SQL_SHA"]
PAGES = json.loads(os.environ.get("SB_PAGES", json.dumps({
    "Care Coordinator Hub": "https://cc.mo-care.com/index.html", "its caregiver engine": "https://cc.mo-care.com/caregivers-engine.js",
    "Staffing Hub": "https://sc.mo-care.com/index.html", "Team Hub": "https://hub.mo-care.com/index.html"})))
GONE = re.compile(r"hooks\.zapier\.com|zapFire\(|fetch\(CONFIG\.access_webhook_url|fetch\(webhook|ZAPIER_AC_STATUS_WEBHOOK|settings-zapier-|set_access_webhook_url")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    req = urllib.request.Request(API + f"/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-z2/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return False, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
def page(url):
    try:
        req = urllib.request.Request(url + ("&" if "?" in url else "?") + "z2=" + dt.datetime.now().strftime("%H%M%S"), headers={"User-Agent": "cc-z2/1.0", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=60) as r: return r.read().decode(errors="replace")
    except Exception: return None
Q = """select
  exists (select 1 from public.app_data where key='settings' and jsonb_typeof(data)='object'
          and data ?| array['ac_orient_webhook','zapier_orient_webhook','zapier_attend_webhook','zapier_cand_webhook','zapier_not_hired_webhook','ac_new_client_webhook']) as st,
  exists (select 1 from public.app_data a, jsonb_array_elements(a.data) e where a.key='team_hub_settings' and jsonb_typeof(a.data)='array'
          and jsonb_typeof(e)='object' and e ? 'access_webhook_url') as th,
  (select coalesce(string_agg(key, ', ' order by key), '') from public.app_data where data::text ilike '%hooks.zapier.com%'
     and key not in ('settings','team_hub_settings')) as others"""
yn = lambda b: "yes" if b else "no"

say("Z2 · CLEAR THE STORED ZAPIER ADDRESSES"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
got = hashlib.sha256(open(SQL, "rb").read()).hexdigest() if os.path.exists(SQL) else ""
say(("  ✓ " if got == SQL_SHA else "  ✗ ") + "the cleanup is the reviewed script")
if got != SQL_SHA: say("  STOP. Nothing was run."); done(2)
bad = False
for label, url in PAGES.items():
    src = page(url)
    if src is None: say(f"  ✗ could not read the live {label}"); bad = True; continue
    left = len(GONE.findall(src))
    say(("  ✓ " if not left else "  ✗ ") + f"the live {label} sends nothing to Zapier and asks for no Zapier address" + ("" if not left else f" (still {left} trace(s))"))
    bad = bad or bool(left)
if bad: say("  STOP. The live pages are not all updated yet (GitHub Pages can take a few minutes). Nothing was changed. Run this again shortly."); done(3)
ok, r = sql(Q)
if not ok or not r: say("  ✗ could not read the shared settings. Nothing was changed."); done(4)
r = r[0]
say(f"  stored today · Staffing Hub and caregiver engine settings: {yn(r['st'])} · Team Hub settings: {yn(r['th'])}")
say(); say("PART 2 · CHANGE")
ok, out = sql(open(SQL).read())
say(("  ✓ " if ok else "  ✗ ") + "the stored Zapier addresses are out of the shared settings" + ("" if ok else ": " + str(out)[:240]))
if not ok: say("  STOP. Nothing changed (the cleanup undid itself)."); done(5)
say(); say("PART 3 · CHECK (read back)")
ok, r = sql(Q); r = r[0] if ok and r else {}
clean = ok and not r.get("st") and not r.get("th")
say(("  ✓ " if clean else "  ✗ ") + "no settings record holds a Zapier address")
say("  other shared records that mention a Zapier address (names only; left for you to look at): " + ((r.get("others") or "none") if ok else "could not check"))
say()
say("RESULT: " + ("CLEARED · nothing in the Hubs sends to Zapier, and no Zapier address is stored in shared settings." if clean else "CHECK THE ✗ LINES."))
done(0 if clean else 7)
