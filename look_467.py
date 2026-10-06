#!/usr/bin/env python3
# Desktop 467 · READ ONLY · nothing is changed or sent. What is sitting in Needs Attention (app_data ops_items), after
# Samantha saw "54 late, no owner", three "Ashley Gruss" rows and a Sept "TEST:" item on the To talk about list (2026-10-06).
# Shows the titles the Hub already shows (and client names in them), never a note's words, a phone number or an email.
#   A · open items: how many, by kind, how late, how many with nobody on them
#   B · the same thing more than once (same kind + client + title): which, when each was made, and by what
#   C · every open item about Ashley Gruss, with what made it
#   D · TEST items, and the oldest items more than a week late
import json, os, re, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    s = re.sub(r"\(?\b\d{3}\)?[ .\-]?\d{3}[ .\-]\d{4}\b", "(a number)", s)
    print(s, flush=True); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-467/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read().decode())
    except Exception as e: return None
say("467 · WHAT IS SITTING IN NEEDS ATTENTION (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ no Supabase access token. Nothing was read."); done(2)
r = sql("select data from app_data where key = 'ops_items'")
if not r: say("✗ couldn't read Needs Attention. Nothing was changed."); done(3)
items = r[0]["data"]
if isinstance(items, str): items = json.loads(items)
items = [i for i in (items or []) if isinstance(i, dict)]
now = dt.datetime.now(dt.timezone.utc)
def t(x):
    try: return dt.datetime.fromisoformat(str(x).replace("Z", "+00:00"))
    except Exception: return None
def chi(x):
    d = t(x)
    return (d - dt.timedelta(hours=5)).strftime("%b %d %I:%M%p").replace(" 0", " ") if d else "?"
op = [i for i in items if i.get("status") == "open"]
late = lambda i: (now - t(i.get("due"))).total_seconds() / 86400 if t(i.get("due")) else None
say(f"A · OPEN ITEMS: {len(op)} open (of {len(items)} ever kept)")
nob = [i for i in op if not i.get("owner")]
say(f"  · nobody on them: {len(nob)} · late with nobody on them: {sum(1 for i in nob if (late(i) or -1) > 0)}")
b = {"not late": 0, "under a day late": 0, "1-7 days late": 0, "more than a week late": 0, "no due time": 0}
for i in op:
    d = late(i)
    b["no due time" if d is None else "not late" if d <= 0 else "under a day late" if d < 1 else "1-7 days late" if d <= 7 else "more than a week late"] += 1
say("  · " + " · ".join(f"{k}: {v}" for k, v in b.items()))
kinds = {}
for i in op: k = i.get("kind") or "?"; kinds.setdefault(k, [0, 0]); kinds[k][0] += 1; kinds[k][1] += 1 if (late(i) or 0) > 7 else 0
say("  · by kind (open, of which more than a week late):")
for k, (n, o) in sorted(kinds.items(), key=lambda x: -x[1][0]): say(f"      {k}: {n}" + (f" ({o} more than a week late)" if o else ""))
say(); say("B · THE SAME THING MORE THAN ONCE (open, same kind + client + title)")
g = {}
for i in op: g.setdefault((i.get("kind"), (i.get("about") or "").strip().lower(), (i.get("title") or "").strip().lower()), []).append(i)
dup = {k: v for k, v in g.items() if len(v) > 1}
if not dup: say("  · none")
for (k, a, ti), v in sorted(dup.items(), key=lambda x: -len(x[1])):
    say(f"  · {len(v)}× [{k}] {v[0].get('title') or v[0].get('about') or '(no title)'}")
    for i in sorted(v, key=lambda x: str(x.get('created_at'))):
        say(f"      made {chi(i.get('created_at'))} by {i.get('created_by') or i.get('opened_by') or '?'} ({i.get('opened_by') or i.get('source') or '?'}) · due {chi(i.get('due'))} · owner {(i.get('owner_name') or i.get('owner') or 'nobody').split('@')[0]} · id …{str(i.get('id'))[-18:]}")
say(); say("C · EVERY OPEN ITEM ABOUT ASHLEY GRUSS")
ash = [i for i in op if "ashley gruss" in ((i.get("about") or "") + " " + (i.get("title") or "")).lower()]
if not ash: say("  · none open now")
for i in sorted(ash, key=lambda x: str(x.get('created_at'))):
    say(f"  · [{i.get('kind')}] {i.get('title') or '(no title)'}")
    say(f"      made {chi(i.get('created_at'))} by {i.get('created_by') or '?'} ({i.get('opened_by') or i.get('source') or '?'}) · due {chi(i.get('due'))} · owner {(i.get('owner_name') or i.get('owner') or 'nobody').split('@')[0]} · id …{str(i.get('id'))[-30:]}")
say(); say("D · TEST ITEMS, AND THE OLDEST MORE THAN A WEEK LATE")
tests = [i for i in op if re.match(r"\s*test\b", (i.get("title") or ""), re.I)]
say(f"  · open items whose title starts with TEST: {len(tests)}")
for i in tests: say(f"      [{i.get('kind')}] {i.get('title')} · made {chi(i.get('created_at'))} by {i.get('created_by') or '?'}")
old = sorted([i for i in op if (late(i) or 0) > 7], key=lambda i: str(i.get('due')))
say(f"  · more than a week late: {len(old)}. The oldest 20:")
for i in old[:20]: say(f"      due {chi(i.get('due'))} · [{i.get('kind')}] {(i.get('title') or i.get('about') or '(no title)')[:90]} · owner {(i.get('owner_name') or i.get('owner') or 'nobody').split('@')[0]}")
say(); say("Nothing was changed, texted or emailed.")
done(0)
