#!/usr/bin/env python3
# T3 · RETIRE THE TRAINING KEY (Desktop 312, after the T3 Hub pull requests are merged and live)
# Part 1 (read only): the scripts are the reviewed ones; the LIVE pages no longer read, send or ask for the key (or keep
#   an AxisCare token); where the key sits today (yes/no, and which other shared records hold the same value, compared
#   inside the database); whether the unlocked axiscare-config function is deployed.
# Part 2: (a) replace the key in the Training project with a long random value nobody sees; (b) take it (and the unused
#   AxisCare-token slot) out of the three shared settings records; (c) delete axiscare-config.
# Part 3 (read back, status codes only): the key changed; no settings record holds it; axiscare-config is gone;
#   hub-training-data still turns away a caller with no sign-in.
# No key value ever leaves either database or appears in this report.
import json, os, hashlib, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); TREF = os.environ.get("SB_TRAINING_REF", "rdqujxiycycwhskyvrwa")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{TREF}.supabase.co"); HFNB = os.environ.get("SB_HUB_FN_BASE", f"https://{REF}.supabase.co")
HERE = os.path.dirname(os.path.abspath(__file__))
T_SQL = os.environ.get("SB_T_SQL", os.path.join(HERE, "training-key-retire-training.sql")); T_SHA = os.environ["SB_T_SHA"]
S_SQL = os.environ.get("SB_S_SQL", os.path.join(HERE, "training-key-retire-shared.sql")); S_SHA = os.environ["SB_S_SHA"]
PAGES = json.loads(os.environ.get("SB_PAGES", json.dumps({
    "Care Coordinator Hub": "https://cc.mo-care.com/index.html", "its caregiver engine": "https://cc.mo-care.com/caregivers-engine.js",
    "Staffing Hub": "https://sc.mo-care.com/index.html", "Team Hub": "https://hub.mo-care.com/index.html",
    "offer page": "https://hub.mo-care.com/offer.html", "Owners Hub": "https://hub.mo-care.com/owners.html", "Team Hub admin": "https://hub.mo-care.com/admin.html"})))
