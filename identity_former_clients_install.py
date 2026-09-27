#!/usr/bin/env python3
# One client profile, step 5b-A · former AxisCare clients join the hub's identity list (Desktop 262).
#  1. sha-checks the migration and identity-backfill (the reviewed builds only)
#  2. adds person_identity.birth_date (additive, rerunnable)
#  3. deploys identity-backfill with the caller lock, and proves the lock on the LIVE function:
#       the public key is refused for every mode except the nightly circles sync, which still runs
#       and gets counts only; the function still checks sign-ins (a faked key never reaches it)
#  4. previews: how many former clients would be added, with what, and anything a person should look at
#  5. asks; only a typed "yes" writes. Then proves nothing about texting changed.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
MIG = open(os.environ["SB_MIGFILE"], "rb").read(); MIG_SHA = os.environ["SB_MIG_SHA"]
FNROOT = os.environ.get("SB_FNROOT", ""); FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = FNB + "/functions/v1/identity-backfill"
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=300):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-former-clients/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
    except Exception as e: return None, ("%s: %s" % (type(e).__name__, e)).encode()
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]!r}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def keys():
    s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}
    except Exception: return {}
def call(qs, key):
    s, b = http("GET", FN + qs, None, {"Authorization": "Bearer " + key, "apikey": key})
    try: return s, json.loads(b)
    except Exception: return s, None
# the outreach gate's answer for every number on file (supabase/functions/_shared/outreach.ts maySendTo)
VERDICTS = ("select phone, case when bool_or(verification_status = 'rejected') then 'blocked' "
            "when bool_or(confidence = 'confirmed') then 'allowed' else 'blocked' end as v from public.phone_index group by phone")

say("ONE CLIENT PROFILE · STEP 5b-A · FORMER CLIENTS JOIN THE IDENTITY LIST")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
sha = hashlib.sha256(MIG).hexdigest()
say("  migration sha256 " + sha[:16] + "…" + ("  ✓ reviewed build" if sha == MIG_SHA else "  ✗ NOT the reviewed build"))
if sha != MIG_SHA: say("  STOP. Nothing was run."); done(2)
for fn, want in FN_SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
ok, r = sql(MIG.decode())
if not ok: say("  ✗ STOP: the birth-date field could not be added: " + str(r)[:300]); done(3)
say("  ✓ person records now have a birth-date field (empty until the step below)")
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "identity-backfill", "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(4)
    say("  ✓ identity-backfill deployed")
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/identity-backfill", headers={"Authorization": "Bearer " + TOKEN})
try: vj = json.loads(b).get("verify_jwt")
except Exception: vj = None
if vj is not True:
    say(f"  ✗ STOP: identity-backfill is not checking sign-ins (verify_jwt {vj!r}), so the lock could be faked. Tell Claude. The preview did not run."); done(5)
say("  ✓ the function checks every key is genuine before it runs")
k = keys(); anon, svc = k.get("anon", ""), k.get("service_role", "")
if not anon or not svc: say("  ✗ STOP: could not read the project's keys"); done(6)
bad = []
for qs in ("?clients=1", "?former_clients=1&commit=1", "?ghl_clients=1", "?grade=1", "?recover=1", ""):
    st, _ = call(qs, anon)
    if st != 403: bad.append(f"{qs or '(default)'} → HTTP {st}")
if bad: say("  ✗ STOP: the public key still reaches: " + ", ".join(bad)); done(7)
say("  ✓ the public key is now refused for every mode that writes or shows names (tried 6)")
st, d = call("?circles=1", anon)
leaks = [kk for kk, v in (d or {}).items() if isinstance(v, (str, list, dict)) and kk not in ("mode", "error")]
if st != 200 or not isinstance(d, dict) or d.get("error") or leaks:
    say(f"  ✗ STOP: the nightly Family Circle sync would break or show names (HTTP {st}: {str(d)[:200]})"); done(7)
say(f"  ✓ the nightly Family Circle sync still runs on the public key, counts only ({d.get('clients', 0)} clients read, preview)")

