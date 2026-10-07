#!/usr/bin/env python3
# 488 · THEY SAID YES (Leads intake desk, Stage 3; Samantha 2026-10-06: "move them directly from Leads into the Client Journey,
# no confirmation screen, carry everything, record the event, land on the first incomplete required step, safely reversible").
#  · the catalog gains ONE step: signed.yes "Family chose Caring Companions" (Signed stage, confirmed by a person, quiet: no My Work
#    card, it is the family's move). The signed documents and the AxisCare client now hang off the yes instead of the assessment outcome.
#  · deploys client-journey with the said_yes / undo_yes actions (and the shared journey-rules.js + lead-rules.js it reads).
#  · existing journeys are untouched: a journey past the assessment keeps working; the yes step simply appears as ready on it.
# Nothing is texted or emailed. Nothing in AxisCare or GHL changes. The client journeys switch is not touched.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); CJDIR = os.path.join(ROOT, "client-journey"); FN = "client-journey"
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-488/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="cc488-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

say("488 · THEY SAID YES (one step on the client journey, and the actions behind the button)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(CJDIR, name.split("/", 1)[1]) if name.startswith("client-journey/") else os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    have = sha(p_) if os.path.exists(p_) else "(missing)"
    chk(have == want, f"{name} is the reviewed build" if have == want else f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); say("  RESULT: STOPPED before anything changed."); done(2)
cat = json.load(open(os.path.join(CJDIR, "catalog-v1.json")))
yes = next((s for s in cat["steps"] if s["key"] == "signed.yes"), None)
hang = {s["key"]: s["after"] for s in cat["steps"] if s["key"] in ("docs.agreement", "docs.rights", "docs.assessment", "ax.client")}
chk(yes is not None and yes.get("quiet") is True and yes["after"] == ["intake.payer"] and all("signed.yes" in a for a in hang.values()), "the catalog on disk has the yes step (quiet, after the payer) and the four steps that hang off it")
ok1, r1 = sql("select key, (def->>'title') as title, def->'after' as after from public.client_journey_step_def where key in ('signed.yes','docs.agreement','docs.rights','docs.assessment','ax.client') order by key")
live = {r["key"]: r for r in (r1 or [])} if ok1 else {}
say("  live catalog: " + ("signed.yes already there" if "signed.yes" in live else "no signed.yes yet") + "; " + ", ".join(f"{k} after {json.dumps(live[k]['after'])}" for k in sorted(live) if k != "signed.yes"))
ok2, r2 = sql("select count(*)::int as n from public.client_journey where status = 'open'")
say(f"  {r2[0]['n'] if ok2 and r2 else '?'} open journeys; none are changed by this (the new step simply appears on them)")
sM, mM = fmeta(FN)
chk(sM == 200 and mM is not None, f"client-journey is live now (version {(mM or {}).get('version', '?')})")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
d = json.dumps(yes)
okw, rw = sql("insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('signed.yes', 2, " + lit(d) + "::jsonb, true, '488')"
              " on conflict (key) do update set def = excluded.def, catalog_version = 2, active = true, updated_at = now(), updated_by = '488' returning 1")
chk(okw and rw, "catalog: signed.yes \"Family chose Caring Companions\" is in")
for k, after in hang.items():
    oka, ra = sql("update public.client_journey_step_def set def = jsonb_set(def, '{after}', " + lit(json.dumps(after)) + "::jsonb), catalog_version = 2, updated_at = now(), updated_by = '488' where key = " + lit(k) + " returning 1")
    chk(oka and ra, f"catalog: {k} now comes after the yes")
if fails: say("  RESULT: STOPPED."); done(5)
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
okd, livef = live_files(FN)
good = p.returncode == 0 and okd and all(k in livef and livef[k] == sha(os.path.join(ROOT, k)) for k in need(FN))
chk(good, "client-journey deployed: the live copy is this reviewed build, every shared file included" if good else "client-journey did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
if fails: say("  RESULT: STOPPED (the catalog change above stays; the old service ignores the new step)."); done(6)
sN, mN = fmeta(FN)
chk((mN or {}).get("verify_jwt") is True, f"version {(mN or {}).get('version', '?')}, sign-in check on")

say(); say("PART 3 · PROOF")
ok3, r3 = sql("select key, def->>'quiet' as quiet, def->'after' as after from public.client_journey_step_def where key in ('signed.yes','docs.agreement','docs.rights','docs.assessment','ax.client') and active order by key")
got = {r["key"]: r for r in (r3 or [])} if ok3 else {}
chk("signed.yes" in got and got["signed.yes"]["quiet"] == "true" and all(k in got and "signed.yes" in (got[k]["after"] or []) for k in hang), "the live catalog reads back: the yes is there and quiet, the four steps hang off it")
ok4, r4 = sql("select count(*)::int as n from public.client_journey_step_def where active")
chk(ok4 and r4 and r4[0]["n"] >= len(cat["steps"]), f"{r4[0]['n'] if ok4 and r4 else '?'} active steps in the catalog ({len(cat['steps'])} on disk)")
say(); say("  RESULT: " + ("DONE · They said yes is live on the Leads board and the profile" if not fails else "DONE WITH PROBLEMS, tell Claude")); done(0 if not fails else 7)
