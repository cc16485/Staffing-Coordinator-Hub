#!/usr/bin/env python3
# 1193 · LIVE-IN CAREGIVER AGREEMENT, SIGNED ON A PHONE (Samantha 2026-10-29: "have Sheryelle and Rhonda sign the live-in
#   packet"; she approved the design the same day: "Approved. Build the live-in agreement signing as shown in the preview.")
# Part 1 (read only): the reviewed build; the private PDF store hr-docs and its keep-guard (968); the open log for documents;
#   the GoHighLevel key is set (its value is never read); Rhonda and Sheryelle are on the caregiver roster (counts only);
#   the agreement master in this build is her PDF (sha256).
# Part 2: livein_sign.sql (the signing records and their history, server only, never deleted); her 12-page PDF into hr-docs
#   as the master; deploy livein-sign.
# Part 3 (proof; practice only, nothing texted, no task): the public key can't list, start or make anything; the browser's
#   CORS check lets cc.mo-care.com call it; a practice agreement for "Test Caregiver" opens on its private link, refuses a
#   wrong name, signs end to end with a finger signature, is countersigned, and its finished PDF (13 pages) opens; Zach's and
#   Krystal's own sign-ins can't read the records directly. No link is made for Rhonda or Sheryelle: Samantha does that on
#   HR > Live-In Agreement once the Hub change is merged. Prints counts only.
import os, json, re, hashlib, urllib.request, urllib.error
os.environ.setdefault("SB_STEP", "1193")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com")
NEW = "livein-sign"
HR_EMAIL = os.environ.get("SB_HR_EMAIL", "zach@mo-care.com"); CC_EMAIL = os.environ.get("SB_CC_EMAIL", "krystal@mo-care.com")
HERE = os.path.dirname(os.path.abspath(__file__))
MASTER_FILE = os.path.join(HERE, "livein-agreement", "live-in-caregiver-agreement-rev-2026-10.pdf")
MASTER_SHA = "e35b98102d4664ce79df96168cac354b0d006783f58a78fe33d4939c40fc322c"
MASTER_PATH = "master/live-in-caregiver-agreement-rev-2026-10.pdf"
SIG = "data:image/png;base64," + open(os.path.join(HERE, "livein-agreement", "test-signature.b64")).read().strip()
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role") and got.get("anon"): return got
    return {}
def jload(b):
    try: return json.loads(b)
    except Exception: return {}
def raw(method, url, data=None, headers=None):
    """bytes in and out (the PDF upload and download)"""
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"User-Agent": "cc-1193/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=180) as r: return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read(), dict(e.headers)
    except Exception as e: return None, type(e).__name__.encode(), {}
hsha = lambda b: hashlib.sha256(b).hexdigest()

start("LIVE-IN CAREGIVER AGREEMENT")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
mb = open(MASTER_FILE, "rb").read() if os.path.exists(MASTER_FILE) else b""
if hsha(mb) == MASTER_SHA: say(f"  ✓ the agreement in this build is your 12-page PDF ({len(mb) // 1024} KB, fingerprint matches)")
else: bad("the agreement PDF in this build is not the approved one")
sN, mN = fmeta(REF, NEW)
ok, st = sql(REF, """select (select count(*) from storage.buckets where id = 'hr-docs' and public = false)::int as bucket,
  exists (select 1 from pg_trigger where tgname = 'hr_docs_keep' and not tgisinternal) as keep,
  (to_regclass('public.document_access_log') is not null) as openlog, (to_regclass('public.livein_sign') is not null) as tbl,
  (select count(*) from jsonb_array_elements(coalesce((select data from public.app_data where key = 'caregivers'), '[]'::jsonb)) c
     where lower(coalesce(c->>'first', '') || ' ' || coalesce(c->>'last', '')) in ('rhonda blakemore', 'sheryelle dunniehigh'))::int as people""")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["bucket"] != 1 or not x["keep"]: bad("the private PDF store hr-docs or its keep-guard is missing (Desktop 968)")
    if not x["openlog"]: bad("the document open log (document_access_log) is missing")
    if not fails: say(f"  ✓ the private PDF store and its keep-guard are there (968) · the document open log is there · the signing records are {'already there (an earlier run)' if x['tbl'] else 'new'} · the service is {'already there' if sN == 200 else 'new'}")
    say(f"  {'✓' if x['people'] == 2 else '·'} {x['people']} of 2 (Rhonda Blakemore, Sheryelle Dunniehigh) found on the caregiver roster" + ("" if x["people"] == 2 else ": the link still works for anyone missing, but Send can't find their phone, so you would copy the link instead"))
