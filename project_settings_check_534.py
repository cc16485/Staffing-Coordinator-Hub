#!/usr/bin/env python3
# 534 · PROJECT SETTINGS CHECK, READ ONLY (Samantha 2026-10-08): encryption in transit, multi-factor sign-in, backups and
# restore points, storage buckets and their rules, the rules on the settings and event-log tables, and the scheduled jobs,
# for BOTH projects (the Hub and the Training Platform). Everything is a GET to Supabase's management API or a SELECT; nothing
# is written, no key is printed (the access token is hidden in the report), no password is asked for.
# Encryption at rest is not a setting a project can read: Supabase states every project's disks are encrypted (AES-256);
# this report says so and asks for it to be confirmed in writing rather than claiming to have measured it.
import os, json
os.environ.setdefault("SB_STEP", "534")
from cc_step_lib import *
PROJECTS = [("zngsgedlsxinbygwmxwn", "the Hub project (Care Coordinator, Staffing, Owners Hub)"), ("rdqujxiycycwhskyvrwa", "the Training Platform project")]
OWNERS = ["samantha@mo-care.com", "zach@mo-care.com"]
start("PROJECT SETTINGS CHECK (read only)")
def get(path):
    s, b = http("GET", f"{API}{path}", headers=MG())
    try: return s, (json.loads(b) if b and b[:1] in "[{" else b)
    except Exception: return s, b
def rows(ref, q, label):
    ok_, r = sql(ref, q)
    if not ok_: say(f"  · {label}: could not read ({str(r)[:90]})"); return None
    return r
