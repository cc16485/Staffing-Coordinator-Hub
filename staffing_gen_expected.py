import os, json, hashlib
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
SFP=os.path.join(H,"staffing-foundation.sql")
c=Cluster("stexp"); setup_supabase_like(c)
c.psql("begin;\n"+PHASEA+"\ncommit;\n"); assert c.psql(MIG)[0]==0; rc,out=c.psql(open(SFP).read()); assert rc==0,out
parts=[f"{k}|{p}" for k,p in c.su.run(open(os.path.join(H,"staffing-foundation-parts.sql")).read())]
fp=c.su.run(open(os.path.join(H,"staffing-foundation-fingerprint.sql")).read())[0][0]
jfp=journey_fp(c)
json.dump({"fingerprint":fp,"parts":parts,"migration_sha256":hashlib.sha256(open(SFP,"rb").read()).hexdigest(),"journey_fingerprint":jfp},
          open(os.path.join(H,"staffing-expected.json"),"w"),indent=0)
from collections import Counter
print(fp, len(parts), dict(Counter(p.split("|")[0] for p in parts)), "journey", jfp)
c.close()
