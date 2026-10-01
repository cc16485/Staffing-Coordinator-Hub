#!/usr/bin/env python3
# 381 · PRE-HIRE PROOFS FROM GOHIGHLEVEL INTO THE HUB. Samantha approved 2026-10-01 ("yes to all").
# Part 1: reviewed builds. Part 2: ghl_docs_import.sql (the prehire_docs record); puts up ghl-docs-import (owner key only).
# Part 3: PRACTICE over everyone (reads only): per person, which of EDL / OIG / FCSR / Checkr / reference uploads it would
#   copy, and where the Hub already has its own document. Part 4: only if you type y, the REAL import (files into the
#   Hub's private storage, one record each). Then the import step is taken down again. Never: SSN cards, birth
#   certificates, I-9 documents. The Hub's own caregiver/candidate records are not written.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "ghl-docs-import"; lines = []; fails = []; HIDE = []
LABEL = {"edl": "EDL", "oig": "OIG", "fcsr": "FCSR", "checkr": "Checkr", "ref_pro_1": "Pro ref 1", "ref_pro_2": "Pro ref 2", "ref_pro_3": "Pro ref 3", "ref_personal_1": "Personal ref 1", "ref_personal_2": "Personal ref 2"}
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=170):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-381/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src(n): return os.path.join(REPO, n) if n.endswith(".sql") else (os.path.join(FNROOT, n + ".ts") if n.startswith("_shared/") else os.path.join(FNROOT, n, "index.ts"))
def take_down():
    http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    s, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    (say if s == 404 else bad)(("  ✓ " if s == 404 else "") + "the import step is taken down again" + ("" if s == 404 else f" (still there: {s})"))
def sweep(mode, SVC):
    off, people, fields = 0, [], []
    while off is not None:
        s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"mode": mode, "offset": off, "limit": 8}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
        try: j = json.loads(b)
        except Exception: j = {}
        if s != 200 or not j.get("ok"): bad(f"the {mode} pass stopped at person {off} ({s}): " + str(j.get("error") or b)[:160]); return people, fields, False
        people += j["people"]; fields = j["fields_found"]; off = j["next"]
        print(f"    … {min(len(people), j['total_people'])} of {j['total_people']}", flush=True)
    return people, fields, True

say("381 · PRE-HIRE PROOFS FROM GOHIGHLEVEL"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for n, w in SHAS.items():
    if sha(src(n)) != w: bad(f"{n} is not the reviewed build. Nothing was run."); done(2)
if set(SHAS) != {FN, "_shared/job-auth", "ghl_docs_import.sql"}: bad("the reviewed list is incomplete"); done(2)
say("  ✓ the reviewed builds")
say(); say("PART 2 · SET UP")
ok, r = sql("begin;\n" + open(src("ghl_docs_import.sql")).read() + "\ncommit;")
if not ok: bad("the record didn't go in: " + str(r)[:200]); done(4)
say("  ✓ the imported-documents record is in place")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("couldn't put up the import step: " + (p.stderr or p.stdout)[-200:]); done(4)
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a == 401 else bad)(("  ✓ " if a == 401 else "") + f"the import step refuses the public key ({a})")
say(); say("PART 3 · PRACTICE (reads only; nothing copied)")
people, fields, ok = sweep("practice", SVC)
if not ok: take_down(); done(6)
say("  GoHighLevel fields found: " + ", ".join(LABEL.get(f, f) for f in fields))
would = 0
for pr in people:
    if not pr["matched"]: say(f"  · {pr['who']} ({pr['kind']}): {pr.get('why','not matched')}"); continue
    parts = []
    for c in pr["checks"]:
        if c["state"] == "would import": would += 1
        parts.append(LABEL.get(c["check"], c["check"]) + ("*" if c["hub_has_doc"] else "") + (f" [{c['result']}]" if c["result"] else "") + ("" if c["state"] == "would import" else f" ({c['state']})"))
    say(f"  {pr['who']} ({pr['kind']}): " + (", ".join(parts) if parts else "nothing in those fields"))
say(f"  → {would} file(s) would be copied. * = the Hub already has its own document for that check (the Hub's stays the one shown).")
say()
ans = os.environ.get("SB_AUTO", "") or input("  Copy these into the Hub now? Type y and Enter (anything else stops): ").strip().lower()
if ans not in ("y", "yes"): say("  · stopped after the practice pass; nothing was copied"); take_down(); say(); say("RESULT: PRACTICE ONLY · nothing copied. Run 381 again when ready."); done(0)
say(); say("PART 4 · THE REAL IMPORT")
people, fields, ok = sweep("live", SVC)
imp = sum(1 for pr in people for c in pr.get("checks", []) if c["state"] == "imported")
skp = [(pr["who"], c["check"], c["state"]) for pr in people for c in pr.get("checks", []) if c["state"] not in ("imported", "already imported")]
say(f"  ✓ {imp} file(s) copied into the Hub's private storage")
for w, c, st in skp[:30]: say(f"  · {w}: {LABEL.get(c, c)} {st}")
ok2, cnt = sql("select count(*)::int as n from public.prehire_docs")
if ok2: say(f"  the imported-documents record now holds {cnt[0]['n']} file(s)")
take_down()
say(); say("RESULT: " + ("DONE · the files are in the Hub's storage. They show on profiles once the Hub update that reads them is merged (Claude)." if not fails else "CHECK THE ✗ LINES."))
done(0 if not fails else 8)