s_, sb_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = [y.get("name") for y in jload(sb_)] if s_ == 200 and isinstance(jload(sb_), list) else []
if ("GHL_TOKEN" in names or "GHL_API_KEY" in names) and "GHL_LOCATION_ID" in names: say("  ✓ the GoHighLevel key is set on the server (its value is never read here)")
else: bad("the GoHighLevel key is not set on the server")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the proofs need them)")
say("  · what changes: 2 new server-only tables, your PDF in the private store, 1 new service. Nothing is texted.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
CHECK = """
do $v$ begin
  if has_table_privilege('authenticated', 'public.livein_sign', 'select') or has_table_privilege('anon', 'public.livein_sign', 'select')
     or has_table_privilege('authenticated', 'public.livein_sign_event', 'select') or has_table_privilege('authenticated', 'public.livein_sign', 'update') then
    raise exception '1193 self-check: a browser role can reach the signing records'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'livein_sign_guard_t' and not tgisinternal) then raise exception '1193 self-check: the guard is missing'; end if;
end $v$;"""
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "livein_sign.sql")).read() + CHECK + "\ncommit;")
if not good: bad(f"the signing records did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the signing records are in: server only, never deleted, a signed agreement can't be changed")
OWNH = {"apikey": SVC, "Authorization": "Bearer " + SVC}
OBJ = f"{FNB}/storage/v1/object/hr-docs/{MASTER_PATH}"
s, b, _ = raw("POST", OBJ, mb, dict(OWNH, **{"Content-Type": "application/pdf", "x-upsert": "false"}))
s2, b2, _ = raw("GET", OBJ, None, OWNH)
if s2 == 200 and hsha(b2) == MASTER_SHA: say(f"  ✓ your PDF is in the private store as the master ({'just added' if s == 200 else 'already there from an earlier run'}; read back, fingerprint matches)")
else: bad(f"the master PDF is not in the private store as it should be ({s}, {s2})"); say("  RESULT: STOPPED before the deploy. The tables are in (harmless, empty). Tell Claude."); done(6)
if not deploy(REF, FNROOT, NEW, True): say("  RESULT: STOPPED at the deploy. The tables and the master are in (harmless). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (practice only: nothing texted, no task, no link for Rhonda or Sheryelle)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
URL = f"{FNB}/functions/v1/{NEW}"
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
pre = raw("OPTIONS", URL, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "apikey,authorization,content-type,x-client-info"})
allow = {k.lower(): v for k, v in pre[2].items()}.get("access-control-allow-headers", "").lower()
say("  ✓ the browser check (CORS) lets cc.mo-care.com call it with the headers the pages send") if pre[0] in (200, 204) and all(h in allow for h in ("apikey", "authorization", "content-type", "x-client-info")) else bad(f"the browser check (CORS) would block the pages ({pre[0]}: {allow})")
a1 = http("POST", URL, {"action": "list"}, VIS)[0]; a2 = http("POST", URL, {"action": "start", "name": "Rhonda Blakemore"}, VIS)[0]
a3 = http("POST", URL, {"action": "sample"}, VIS)[0]
say(f"  ✓ the public key can't list, start or make anything ({a1}, {a2}, {a3})") if a1 in (401, 403) and a2 in (401, 403) and a3 == 401 else bad(f"the public key got in ({a1}, {a2}, {a3})")
s1, b1 = http("POST", URL, {"action": "sample"}, OWNH); j1 = jload(b1); T1 = j1.get("token", ""); HIDE.append(T1)
if s1 != 200 or not T1: bad(f"the practice agreement could not be made ({s1}): {str(b1)[:200]}")
else:
    v = jload(http("POST", URL, {"action": "view", "t": T1}, VIS)[1])
    say("  ✓ the practice agreement opens on its private link: 12 pages, the pay statement, marked practice") if v.get("first") == "Test" and v.get("pages") == 12 and v.get("practice") is True and "$250.00" in str(v.get("statement", "")) and v.get("master_sha") == MASTER_SHA else bad(f"the private link did not open as it should: {str(v)[:200]}")
    sign = {"action": "sign", "t": T1, "typed_name": "Test Caregiver", "consent": True, "master_sha": v.get("master_sha"), "signature": SIG}
    w = http("POST", URL, dict(sign, typed_name="Somebody Else"), VIS)
    say("  ✓ a name that isn't theirs is refused") if w[0] == 400 else bad(f"a wrong name was not refused ({w[0]})")
    sg = http("POST", URL, sign, VIS); jg = jload(sg[1])
    say("  ✓ it signs end to end with a finger signature; their copy link comes back") if sg[0] == 200 and jg.get("copy_url") else bad(f"signing did not finish ({sg[0]}): {str(sg[1])[:200]}")
    again = http("POST", URL, {"action": "view", "t": T1}, VIS)[0]
    say("  ✓ once signed, the link stops working") if again == 404 else bad(f"the link still opened after signing ({again})")
    cs = http("POST", URL, {"action": "countersign", "id": j1.get("id"), "signature": SIG}, OWNH)
    say("  ✓ countersigned (practice): the finished PDF is written") if cs[0] == 200 else bad(f"countersigning did not finish ({cs[0]}): {str(cs[1])[:200]}")
    op = jload(http("POST", URL, {"action": "open", "id": j1.get("id")}, OWNH)[1])
    pdf = raw("GET", op.get("url") or "x", None, {})[1] if op.get("url") else b""
    pages = len(re.findall(rb"/Type\s*/Page[^s]", pdf))
    say(f"  ✓ the finished PDF opens: {pages} pages (the 12 of the agreement and the signature record)") if pdf.startswith(b"%PDF") and pages == 13 else bad(f"the finished PDF did not open as it should ({len(pdf)} bytes, {pages} pages)")
