#!/usr/bin/env python3
# APPROVE THE NEW RULES (G2, 2026-09-29). Run as a Desktop step BEFORE the Hub change that edits a rules file merges.
# SB_RULES_APPROVE = {"<file>.js": "<sha256 of the reviewed file>", ...}  (Claude computes these from the Hub PR's files
# and writes them into the Desktop step; the step is sha-checked like every other one). SB_NOTE says which change.
# It adds each fingerprint to public.rules_approved and keeps the newest two per file (the previous version stays
# approved, so undoing a Hub change never stops the server). Prints file names and short fingerprints only.
import json, os, re, urllib.request, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
WANT = json.loads(os.environ["SB_RULES_APPROVE"]); NOTE = os.environ.get("SB_NOTE", "")[:200]
KNOWN = {"client-start.js", "promise-engine.js", "launch-evidence.js", "obligations.js", "eligibility-rules.js"}
lines = []; fails = []
def say(s=""): s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-approve/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return True, json.loads(r.read().decode())
    except Exception as e: return False, str(e)[:160]
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
say("APPROVE THE NEW RULES"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say("  for: " + (NOTE or "(no note)")); say()
if not WANT or any(f not in KNOWN or not re.fullmatch(r"[0-9a-f]{64}", h or "") for f, h in WANT.items()):
    bad("the list of files to approve isn't valid. Nothing was changed."); done(2)
ok, r = sql("select to_regclass('public.rules_approved') is not null as t")
if not ok or not r or not r[0]["t"]: bad("the approved-rules list doesn't exist yet (G2 / Desktop 345 first). Nothing was changed."); done(3)
vals = ", ".join(f"({lit(f)}, {lit(h)}, {lit(NOTE)})" for f, h in WANT.items())
ok, _ = sql(f"insert into public.rules_approved (file, sha256, note) values {vals} on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
ok2, _ = sql(f"""delete from public.rules_approved r using (select file, sha256, row_number() over (partition by file order by approved_at desc) as n
                 from public.rules_approved where file in ({', '.join(lit(f) for f in WANT)})) x
                 where r.file = x.file and r.sha256 = x.sha256 and x.n > 2""")
ok3, rows = sql(f"select file, sha256, approved_at from public.rules_approved where file in ({', '.join(lit(f) for f in WANT)}) order by file, approved_at desc")
if not (ok and ok2 and ok3): bad("the list could not be updated. Tell Claude before merging the Hub change."); done(4)
for f, h in WANT.items():
    mine = [x for x in rows if x["file"] == f]
    if mine and mine[0]["sha256"] == h: say(f"  ✓ {f}: {h[:12]} approved (newest)" + (f"; previous {mine[1]['sha256'][:12]} kept" if len(mine) > 1 else ""))
    else: bad(f"{f}: {h[:12]} is not the newest approved version")
say(); say("RESULT: " + ("DONE · now merge the Hub change; the server will run the new rules from its next run." if not fails else "CHECK THE ✗ LINES. Don't merge the Hub change yet."))
done(0 if not fails else 8)
