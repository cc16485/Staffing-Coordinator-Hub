#!/usr/bin/env python3
# Desktop 355 · the PRN CNA ad and pay statement: $20 for the PRN Team, $18 only as a short note for anyone who'd
# like to switch to taking an ongoing client. One pay track at a time (Samantha, 2026-09-29).
# Part 1 (read only): the reviewed build; the PRN role and posting are there; how many applications accepted the
#   older wording (counts only; theirs is kept as it was).
# Part 2: prn_wording.sql in one transaction.
# Part 3: read back as the public site sees it. Sends nothing. Prints counts only.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; REPO = os.environ["SB_REPO"]; SHAS = json.loads(os.environ["SB_FILE_SHAS"])
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-355/1.0"}, **(headers or {})))
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

say("355 · THE PRN CNA AD: $20 FIRST, $18 AS A NOTE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    p = os.path.join(REPO, name)
    if not os.path.exists(p) or sha(p) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if "prn_wording.sql" not in SHAS: bad("the reviewed list is incomplete"); done(2)
say("  ✓ the new wording is the reviewed build")
ok, st = sql("""select (select track from public.job_positions where key = 'prn_cna') as track,
  (select position from public.job_postings where slug = 'prn-cna-springfield') as post_position,
  (select count(*) from public.job_applicants where pay_ack_version = 'PRN-PAY-2026-09')::int as old_acks,
  (select count(*) from public.job_applicants where position = 'prn_cna' and completed_at is not null)::int as prn_apps""")
if not ok or not st: bad("could not read the database. Nothing was changed."); done(4)
S0 = st[0]
if S0["track"] != "prn" or S0["post_position"] != "prn_cna": bad("the PRN role or posting isn't there as expected. Nothing was changed."); done(4)
say(f"  ✓ the PRN role and the posting are there · PRN applications sent so far: {S0['prn_apps']} · of those, {S0['old_acks']} accepted the older wording (kept as they accepted it)")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "prn_wording.sql")).read() + "\ncommit;")
if not ok: bad("the change didn't go in, and was undone as a whole: " + str(r)[:240]); done(6)
say("  ✓ the ad and the pay statement are updated")

say(); say("PART 3 · PROOF (as the public site sees it)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON = keys.get("anon", ""); HIDE.append(ANON); H = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1, b1 = http("GET", f"{FNB}/rest/v1/job_positions?key=eq.prn_cna&select=pay_ack,pay_ack_version", None, H)
s2, b2 = http("GET", f"{FNB}/rest/v1/job_postings?slug=eq.prn-cna-springfield&select=description,summary,status", None, H)
try: role = (json.loads(b1) or [{}])[0] if s1 == 200 else {}
except Exception: role = {}
try: post = (json.loads(b2) or [{}])[0] if s2 == 200 else {}
except Exception: post = {}
g = role.get("pay_ack") == "I understand that Caring Companions PRN CNA Team members are paid $20/hour." and role.get("pay_ack_version") == "PRN-PAY-2026-09B"
(say if g else bad)(("  ✓ " if g else "") + "the application's pay box now reads: \"…PRN CNA Team members are paid $20/hour.\" (version PRN-PAY-2026-09B)")
d = post.get("description") or ""
g = post.get("status") == "published" and d.startswith("Start PRN. Stay flexible.") and "$20 an hour" in d and d.count("$18") == 1 \
    and d.rstrip().endswith("our CNAs are paid $18 an hour.") and "pickups" not in d and "stay on the PRN Team for" not in d
(say if g else bad)(("  ✓ " if g else "") + "the ad: opens \"Start PRN. Stay flexible.\", $20 an hour, and $18 appears once, as the note at the bottom")
say()
say("RESULT: " + ("DONE · the job page on mo-care.com shows the new wording at its next build (Claude can start it straight away)." if not fails else "CHECK THE ✗ LINES."))
done(0 if not fails else 8)