for REF, name in PROJECTS:
    say(f"PROJECT · {name}")
    s, p = get(f"/v1/projects/{REF}")
    say(f"  ✓ project {p.get('name')} in {p.get('region')}, status {p.get('status')}") if s == 200 and isinstance(p, dict) else bad(f"could not read the project ({s})")
    # in transit
    s, e = get(f"/v1/projects/{REF}/ssl-enforcement")
    enf = (e.get("currentConfig") or {}).get("database") if isinstance(e, dict) else None
    say(f"  {'✓' if enf else '·'} database connections: SSL enforced = {enf} (the Hub pages and functions use HTTPS either way; this is about direct database clients)") if s == 200 else say(f"  · SSL enforcement could not be read ({s})")
    say("  · encryption at rest: Supabase states every project's disks are encrypted (AES-256); not a per-project setting, confirm in writing with Supabase for the security file")
    # multi-factor and sign-in settings
    s, a = get(f"/v1/projects/{REF}/config/auth")
    if s == 200 and isinstance(a, dict):
        keys = ["mfa_totp_enroll_enabled", "mfa_totp_verify_enabled", "mfa_max_enrolled_factors", "disable_signup", "password_min_length", "password_required_characters", "sessions_timebox", "sessions_inactivity_timeout", "refresh_token_rotation_enabled", "jwt_exp", "security_captcha_enabled", "rate_limit_token_refresh"]
        say("  ✓ sign-in settings: " + ", ".join(f"{k}={a.get(k)}" for k in keys if k in a))
        say(f"  {'✓' if a.get('disable_signup') else '✗'} public sign-up is {'off' if a.get('disable_signup') else 'ON (anyone could create an account)'}")
        say(f"  {'✓' if a.get('mfa_totp_enroll_enabled') else '·'} authenticator-app multi-factor enrolment is {'allowed' if a.get('mfa_totp_enroll_enabled') else 'not enabled on the project (owners cannot enrol a second factor until it is)'}")
    else: say(f"  · auth settings could not be read ({s})")
    r = rows(REF, "select lower(u.email) as email, count(f.id) filter (where f.status = 'verified') as factors, max(u.last_sign_in_at)::text as last_sign_in from auth.users u left join auth.mfa_factors f on f.user_id = u.id where lower(u.email) in (" + ",".join(lit(o) for o in OWNERS) + ") group by 1 order by 1", "owner accounts")
    if r is not None:
        for o in OWNERS:
            m = next((x for x in r if x["email"] == o), None)
            say(f"  {'✓' if m and int(m['factors'] or 0) > 0 else '✗'} {o}: " + (f"{m['factors']} verified second factor(s), last sign-in {str(m['last_sign_in'])[:10]}" if m else "no account in this project"))
    r = rows(REF, "select count(*) as n from auth.users", "accounts"); say(f"  ✓ {r[0]['n']} accounts in this project") if r else None
    # backups
    s, b = get(f"/v1/projects/{REF}/database/backups")
    if s == 200 and isinstance(b, dict):
        bl = b.get("backups") or []
        say(f"  {'✓' if b.get('pitr_enabled') else '·'} point-in-time recovery: {b.get('pitr_enabled')}; daily backups on file: {len(bl)}" + (f", newest {str((bl[-1] or {}).get('inserted_at'))[:16]} ({(bl[-1] or {}).get('status')})" if bl else ", NONE (the plan may not include backups: that is a decision for Samantha)"))
    else: say(f"  · backups could not be read ({s}: {str(b)[:80]})")
    # storage buckets and their rules
    r = rows(REF, "select id, public, file_size_limit, coalesce(array_to_string(allowed_mime_types, ','), '(any)') as types from storage.buckets order by 1", "storage buckets")
    if r is not None:
        for x in r: say(f"  {'✗' if x['public'] else '✓'} bucket {x['id']}: {'PUBLIC (anyone with a link can read)' if x['public'] else 'private'}, size limit {x['file_size_limit'] or '(none)'}, types {x['types']}")
        if not r: say("  · no storage buckets")
    r = rows(REF, "select policyname, cmd, array_to_string(roles, ',') as roles, coalesce(qual, '') as using_rule from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1", "storage rules")
    if r is not None:
        say(f"  ✓ {len(r)} rule(s) on storage objects:"); [say(f"      · {x['policyname']} ({x['cmd']}, {x['roles']}): {x['using_rule'][:110]}") for x in r]
    # the settings record and the event log: who may write, who may change or delete
    r = rows(REF, "select tablename, policyname, cmd, array_to_string(roles, ',') as roles, permissive from pg_policies where schemaname = 'public' and tablename in ('app_data', 'op_events', 'job_offers', 'persons', 'staff_roles', 'auth_identities') order by 1, 3, 2", "table rules")
    if r is not None:
        by = {}
        for x in r: by.setdefault(x["tablename"], []).append(f"{x['cmd']}:{x['policyname']}[{x['roles']}]")
        for t, ps in by.items(): say(f"  ✓ {t}: " + "; ".join(ps)[:400])
    r = rows(REF, "select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs from information_schema.role_table_grants where table_schema = 'public' and table_name = 'op_events' group by 1 order by 1", "event log grants")
    if r is not None:
        g = {x["grantee"]: x["privs"] for x in r}
        ap = g.get("authenticated", "")
        say(f"  {'✓' if ('UPDATE' not in ap and 'DELETE' not in ap) else '✗'} event log (op_events): signed-in staff may {ap or 'do nothing'}; " + ("append-only for staff" if ('UPDATE' not in ap and 'DELETE' not in ap) else "staff could change or delete history: to tighten before Slice 2"))
    r = rows(REF, "select relname, relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' and relname in ('app_data', 'op_events', 'job_offers', 'persons', 'staff_roles', 'auth_identities', 'hire_intake', 'caregivers') order by 1", "row security")
    if r is not None: say("  ✓ row security on: " + ", ".join(f"{x['relname']}={'yes' if x['rls'] else 'NO'}" for x in r))
    # scheduled jobs and the backup files
    r = rows(REF, "select jobname, schedule, active from cron.job order by 1", "scheduled jobs")
    if r is not None:
        say(f"  ✓ {len(r)} scheduled job(s): " + ", ".join(f"{x['jobname'] or '(unnamed)'} [{x['schedule']}{'' if x['active'] else ', OFF'}]" for x in r)[:600])
    r = rows(REF, "select name, created_at::text as at from storage.objects where bucket_id = 'backups' order by created_at desc limit 3", "backup files")
    if r is not None: say("  ✓ newest files in the backups bucket: " + (", ".join(f"{x['name']} ({x['at'][:16]})" for x in r) or "none"))
    say()
say("What this report does not cover: the Supabase plan (read it on the dashboard's Billing page), and the encryption-at-rest statement, which is documentation, not a measurement.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE (each is a finding, not a failure of this step)"); done(0)
say("RESULT: DONE · read only, nothing changed."); done(0)
