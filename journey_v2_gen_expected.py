import os, json, hashlib, sys
sys.argv=[sys.argv[0]]
H=os.path.dirname(os.path.abspath(__file__))
src=open(os.path.join(H,"journey_v2_proof.py")).read()
cut=src.index("# =============================================================================\n# CLUSTER 1")
exec(compile(src[:cut], "harness_defs", "exec"))
c=Cluster("expected"); setup_supabase_like(c)
c.psql("begin;\n"+PHASEA+"\ncommit;\n"); rc,out=c.psql(MIG)
assert rc==0, out
parts=[f"{k}|{p}" for k,p in c.su.run(open(os.path.join(H,"journey-foundation-v2-parts.sql")).read())]
fp=journey_fp(c)
json.dump({"fingerprint":fp,"parts":parts,"migration_sha256":hashlib.sha256(open(MIG_PATH,"rb").read()).hexdigest()},
          open(os.path.join(H,"journey-v2-expected.json"),"w"),indent=0)
from collections import Counter
print(fp, len(parts), Counter(p.split("|")[0] for p in parts))
c.close()