GONE = ["Paste the Training Hub read key", 'id="set_training_hub_key"', 'id="settings-training-key"', 'id="cfg_training_hub_key"',
        "key:CONFIG.training_hub_key", "hubKey()", "growthKey()", "window._hubKey", "localStorage.setItem('own_thk'",
        'id="set_axiscare_token"', 'id="cfg_axiscare_token"', "missing the training key"]
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def api(ref, path, method="GET", body=None):
    req = urllib.request.Request(API + f"/v1/projects/{ref}" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-t3/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return e.code, None
    except Exception: return None, None
def sql(ref, q):
    st, out = api(ref, "/database/query", "POST", {"query": q}); return st in (200, 201), out
def call(method, path, body=None, headers=None, base=None):
    req = urllib.request.Request((base or FNB) + path, data=body, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-t3/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None
def page(url):
    try:
        req = urllib.request.Request(url + ("&" if "?" in url else "?") + "t3=" + dt.datetime.now().strftime("%H%M%S"), headers={"User-Agent": "cc-t3/1.0", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=60) as r: return r.read().decode(errors="replace")
    except Exception: return None
yn = lambda b: "yes" if b else "no"
KEYS_Q = """select
  coalesce((select data ? 'training_hub_key' from public.app_data where key='cc_hub_config' and jsonb_typeof(data)='object'), false) as cc_key,
  coalesce((select length(nullif(btrim(data->>'axiscare_token'),'')) from public.app_data where key='cc_hub_config' and jsonb_typeof(data)='object'), 0) as cc_token_len,
  coalesce((select data ? 'axiscare_token' from public.app_data where key='cc_hub_config' and jsonb_typeof(data)='object'), false) as cc_token_slot,
  coalesce((select data ? 'training_hub_key' from public.app_data where key='settings' and jsonb_typeof(data)='object'), false) as st_key,
  exists (select 1 from public.app_data a, jsonb_array_elements(a.data) e where a.key='team_hub_settings' and jsonb_typeof(a.data)='array'
          and jsonb_typeof(e)='object' and e ? 'training_hub_key') as th_key"""

say("T3 · RETIRE THE TRAINING KEY"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
bad = False
for label, path, want in (("the Training key replacement", T_SQL, T_SHA), ("the shared settings cleanup", S_SQL, S_SHA)):
    got = hashlib.sha256(open(path, "rb").read()).hexdigest() if os.path.exists(path) else ""
    say(("  ✓ " if got == want else "  ✗ ") + f"{label} is the reviewed script"); bad = bad or got != want
if bad: say("  STOP. Nothing was run."); done(2)
for label, url in PAGES.items():
    src = page(url)
    if src is None: say(f"  ✗ could not read the live {label}"); bad = True; continue
    left = [g for g in GONE if g in src]
    say(("  ✓ " if not left else "  ✗ ") + f"the live {label} no longer reads, sends or asks for the key" + ("" if not left else f" (still has {len(left)} trace(s))"))
    bad = bad or bool(left)
if bad: say("  STOP. The live pages are not all updated yet (GitHub Pages can take a few minutes). Nothing was changed. Run this again shortly."); done(3)
ok, t = sql(TREF, "select md5(coalesce(value->>'key','')) as fp, coalesce(length(value->>'key'),0) as len from public.app_settings where key='hub_read_key'")
if not ok or not t: say("  ✗ could not read the Training project's key. Nothing was changed."); done(4)
before_fp = t[0]["fp"]; say(f"  ✓ the Training project's key is set ({t[0]['len']} characters; not shown)")
ok, k = sql(REF, KEYS_Q)
if not ok or not k: say("  ✗ could not read the shared settings. Nothing was changed."); done(4)
k = k[0]
say(f"  where it sits today · Care Coordinator Hub settings: {yn(k['cc_key'])} · Staffing Hub settings: {yn(k['st_key'])} · Team Hub settings: {yn(k['th_key'])}")
say(f"  an AxisCare token in the Care Coordinator Hub settings: {yn(k['cc_token_len'])}" + (f" ({k['cc_token_len']} characters; not shown)" if k["cc_token_len"] else ""))
ok, o = sql(REF, """with v as (select distinct x from (
    select nullif(btrim(data->>'training_hub_key'),'') x from public.app_data where key in ('cc_hub_config','settings') and jsonb_typeof(data)='object'
    union all select nullif(btrim(e->>'training_hub_key'),'') from public.app_data a, jsonb_array_elements(a.data) e
      where a.key='team_hub_settings' and jsonb_typeof(a.data)='array' and jsonb_typeof(e)='object') y where x is not null and length(x) >= 12)
  select coalesce(string_agg(distinct a.key, ', '), '') as keys from public.app_data a, v
   where a.key not in ('cc_hub_config','settings','team_hub_settings') and position(v.x in a.data::text) > 0""")
say("  other shared records holding the same value (names only): " + ((o[0]["keys"] or "none") if ok and o else "could not check"))
CFG = {"Training project": TREF, "Hub project": REF}
cfg_deployed = {p: api(r, "/functions/axiscare-config")[0] == 200 for p, r in CFG.items()}
say("  the unlocked axiscare-config function is deployed · " + " · ".join(f"{p}: {yn(d)}" for p, d in cfg_deployed.items()) + " (no page or function calls it)")

say(); say("PART 2 · CHANGE")
ok, out = sql(TREF, open(T_SQL).read())
say(("  ✓ " if ok else "  ✗ ") + "the Training key is replaced with a long random value nobody sees" + ("" if ok else ": " + str(out)[:240]))
if not ok: say("  STOP. Nothing changed (the replacement undid itself)."); done(5)
ok, out = sql(REF, open(S_SQL).read())
say(("  ✓ " if ok else "  ✗ ") + "the key (and the empty AxisCare-token slot) is out of the three shared settings records" + ("" if ok else ": " + str(out)[:240]))
if not ok: say("  STOP. The key is already replaced (so every copy is worthless); the settings records are unchanged."); done(6)
for p, r in CFG.items():
    if cfg_deployed[p]:
        st, _ = api(r, "/functions/axiscare-config", "DELETE")
        say(("  ✓ " if st in (200, 204) else "  ✗ ") + f"axiscare-config deleted from the {p} ({st})")
    else: say(f"  · axiscare-config was not deployed in the {p}; nothing to delete")

say(); say("PART 3 · CHECK (read back; status codes only)")
allok = True
ok, t = sql(TREF, "select md5(coalesce(value->>'key','')) as fp, coalesce(length(value->>'key'),0) as len from public.app_settings where key='hub_read_key'")
changed = ok and t and t[0]["fp"] != before_fp and t[0]["len"] >= 70; allok = allok and bool(changed)
say(("  ✓ " if changed else "  ✗ ") + "the Training key is a new value, so every old copy in any browser or record is worthless")
ok, k = sql(REF, KEYS_Q); k = k[0] if ok and k else {}
clean = ok and not k.get("cc_key") and not k.get("st_key") and not k.get("th_key") and not k.get("cc_token_slot"); allok = allok and bool(clean)
say(("  ✓ " if clean else "  ✗ ") + "no shared settings record holds the key or an AxisCare-token slot")
for p, r in CFG.items():
    st, _ = api(r, "/functions/axiscare-config"); s2 = call("POST", "/functions/v1/axiscare-config", b"{}", base=FNB if r == TREF else HFNB)
    gone = st == 404 and s2 in (404, None); allok = allok and gone
    say(("  ✓ " if gone else "  ✗ ") + f"axiscare-config is gone from the {p} (listing {st}, a call {s2})")
s3 = call("POST", "/functions/v1/hub-training-data?action=job_offers", b"{}")
allok = allok and s3 == 401; say(("  ✓ " if s3 == 401 else "  ✗ ") + f"hub-training-data still turns away a caller with no sign-in ({s3})")
say()
say("RESULT: " + ("RETIRED · the shared Training key is replaced, gone from shared settings, and opens nothing. Every Training call from the Hubs runs on the person's own sign-in."
                  if allok else "CHECK THE ✗ LINES."))
say("Browsers drop their saved copy the next time each Hub page loads (the copies were already worthless).")
done(0 if allok else 7)
