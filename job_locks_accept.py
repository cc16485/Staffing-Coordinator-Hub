#!/usr/bin/env python3
# J1/J2 · which live copies may be replaced (run by Claude, not a Desktop step). Writes job_locks_accept.json.
# For each job: the file set it deploys (index.ts plus every _shared file it imports, followed through the shared
# files' own imports), and for each file the GitHub versions that are acceptable to find running live:
#   index.ts     · only the version on main before this change (BASE). The job's own code must be exactly GitHub.
#   _shared/*.ts · the BASE version, or the version at the commit the job was last deployed from. A job carries the
#                  shared helpers from the day it was deployed; those older copies were reviewed (2026-09-29) and
#                  differ only in ways the job does not use (register lines, comments, the 0b-3 opt-out refactor,
#                  new helpers). Anything else found live is a stop.
import json, re, subprocess, hashlib, sys
BASE = sys.argv[1] if len(sys.argv) > 1 else 'origin/main'
DEPLOYED_FROM = {   # the commit each job was last deployed from (Desktop reports; read-only reviews 2026-09-29)
    'lead-nurture': '4ad619c', 'lead-followup': '43ff5a6', 'ghe-reminders': 'e108ff4', 'carematch-watch': 'd9494c5',
    'interview-messages': 'd9494c5', 'coverage-run': 'd9494c5', 'timekeeper-watch': 'd9494c5', 'lead-digest': 'a517b54',
    'automation-watchdog': '104a92e', 'purge-recordings': 'b535ee2', 'lead-docs-retention': '085b7de',
    'coverage-watch': '6fa9e26', 'client-status-observe': 'defc682', 'client-status-review': 'a958c2c',
    'launch-evidence': 'da89ed1', 'client-start-run': '9499516', 'promise-run': 'c812cc7', 'caregiver-census-observe': '7dfd209',
}
FN = 'supabase/functions/'
def show(commit, rel):
    p = subprocess.run(['git', 'show', f'{commit}:{FN}{rel}'], capture_output=True)
    return p.stdout if p.returncode == 0 else None
def closure(commit, fn):
    out = {}; todo = [f'{fn}/index.ts']
    while todo:
        rel = todo.pop()
        if rel in out: continue
        b = show(commit, rel)
        if b is None: continue
        out[rel] = hashlib.sha256(b).hexdigest()
        base_dir = rel.rsplit('/', 1)[0]
        for m in re.finditer(rb"""from\s+['"](\.{1,2}/[^'"]+\.ts)['"]""", b):
            p = m.group(1).decode()
            parts = (base_dir + '/' + p).split('/'); st = []
            for x in parts:
                if x == '.': continue
                if x == '..': st.pop(); continue
                st.append(x)
            todo.append('/'.join(st))
    return out
acc = {}
for fn, dep in DEPLOYED_FROM.items():
    b, d = closure(BASE, fn), closure(dep, fn)
    if f'{fn}/index.ts' not in b: raise SystemExit(f'{fn}: no index.ts at {BASE}')
    files = {}
    for rel in sorted(set(b) | set(d)):
        # the job's own code: only BASE. a shared helper: BASE, or the copy from its last deploy (null when absent)
        files[rel] = {'base': b.get(rel), 'deploy': None if rel.endswith('/index.ts') else d.get(rel)}
    acc[fn] = {'deployed_from': dep, 'files': files, 'only_at_deploy': sorted(set(d) - set(b)), 'only_at_base': sorted(set(b) - set(d))}
    if d.get(f'{fn}/index.ts') != b[f'{fn}/index.ts']:
        print(f'  note: {fn} index.ts at {dep} differs from {BASE}: live must equal {BASE} or it stops')
json.dump(acc, open('job_locks_accept.json', 'w'), indent=1, sort_keys=True)
print('wrote job_locks_accept.json for', len(acc), 'jobs')