st, d = call("?former_clients=1", svc)
if st != 200 or not isinstance(d, dict) or d.get("error"): say(f"  ✗ the preview did not complete (HTTP {st}: {str(d)[:300]})"); done(8)
say(); say("WHAT IT WOULD ADD (preview: nothing written)")
say(f"  AxisCare client records read: {d['axiscare_clients_total']}")
say(f"  former clients not yet in the hub: {d['former_added']}  (already in the hub: {d['former_already_in_hub']})")
say(f"    with a phone number: {d['with_phone']} · with a birth date: {d['with_birth_date']} · marked deceased in AxisCare: {d['deceased']}")
say("    AxisCare's reasons: " + (", ".join(f"{kk} {v}" for kk, v in sorted(d["status_labels"].items(), key=lambda x: -x[1])) or "none"))
say(f"    end dates: {d['end_date_from_axiscare']} from AxisCare · {d['end_date_unknown']} not in AxisCare (they get today's date, and the reason says so)")
say(f"  birth dates added to people already in the hub (never replacing one): {d['birth_dates_filled']}")
say(f"  numbers someone else in the hub already has (kept side by side, marked shared): {d['phones_shared']}")
if d["phones_left_probable"]: say(f"    of those, {d['phones_left_probable']} are unconfirmed for everyone on them: they go in unconfirmed too, so nobody starts getting texts")
say("  Each one becomes a person with their name, phones and birth date, marked FORMER client, with no Journey.")
say("  Nobody is texted, and a family calling back can be recognised instead of starting over.")
if d["name_coincidences"]:
    say(); say("  SAME NAME AS SOMEONE ALREADY IN THE HUB (kept separate; a person decides if they are the same):")
    for x in d["name_coincidences"]: say(f"    • {x['name']} (AxisCare #{x['axiscare_id']})")
if d["active_without_person"]:
    say(); say("  ACTIVE IN AXISCARE BUT NOT IN THE HUB (not added here; they need a person to look):")
    for x in d["active_without_person"]: say(f"    • {x['name']} (AxisCare #{x['axiscare_id']})")
if d["skipped_not_a_person"]:
    say(); say("  LEFT OUT, NOT A PERSON:")
    for x in d["skipped_not_a_person"]: say(f"    • {x['name']} (AxisCare #{x['axiscare_id']})")
if d["skipped_no_name"]: say(f"  left out, no name in AxisCare: {d['skipped_no_name']}")
if not d["former_added"] and not d["birth_dates_filled"]: say(); say("RESULT: INSTALLED · nothing to add, everyone is already in"); done(0)
say()
try: ans = input("  Add them now? Type yes: ").strip().lower()
except EOFError: ans = ""
say(f"  answer: {ans or '(nothing)'}")
if ans != "yes": say(); say("RESULT: INSTALLED, NOTHING ADDED · the lock is on; run 262 again to add them"); done(0)
ok, before = sql(VERDICTS)
if not ok: say("  ✗ STOP: could not read who can be texted today, so nothing was added: " + str(before)[:200]); done(9)
before = {r["phone"]: r["v"] for r in before}
st, d2 = call("?former_clients=1&commit=1", svc)
if st != 200 or not isinstance(d2, dict) or d2.get("error"): say(f"  ✗ the add did not complete (HTTP {st}: {str(d2)[:300]})"); done(10)
say(f"  ✓ added {d2['former_added']} former clients · {d2['roles_added']} marked former · {d2['phones_indexed']} numbers · {d2['birth_dates_filled']} birth dates filled")
for e in d2.get("errors") or []: say("  ✗ " + e)
ok, after = sql(VERDICTS)
if not ok: say("  ✗ could not re-check who can be texted: " + str(after)[:200]); done(11)
after = {r["phone"]: r["v"] for r in after}
changed = [p for p in after if after[p] != before.get(p, "allowed")]
if changed: say(f"  ✗ WHO CAN BE TEXTED CHANGED for {len(changed)} numbers. Tell Claude today."); done(12)
say(f"  ✓ who can be texted is unchanged for all {len(after)} numbers on file")
ok, r = sql("""select count(*) filter (where status = 'former') as former, count(*) filter (where status = 'active') as active
                 from public.person_role where role = 'client'""")
if ok and r: say(f"  identity list now: {r[0]['former']} former clients · {r[0]['active']} active clients")
say(); say("RESULT: DONE · former clients are in the hub; a family calling back can now be recognised" + (" (with errors above)" if d2.get("errors") else ""))
done(0 if not d2.get("errors") else 13)
