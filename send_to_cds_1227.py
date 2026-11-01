#!/usr/bin/env python3
# 1227 · STAFFING SERVER + CDS · SEND TO CARING CDS (2026-11-01, Samantha: "we need to be able to send leads to the CDS subaccount -
# and make sure they don't get the lead follow up that happens in the Caring Companions In-Home Senior Care subaccount in ghl")
#  1. Checks first (nothing changes): both reviewed builds are GitHub's main; the tests pass (no real data); nothing live was
#     changed by someone else; each function's gateway setting is read, so it is kept.
#  2. One new random secret, CC_HANDOFF_SECRET, set in BOTH projects (kept if both already hold the same one). Deploys:
#     CDS: cds-from-cc (new; takes a caller the Caring Companions office sends over) and cds-lead-alert (the alert text and the
#     GoHighLevel note say "Called the Caring Companions line"). Hub server: send-to-cds (new; the Send to Caring CDS button)
#     and ghl-inventory (lists workflow ids too).
#  3. Proof (nothing is sent or saved; nobody is added to CDS): cds-from-cc refuses a wrong secret and answers the right one;
#     send-to-cds refuses anyone not signed in. Then the Caring Companions GoHighLevel workflows are listed (read only) into a
#     file on the Desktop, likely lead follow-ups first, for Samantha to add the "sent to cds" filter.
# The Hub button stays off until Samantha turns it on in Settings. Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time, secrets, re
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API

