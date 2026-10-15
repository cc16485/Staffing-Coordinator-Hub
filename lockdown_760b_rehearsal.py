# 760b · REHEARSAL (nothing live). On a throwaway local Postgres shaped like the hub project: shows what every
# kind of login can open before the change, runs lockdown_760b.sql, shows it again, proves the server path and the
# functions still WORK (not only refuse), then runs the undo and proves today's behaviour is back exactly.
# python3 lockdown_760b_rehearsal.py
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from access_760_fixture import make, U
from pg8000.native import Connection, DatabaseError
c, sock = make()
# identify_caller as the source file defines it: runs as the caller, so row rules apply
c.run("drop function public.identify_caller(text)")
c.run("""create function public.identify_caller(p_phone text) returns table(person_id uuid, match_count int) language sql stable security invoker
  set search_path = public as $$ select p.person_id, (count(*) over ())::int from public.phone_index p where p.phone = right(regexp_replace(p_phone, '\\D', '', 'g'), 10) $$""")
c.run("grant execute on function public.identify_caller(text) to authenticated")
c.run("alter view public.identity_completeness owner to postgres")
c.run("grant all on public.app_data, public.app_data_key_hub_map to service_role; grant select on public.identity_completeness to service_role; grant execute on function public.identify_caller(text) to service_role")
CHANGE, BACK = (open(os.path.join(HERE, f)).read() for f in ("lockdown_760b.sql", "lockdown_760b_rollback.sql"))

PEOPLE = {"Samantha (owner)": (U["sam"], "real"), "Krystal (coordinator)": (U["kry"], "real"),
          "Angiel, staffing list only": (U["ang"], ["staffing"]), "Angiel, staffing + care coordinating": (U["ang"], ["staffing", "care_coordinator"]),
          "RN review only": (U["lone"], "real"), "new login, no record, blank list": ("00000000-0000-0000-0000-0000000007b0", None),
          "new login, no record, Care Coordinator list": ("00000000-0000-0000-0000-0000000007b1", ["care_coordinator"])}
def look(uid, hubs, role="authenticated"):
    cc = Connection(user="postgres", database="postgres", unix_sock=sock)
    try:
        if hubs == "real":
            md = json.loads(cc.run("select raw_app_meta_data::text from auth.users where id = :u", u=uid)[0][0])
        else: md = {"hub_access": hubs} if hubs is not None else {}
        cc.run("begin")
        cc.run("select set_config('request.jwt.claims', :c, true), set_config('request.jwt.claim.sub', :s, true)",
               c=json.dumps({"sub": uid, "role": role, "app_metadata": md}), s=uid or "")
        cc.run(f"set local role {role}")
        keys = [r[0] for r in cc.run("select key from public.app_data order by key")]
        ident = cc.run("select count(*) from public.phone_index")[0][0]
        view = cc.run("select persons from public.identity_completeness")[0][0]
        caller = cc.run("select count(*) from public.identify_caller('(417) 555-0100')")[0][0]
        cc.run("rollback"); return {"keys": keys, "ident": ident, "view": view, "caller": caller}
    finally: cc.close()
def table(tag):
    out = {}
    for name, (uid, hubs) in PEOPLE.items(): out[name] = look(uid, hubs)
    print(f"\n{tag}")
    for n, r in out.items():
        print(f"  {n:42} keys {len(r['keys'])}/9  leads {'yes' if 'leads' in r['keys'] else 'no ':3}  phone_index rows {r['ident']}  "
              f"summary view {r['view']}  caller lookup {r['caller']}")
    return out
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:300]))

before = table("TODAY")
ck("today: a new login with a blank list opens leads and every identity row",
   "leads" in before["new login, no record, blank list"]["keys"] and before["new login, no record, blank list"]["ident"] == 2)

# step 0 must come first: a staff login with a blank list is refused
try: c.run(CHANGE); ck("refuses while Krystal's list is blank", False, "it ran")
except DatabaseError as e: ck("refuses while Krystal's list is blank", "blank hub list" in str(e), e); c.run("rollback")
ck("refusal changed nothing", c.run("select count(*) from pg_policies where policyname like '%_office_read'")[0][0] == 0)
c.run("update auth.users set raw_app_meta_data = raw_app_meta_data || '{\"hub_access\": [\"care_coordinator\", \"staffing\", \"team_hub\"]}' where id = :u", u=U["kry"])
c.run(CHANGE)
after = table("AFTER 760b (Krystal given an explicit list first)")
a = after
ck("owner keeps everything", a["Samantha (owner)"] == before["Samantha (owner)"])
ck("Krystal keeps her keys and identity", len(a["Krystal (coordinator)"]["keys"]) == 6 and a["Krystal (coordinator)"]["ident"] == 2 and a["Krystal (coordinator)"]["caller"] == 2)
ck("Krystal no longer opens the server-only key", "calls_cache" not in a["Krystal (coordinator)"]["keys"] and "calls_cache" in before["Krystal (coordinator)"]["keys"])
ck("new blank login opens nothing", a["new login, no record, blank list"] == {"keys": [], "ident": 0, "view": 0, "caller": 0})
ck("RN review only opens nothing", a["RN review only"] == {"keys": [], "ident": 0, "view": 0, "caller": 0})
ck("no staff record + CC list: identity closed", a["new login, no record, Care Coordinator list"]["ident"] == 0 and a["new login, no record, Care Coordinator list"]["view"] == 0)
ck("GAP kept on purpose: no staff record + CC list still opens leads (app_data checks the list, not the role)",
   "leads" in a["new login, no record, Care Coordinator list"]["keys"])
ck("Angiel staffing only: no identity (the open question)", a["Angiel, staffing list only"]["ident"] == 0 and a["Angiel, staffing list only"]["caller"] == 0)
ck("Angiel staffing + care coordinating: identity works", a["Angiel, staffing + care coordinating"]["ident"] == 2 and a["Angiel, staffing + care coordinating"]["caller"] == 2)
ck("server (service_role) unchanged", look(None, None, "service_role")["ident"] == 2 and len(look(None, None, "service_role")["keys"]) == 9)
ck("no sign-in (postgres jobs) still reads as before", c.run("select public.jwt_hub_access() is null")[0][0] is True)
ck("functions still WORK for office: desk_is_owner true for Samantha", (lambda cc: (cc.run("begin"), cc.run("select set_config('request.jwt.claims', :c, true), set_config('request.jwt.claim.sub', :s, true)",
   c=json.dumps({"sub": U["sam"], "role": "authenticated", "app_metadata": {"hub_access": ["care_coordinator"]}}), s=U["sam"]), cc.run("set local role authenticated"),
   cc.run("select public.desk_is_owner()")[0][0])[-1])(Connection(user="postgres", database="postgres", unix_sock=sock)) is True)
c.run(CHANGE)
ck("safe to run twice", c.run("select count(*) from pg_policies where policyname like '%_office_read'")[0][0] == 5)

c.run(BACK)
c.run("update auth.users set raw_app_meta_data = raw_app_meta_data - 'hub_access' where id = :u", u=U["kry"])
back = table("AFTER THE UNDO (and Krystal's list blank again)")
ck("undo restores today exactly", back == before, {k: (before[k], back[k]) for k in before if before[k] != back[k]})
for n, ok, d in res: print(("PASS " if ok else "FAIL ") + n + (("  " + d) if d else ""))
print(f"{sum(ok for _, ok, _ in res)}/{len(res)}")
sys.exit(0 if all(ok for _, ok, _ in res) else 1)
