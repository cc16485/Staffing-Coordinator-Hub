#!/usr/bin/env python3
# 378 · READ ONLY: where are the pre-hire proofs in GoHighLevel, and can the Hub pull them? (Samantha 2026-10-01: "yes make the read only look")
# Part 1: the read-only helper is the reviewed build. Part 2: puts up the TEMPORARY read-only helper (ghl-docs-probe; owner
# key only, checked inside). Part 3: asks it once, prints field names / counts / answer codes only, then DELETES
# the probe and confirms it's gone. Nothing is written anywhere; every GoHighLevel request is a read.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "ghl-docs-probe"; lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-378/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src(name): return os.path.join(FNROOT, name + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
def remove_probe():
    s, _ = http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    s2, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    (say if s2 == 404 else bad)(("  ✓ " if s2 == 404 else "") + f"the temporary helper is removed" + ("" if s2 == 404 else f" (still there: {s2}). Tell Claude."))

say("378 · PRE-HIRE PROOFS IN GOHIGHLEVEL (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for name, want in SHAS.items():
    if sha(src(name)) != want: bad(f"{name} is not the reviewed build. Nothing was run."); done(2)
if set(SHAS) != {FN, "_shared/job-auth"}: bad("the reviewed list is incomplete"); done(2)
say("  ✓ the read-only helper is the reviewed build")
say(); say("PART 2 · PUT UP THE TEMPORARY HELPER")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=REPO,
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("couldn't put it up: " + (p.stderr or p.stdout)[-200:]); done(4)
say("  ✓ up (it checks for the owner key itself)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
say(); say("PART 3 · THE ANSWER")
a = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a == 401 else bad)(("  ✓ " if a == 401 else "") + f"it refuses the public key ({a})")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b)
except Exception: j = {}
if s != 200 or not j.get("ok"):
    bad(f"the probe didn't answer as expected ({s}): " + str(j.get("error") or b)[:200])
else:
    say(f"  GoHighLevel's answer for the contact fields list: {j['custom_fields_answer']}")
    say(f"  Hub caregivers looked up: {j['hub_caregivers']} · found in GoHighLevel: {j['matched_in_ghl']} · no phone or email in the Hub: {j['no_phone_or_email']} · not found: {j['not_found']}")
    say(""); say("  FILE FIELDS on the contact (where uploads usually live):")
    if not j["file_fields"]: say("    none: this account has no file fields")
    for f in j["file_fields"]: say(f"    {f['name']} · {f['caregivers_with_it']} caregiver(s) have a file · stored as {f['stored_as']}")
    say(f"  Caregivers with a file in any of them: {j['with_any_file_field']}")
    if j.get("uploads_found_without_names"):
        say("  UPLOADS FOUND ON CONTACTS (field names hidden from the Hub's key; hints come from the FILE names):")
        for u in j["uploads_found_without_names"]:
            say(f"    {u['field']} · {u['caregivers_with_it']} caregiver(s) · file names look like: " + ", ".join(f"{k} {v}" for k, v in u['file_names_look_like'].items()))
    if j.get("media_library_latest_100"): say("  MEDIA LIBRARY latest 100 files, by name: " + ", ".join(f"{k} {v}" for k, v in j["media_library_latest_100"].items()))
    if j["doc_like_text_fields"]: say("  Other fields that sound like checks (text or dates, not files): " + ", ".join(f"{f['name']} ({f['type']})" for f in j["doc_like_text_fields"]))
    say(""); say("  CAN THE HUB DOWNLOAD THEM? (one sample per field; only the answer code, never the file)")
    if not j["download_tests"]: say("    no file to test")
    for t in j["download_tests"]: say(f"    {t['field']}: with the Hub's key {t['with_key']} · without a key {t['without_key']} · type {t.get('type','')} · stored at {t['host']}")
    n = j["notes"]; c = j["conversations"]
    say(""); say(f"  NOTES with a document link: {n['doc_link_notes']} note(s) on {n['caregivers_with_doc_links']} caregiver(s) (answer {n['answer']})")
    say(f"  CONVERSATIONS (first {c['checked']} caregivers): {c['attachments']} PDF/photo attachment(s) on {c['with_pdf_or_image_attachments']} caregiver(s)")
    say(f"  MEDIA LIBRARY: the Hub's key gets {j['media_library_answer']} (200 = can read it; 401/403 = no permission)")
remove_probe()
say(); say("RESULT: " + ("DONE · read only; the helper is gone. Tell Claude it's done." if not fails else "CHECK THE ✗ LINES."))
done(0 if not fails else 8)
