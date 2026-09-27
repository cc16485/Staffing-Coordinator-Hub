#!/usr/bin/env python3
# 0b-1 · contact-optout.sql in a disposable Postgres. Never touches production.
import os, json, hashlib
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIG = open(os.path.join(H, "contact-optout.sql")).read()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-500:]))
c = Cluster("cop"); P = setup_supabase_like(c); s = c.su
rc, out = c.psql(MIG.replace("do $verify$", "select 1/0;\ndo $verify$", 1))
ck("an injected failure leaves nothing behind", rc != 0 and s.run("select to_regclass('public.contact_optout')")[0][0] is None, out[-200:])
rc, out = c.psql(MIG); rc2, out2 = c.psql(MIG)
ck("installs, and reinstalls while empty; the self-check records a test opt-out through the door and undoes it, leaving nothing", rc == 0 and rc2 == 0 and s.run("select count(*) from contact_optout")[0][0] == 0, (out + out2)[-300:])
svc = c.conn("service_role"); au = c.conn("authenticated"); an = c.conn("anon")
J = lambda r: r if isinstance(r, dict) else json.loads(r)
REC = lambda a, ch, src_="staff", ev="Daughter asked us to stop texting", st="krystal@mo-care.com", conn=svc: J(conn.run("select public.contact_optout_record(:a,:c,:s,:e,:t)", a=a, c=ch, s=src_, e=ev, t=st)[0][0])
REV = lambda a, ch, ev="Called back and asked to hear from us again", st="krystal@mo-care.com": J(svc.run("select public.contact_optout_revoke(:a,:c,:e,:t)", a=a, c=ch, e=ev, t=st)[0][0])
cur = lambda: [list(r) for r in s.run("select address, channel, opted_out, source from contact_optout_current order by 1,2")]
ck("addresses are normalised: phones to +1XXXXXXXXXX, emails lower-cased", REC("(417) 555-0101", "sms")["address"] == "+14175550101" and REC(" Dana@X.com ", "email")["address"] == "dana@x.com")
ck("the same opt-out from the same source is not written twice", REC("417-555-0101", "sms")["outcome"] == "already_opted_out" and s.run("select count(*) from contact_optout")[0][0] == 2)
bad = [REC("12", "sms"), REC("4175550101", "fax"), REC("4175550101", "sms", ev=" "), REC("a@b.com", "sms"), REC("4175550101", "email")]
ck("refusals: unusable address, unknown channel, no evidence, and a channel that doesn't fit the address", [b["outcome"] for b in bad] == ["invalid_address", "invalid_channel", "evidence_and_staff_required", "channel_address_mismatch", "channel_address_mismatch"], bad)
ck("'all' blocks every channel for one address", REC("4175550202", "all", src_="stop_text", ev="Replied STOP")["outcome"] == "recorded")
r = REV("4175550101", "sms")
ck("opting back in needs a person and evidence, and is kept as history (not a deletion)", r["outcome"] == "revoked" and ["+14175550101", "sms", False, "staff"] in cur() and s.run("select count(*) from contact_optout where address='+14175550101'")[0][0] == 2, (r, cur()))
ck("you can't opt back in something that isn't opted out", REV("4175550999", "sms")["outcome"] == "not_opted_out")
svc.run("select public.contact_send_refusal_log('lead-intake','sms','417-555-0202', cast(:r as jsonb))", r=json.dumps(["opted out (stop_text, all)"]))
ck("a refused send is logged with its reasons", s.run("select sender, channel, address, reasons::text from contact_send_refusal")[0] == ["lead-intake", "sms", "+14175550202", '["opted out (stop_text, all)"]'])
ck("append-only: no update, delete or truncate on either table", all(err_code(f) is not None for f in [lambda: s.run("update contact_optout set opted_out=false"), lambda: s.run("delete from contact_optout"),
   lambda: s.run("truncate contact_optout"), lambda: s.run("delete from contact_send_refusal"), lambda: s.run("update contact_send_refusal set sender='x'")]))
ck("signed-in staff can read, but cannot write or use the doors; the public key gets nothing",
   err_code(lambda: au.run("select count(*) from contact_optout_current")) is None
   and (err_code(lambda: au.run("insert into contact_optout(address,channel,opted_out,source,evidence,recorded_by) values ('+14175550000','sms',true,'hub','x','x')")) or "").startswith("42501")
   and (err_code(lambda: REC("4175550303", "sms", conn=au)) or "").startswith("42501")
   and (err_code(lambda: an.run("select count(*) from contact_optout")) or "").startswith("42501"))
rc, out = c.psql(MIG)
ck("once anything is recorded, a reinstall refuses and changes nothing", rc != 0 and "refused" in out and s.run("select count(*) from contact_optout")[0][0] == 4, out[-200:])
for x in (svc, au, an): x.close()
c.close()
print("\n0b-1 · CONTACT OPT-OUT RECORD · DISPOSABLE PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("contact-optout.sql sha256:", hashlib.sha256(MIG.encode()).hexdigest())