HUB_REF = "zngsgedlsxinbygwmxwn"; CDS_REF = "siivpekcaryeyttszwav"
FNROOT = L.FNROOT; ROOT = L.ROOT
CDS_FNROOT = os.environ.get("SB_CDS_FNROOT", ""); CDS_ROOT = os.path.dirname(os.path.dirname(CDS_FNROOT)) if CDS_FNROOT else ""
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); CDS_SHAS = json.loads(os.environ.get("SB_CDS_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = lambda ref: os.environ.get("SB_FN_BASE_" + ref, f"https://{ref}.supabase.co")
OUT = os.environ.get("SB_WORKFLOWS_FILE", "")
SECRET = "CC_HANDOFF_SECRET"
HUB_FNS = ("send-to-cds", "ghl-inventory"); CDS_FNS = ("cds-from-cc", "cds-lead-alert")
NEW = {"send-to-cds": False, "cds-from-cc": False}   # brand new functions: gateway sign-in check off (they check for themselves)
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys(ref):
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        out = {}
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_")) and "·" not in v and "*" not in v: out[k.get("name")] = v
        if out.get("service_role") and out.get("anon"): return out
    return {}
def secret_digest(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG())
    if s != 200: return False, None
    try: arr = json.loads(b)
    except Exception: return False, None
    for x in arr if isinstance(arr, list) else []:
        if isinstance(x, dict) and x.get("name") == SECRET: return True, str(x.get("value") or "")
    return True, None
def drift(root, fnroot, fns):
    run(["git", "-C", root, "fetch", "-q", "origin", "main"])
    main = os.environ.get("SB_MAIN_REF", "origin/main")
    return [k for k in sorted({k for fn in fns for k in L.need(fnroot, fn)})
            if (lambda r: r[0] != 0 or r[1] != open(os.path.join(root, k)).read())(run(["git", "-C", root, "show", f"{main}:{k}"]))]
def main_shas(root, path, n=80):
    import hashlib
    c, o = run(["git", "-C", root, "log", "-n", str(n), "--format=%H", "origin/main", "--", path])
    out = set()
    for h in (o.split() if c == 0 else []):
        c2, o2 = run(["git", "-C", root, "show", f"{h}:{path}"])
        if c2 == 0: out.add(hashlib.sha256(o2.encode()).hexdigest())
    return out

start("STAFFING SERVER + CDS · SEND TO CARING CDS")
say("PART 1 · READ ONLY (nothing changes)")
if not CDS_FNROOT or not os.path.isdir(CDS_FNROOT): stop("the CDS build is missing", 2)
check_build(FNROOT, SHAS); check_build(CDS_FNROOT, CDS_SHAS)
d1, d2 = drift(ROOT, FNROOT, HUB_FNS), drift(CDS_ROOT, CDS_FNROOT, CDS_FNS)
if d1 or d2: stop("this isn't the same as GitHub's main yet (merge both pull requests first, or newer work landed since: " + ", ".join(d1 + d2)[:240] + ")")
ok("both reviewed builds are what is on GitHub's main (Hub server and CDS)")
if NODE:
    c, o = run([NODE, "send_to_cds_test.mjs"], cwd=ROOT)
    if c != 0 or "19/19 passed" not in o: stop("the Hub server tests failed: " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    if os.path.exists(PGLITE):
        c, o = run([NODE, "tests/from_cc_test.mjs"], cwd=CDS_ROOT, env=dict(os.environ, PGLITE=PGLITE))
        if c != 0 or "21 passed, 0 failed" not in o: stop("the CDS tests failed: " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
        ok("the tests pass (Hub server 19, CDS 21; no real data)")
    else: ok("the Hub server tests pass (19); the CDS ones need the throwaway Postgres, not on this Mac (they passed when built)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
meta = {}
for ref, fnroot, root, fns in ((HUB_REF, FNROOT, ROOT, HUB_FNS), (CDS_REF, CDS_FNROOT, CDS_ROOT, CDS_FNS)):
    for fn in fns:
        s_, m_ = fmeta(ref, fn)
        if s_ == 404 and fn in NEW: meta[fn] = NEW[fn]; ok(f"{fn} is new (not live yet)"); continue
        if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
        meta[fn] = bool(m_["verify_jwt"])
        okL, livef = L.live_files(ref, fn)
        if not okL: stop(f"couldn't read the live {fn} to compare", 3)
        foreign = [k for k in L.need(fnroot, fn) if livef.get(k) and livef.get(k) != L.sha(os.path.join(root, k)) and livef.get(k) not in main_shas(root, k)]
        if foreign: stop(f"{fn} live has code that was never on GitHub's main ({', '.join(x.replace('supabase/functions/', '') for x in foreign)[:200]}): someone else's work may be live. Tell Claude before going on.", 3)
        ok(f"{fn} live is GitHub's main (gateway sign-in check {'on' if meta[fn] else 'off'}, kept)")
HK, CK = keys(HUB_REF), keys(CDS_REF)
HANON, CANON = HK.get("anon", ""), CK.get("anon", ""); L.HIDE += [HANON, HK.get("service_role", ""), CANON, CK.get("service_role", "")]
if not HANON or not CANON: stop("couldn't read the projects' keys", 3)
a1, h1 = secret_digest(HUB_REF); a2, h2 = secret_digest(CDS_REF)
if not (a1 and a2): stop("couldn't read the secrets list of both projects", 3)
KEEP = bool(h1 and h2 and h1 == h2)
ok("the shared secret: " + ("already the same in both projects, kept" if KEEP else "a new one will be set in both projects"))

say(); say("PART 2 · CHANGE")
VALUE = None
if not KEEP:
    VALUE = secrets.token_urlsafe(48); L.HIDE.append(VALUE)
    for ref, name in ((CDS_REF, "CDS"), (HUB_REF, "Hub")):
        s, b = http("POST", f"{API}/v1/projects/{ref}/secrets", [{"name": SECRET, "value": VALUE}], MG())
        if s not in (200, 201): say(f"  ✗ could not set the secret on {name} ({s}). STOP. Run this again to finish."); L.fails.append("secret"); done(6)
    a1, h1 = secret_digest(HUB_REF); a2, h2 = secret_digest(CDS_REF)
    if not (h1 and h1 == h2): say("  ✗ the secret did not come back the same in both projects. STOP. Run this again."); L.fails.append("secret"); done(6)
    ok("the shared secret is set in both projects, the same one (its value is shown nowhere)")
for ref, fnroot, fns in ((CDS_REF, CDS_FNROOT, CDS_FNS), (HUB_REF, FNROOT, HUB_FNS)):
    for fn in fns:
        if not deploy(ref, fnroot, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (Run this again to finish.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved; nobody is added to CDS)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
s0 = http("POST", f"{FNB(CDS_REF)}/functions/v1/cds-from-cc", {"check": True}, {"apikey": CANON, "x-cc-handoff": "wrong" * 10})[0]
(ok if s0 == 401 else bad)(f"cds-from-cc refuses a wrong secret ({s0})")
if VALUE:
    s1, b1 = http("POST", f"{FNB(CDS_REF)}/functions/v1/cds-from-cc", {"check": True}, {"apikey": CANON, "x-cc-handoff": VALUE})
    (ok if s1 == 200 and '"check":true' in b1.replace(" ", "") else bad)(f"cds-from-cc answers the Hub's secret ({s1})")
else: say("  · the secret was kept from an earlier run, so its value is not on this Mac to try; the fingerprints match in both projects")
s2 = http("POST", f"{FNB(HUB_REF)}/functions/v1/send-to-cds", {"lead_id": "x"}, {"apikey": HANON, "Authorization": "Bearer " + HANON})[0]
(ok if s2 in (401, 403) else bad)(f"send-to-cds refuses anyone not signed in to the office ({s2})")

say(); say("CARING COMPANIONS GOHIGHLEVEL WORKFLOWS (read only)")
SVC = HK.get("service_role", "")
s3, b3 = http("POST", f"{FNB(HUB_REF)}/functions/v1/ghl-inventory", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
wf = None
try: wf = json.loads(b3).get("workflows")
except Exception: pass
if isinstance(wf, list):
    LIKELY = re.compile(r"lead|follow|nurture|missed|inquir|enquir|new contact|callback|call back|speed|welcome|drip|campaign|re-?engage", re.I)
    pub = [w for w in wf if str(w.get("status", "")).lower() == "published"]
    likely = [w for w in pub if LIKELY.search(w.get("name", ""))]
    rest = [w for w in pub if w not in likely]
    lines = ["Caring Companions GoHighLevel workflows, read " + time.strftime("%Y-%m-%d %H:%M") + " by Desktop step 1227 (read only, nothing changed).", "",
             "WHAT TO DO: open each workflow that follows up with a new lead, and add a filter to its trigger:",
             "  Contact Tag  does not include  sent to cds", "Then tell Claude which ones you changed (the names are enough).", "",
             f"LIKELY LEAD FOLLOW-UPS, by name ({len(likely)}):"] + [f"  {w.get('name')}   [id {w.get('id')}]" for w in likely] + ["",
             f"EVERY OTHER PUBLISHED WORKFLOW ({len(rest)}), check any that could text or email a new caller:"] + [f"  {w.get('name')}   [id {w.get('id')}]" for w in rest] + ["",
             f"Drafts not listed: {len(wf) - len(pub)}."]
    if OUT: open(OUT, "w").write("\n".join(lines) + "\n")
    ok(f"{len(pub)} published workflows listed ({len(likely)} look like lead follow-ups) in the file on your Desktop" + (" (" + os.path.basename(OUT) + ")" if OUT else ""))
else:
    err = (wf or {}).get("error") if isinstance(wf, dict) else f"answered {s3}"
    bad(f"GoHighLevel did not list the workflows: {err}. In GoHighLevel (Caring Companions sub-account) Settings > Private Integrations, "
        "add the scope 'View Workflows' to the Hub's integration, then run this step again (safe).")
say()
say("  1227: " + ("DONE. Send to Caring CDS is installed and still OFF. Next: open the workflow list on your Desktop and add the "
    "\"sent to cds\" filter to the lead follow-ups, then tell Claude \"ran 1227\" and which workflows you changed. "
    "Turn it on in Hub Settings > Send to Caring CDS (or preview it first)."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