ok, ck_ = sql(REF, """select (select count(*) from public.livein_sign where practice and status = 'countersigned' and pdf_path like 'practice/%' and final_pdf_path like 'practice/%')::int as done,
  (select count(*) from public.livein_sign where not practice)::int as real""")
if ok and ck_ and ck_[0]["done"] >= 1: say(f"  ✓ {ck_[0]['done']} practice agreement(s) finished, PDFs kept privately · {ck_[0]['real']} real agreement(s) so far (you start those in the Hub)")
else: bad(f"the practice records are not as expected: {ck_}")
def probe(email):
    good, r = sql(REF, f"""do $p$ declare uid uuid; meta jsonb; res text := ''; n int; begin
      select u.id, coalesce(u.raw_app_meta_data, '{{}}'::jsonb) into uid, meta from auth.users u where lower(u.email) = {lit(email)} and u.banned_until is null;
      if uid is null then raise exception 'PROBE_RESULT:nouser=1'; end if;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      begin select count(*) into n from public.livein_sign; res := res || 'read=1;'; exception when others then res := res || 'read=0;'; end;
      raise exception 'PROBE_RESULT:%', res; end $p$;""")
    m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(r)) if not good else None
    return dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
for who, em in (("Zach", HR_EMAIL), ("Krystal", CC_EMAIL)):
    p = probe(em)
    if p is None or p.get("nouser"): say(f"  · could not test as {who} (no sign-in found); the rehearsal covers it")
    elif p.get("read") == "0": say(f"  ✓ acting as {who} (undone after): can't read the signing records directly (only through the HR page)")
    else: bad(f"acting as {who}, the signing records could be read directly")
s4, b4 = http("GET", HUB + "/livein.html", None, {})
say("  ✓ the signing page is live at cc.mo-care.com/livein.html") if s4 == 200 and "livein-sign" in b4 else say("  · the signing page is not live yet: Claude merges the Hub change next")
say("  · tested before this ran: the rules, the PDF and the service (62 checks), the pages at phone size (33), this step against a local copy of the database (livein_sign_1193_test.py).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Live-In Agreement signing is ready. Tell Claude, who merges the Hub change next. Nothing was texted.")
say("Then: HR > Live-In Agreement > Make the link, for Rhonda and for Sheryelle.")
say("Undo: Claude can remove the livein-sign service; the records and PDFs are kept by design.")
done(0)
