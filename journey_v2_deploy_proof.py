import os, json, subprocess, sys, copy, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
EXPF=os.path.join(H,"journey-v2-expected.json"); EXPD=json.load(open(EXPF))
res=[]
def run_deploy(cl, migfile=MIG_PATH, expfile=EXPF, tag="x"):
    rep=os.path.join(H,f"deploy_report_{tag}.txt")
    env=dict(os.environ, SB_MIGFILE=migfile, SB_EXPECTED=expfile, SB_FPFILE=os.path.join(H,"journey-foundation-v2-fingerprint.sql"),
             SB_PARTSFILE=os.path.join(H,"journey-foundation-v2-parts.sql"), SB_REPORT=rep, SB_LOCAL_SOCK=cl.sock)
    p=subprocess.run(["python3",os.path.join(H,"journey_v2_deploy.py")],env=env,capture_output=True,text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout+p.stderr)
def fresh(tag):
    c=Cluster(tag); setup_supabase_like(c); c.psql("begin;\n"+PHASEA+"\ncommit;\n"); return c
def ck(n,c,note=""): res.append((n,bool(c),"" if c else note))

c=fresh("d1"); o=outside_fp(c)
rc,rep=run_deploy(c,tag="d1")
ck("deploy · clean run: migration once, every verification line passes, fingerprint identical",
   rc==0 and "DEPLOYED AND VERIFIED" in rep and "✓ identical to the proven build" in rep and journey_fp(c)==EXPD["fingerprint"], rep[-1500:])
ck("deploy · Journey tables empty and nothing outside Journey changed", "✓ all empty" in rep and outside_fp(c)==o
   and "non-Journey definitions ✓ identical" in rep and "row counts  ✓ identical" in rep, rep[-800:])
c.close()

c=fresh("d2"); c.su.run("insert into episode_door_audit (op, outcome) values ('void','existing row')"); fa=journey_fp(c)
rc,rep=run_deploy(c,tag="d2")
ck("deploy · non-empty foundation: the guard stops it, nothing repaired, Phase A unchanged",
   rc==4 and "STOPPED" in rep and "refused" in rep and "UNCHANGED" in rep and journey_fp(c)==fa, rep[-800:])
c.close()

c=fresh("d3"); fa=journey_fp(c)
bad=os.path.join(H,"tampered.sql"); open(bad,"w").write(open(MIG_PATH).read()+"\n-- edited\n")
rc,rep=run_deploy(c,migfile=bad,tag="d3")
ck("deploy · a different migration file is refused before anything runs",
   rc==2 and "not the proven migration" in rep and journey_fp(c)==fa, rep[-500:])
os.remove(bad); c.close()

# a server that renders one index differently (same object, different text)
e4=copy.deepcopy(EXPD); i=next(k for k,p in enumerate(e4["parts"]) if p.startswith("index|journey_episode|journey_episode_person_ix|"))
e4["parts"][i]=e4["parts"][i].replace("USING btree","USING  btree"); e4["fingerprint"]="rendered-differently"
f4=os.path.join(H,"exp_render.json"); json.dump(e4,open(f4,"w"))
c=fresh("d4"); rc,rep=run_deploy(c,expfile=f4,tag="d4")
ck("deploy · rendering-only differences are compared by component and flagged for review, not passed or failed",
   rc==0 and "rendering of the SAME named" in rep and "needs a look" in rep, rep[-1200:])
c.close()

# a genuinely different build (one Door's source differs)
e5=copy.deepcopy(EXPD); i=next(k for k,p in enumerate(e5["parts"]) if p.startswith("function|episode_void("))
f=e5["parts"][i].split("|"); f[2]="0"*32; e5["parts"][i]="|".join(f); e5["fingerprint"]="different-build"
f5=os.path.join(H,"exp_subst.json"); json.dump(e5,open(f5,"w"))
c=fresh("d5"); rc,rep=run_deploy(c,expfile=f5,tag="d5")
ck("deploy · a substantive difference (a Door's source) fails verification",
   rc==5 and "SUBSTANTIVE" in rep and "VERIFICATION FAILED" in rep, rep[-1200:])
c.close()
for f in (f4,f5): os.remove(f)

print("\nDEPLOY SCRIPT · DISPOSABLE PROOF\n"+"="*60)
ok=True
for n,g,note in res:
    ok&=g; print(("PASS  " if g else "FAIL  ")+n+(("\n   └─ "+note) if note else ""))
print("="*60); print(("ALL %d PROOFS PASS"%len(res)) if ok else "SOME FAILED")
