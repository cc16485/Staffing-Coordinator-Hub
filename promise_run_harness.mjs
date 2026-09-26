// End-to-end test of the promise-run edge function under Node: real function code, real engine file, fake database.
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url';
const FN=process.argv[2], ENGINE=process.argv[3];
let src=fs.readFileSync(FN,'utf8').replace(/^import \{ createClient \} from .*$/m,'const createClient = globalThis.__fakeCreateClient');
const tmp=path.join(path.dirname(FN)==='.'?'.':process.cwd(),'_promise_run_under_test.ts'); fs.writeFileSync(tmp,src);
const res=[]; const ck=(n,c,note)=>res.push([n,!!c,c?'':JSON.stringify(note).slice(0,600)]);
let handler=null; const env={SUPABASE_URL:'http://x',SUPABASE_SERVICE_ROLE_KEY:'k'};
globalThis.Deno={env:{get:k=>env[k]},serve:h=>{handler=h;}};
const engineSrc=fs.readFileSync(ENGINE,'utf8'); let engineOk=true;
globalThis.fetch=async(u)=>{ if(String(u).startsWith('https://cc.mo-care.com/promise-engine.js')) return engineOk?new Response(engineSrc):new Response('nope',{status:500}); throw new Error('unexpected fetch '+u); };
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
const D=k=>{const d=new Date(today+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+k); return d.toISOString().slice(0,10);};
const DB={ app_data:{ ops_settings:{}, ops_items:[{id:'manual1',status:'open',title:'someone else',created_by:'kat'}], automation_log:[] },
  start_contract_current:[{episode_id:'E1',confidence:'expected',target_date:D(9),promised_wording:'Expect to begin soon.',promised_to:'Cathy',promised_on:D(-5),commitment_owner:'kat@cc.test',owed_by:'kat@cc.test',next_update_owed_on:D(-3)},
                          {episode_id:'E2',confidence:'likely',target_date:D(20),commitment_owner:'kat@cc.test',owed_by:'kat@cc.test',next_update_owed_on:D(4)}],
  episode_review:[{review_id:'R1',kind:'boundary',seat:'owner_decision',episode_id:'E3',created_at:D(-1)+'T10:00:00Z',status:'open'}],
  journey_episode:[{episode_id:'E1',person_id:null,state:'provisional'},{episode_id:'E2',person_id:'P2',state:'established'},{episode_id:'E3',person_id:'P3',state:'established'}],
  journey_directory:[{episode_id:'E1',label:'Ruth Jones'}], person_identity:[{id:'P2',display_name:'Ann Lee'},{id:'P3',display_name:'Bo Park'}],
  person_source_id:[{person_id:'P3',source_id:'503',system:'axiscare',entity_type:'client'}], episode_source:[{episode_id:'E1',source_ref:'L1',system:'lead',role:'origin'}],
  persons:[{person_id:'pp1',primary_email:'care@cc.test'}], domains:[{code:'client_care',owner_person:'pp1',entity:'cc_ihs'}] };
const writes=[];
globalThis.__fakeCreateClient=()=>({
  from:(t)=>{ const f=[]; let single=false; const p={ select(){return p;}, eq(k,v){f.push(r=>String(r[k])===String(v));return p;}, in(k,vs){f.push(r=>vs.map(String).includes(String(r[k])));return p;},
    maybeSingle(){single=true;return p;},
    then(ok,bad){ if(t==='app_data'){ const key=(f.length?null:null); } let rows;
      if(t==='app_data'){ rows=Object.entries(DB.app_data).map(([key,data])=>({key,data})); } else rows=DB[t]||[];
      rows=rows.filter(r=>f.every(fn=>fn(r))); return Promise.resolve({data:single?(rows[0]||null):rows,error:null}).then(ok,bad);} }; return p; },
  rpc:async(name,args)=>{ if(name!=='upsert_app_data_item') throw new Error('unexpected rpc '+name); writes.push(args.target_key+':'+args.item.id+':'+(args.item.status||''));
    const arr=DB.app_data[args.target_key]=DB.app_data[args.target_key]||[]; const i=arr.findIndex(x=>x.id===args.item.id); if(i>=0) arr[i]=args.item; else arr.push(args.item); return {error:null}; }
});
await import(pathToFileURL(path.resolve(tmp)).href);
const b64u=o=>Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
const call=async(qs,role)=>{ const r=await handler(new Request('http://x/promise-run'+(qs||''),{method:'POST',headers:role?{Authorization:'Bearer h.'+b64u({role})+'.s'}:{}})); return {status:r.status, body:await r.json()}; };
const opsWrites=()=>writes.filter(w=>w.startsWith('ops_items:')); const logs=()=>writes.filter(w=>w.startsWith('automation_log:'));
let r=await call('', 'service_role');
ck('switch off: a dry run writes no work items, logs the run, and says what it WOULD create (an overdue update and an Owner / Decision review; the upcoming update is not due)',
  r.status===200&&r.body.dry===true&&opsWrites().length===0&&logs().length===1&&r.body.would_create===2
  &&r.body.create_preview.map(x=>x.id).sort().join()===['jrev_R1','prom_upd_E1_'+D(-3)].sort().join()&&r.body.rows_seen===3, r.body);
ck('the preview names the family and routes: the update to whoever owes it, the review to the seat (unassigned, client care)',
  r.body.create_preview.find(x=>x.id.startsWith('prom_upd')).owner==='kat@cc.test'&&r.body.create_preview.find(x=>x.id==='jrev_R1').owner==='(unassigned: client_care)'
  &&r.body.create_preview.find(x=>x.id.startsWith('prom_upd')).about==='Ruth Jones', r.body.create_preview);
r=await call('','anon');
ck('the scheduler (public key) gets counts only: no names, no wording', r.body.create_preview===undefined&&r.body.close_preview===undefined&&r.body.would_create===2, r.body);
DB.app_data.ops_settings={promises_live:true};
r=await call('?dry=1','service_role');
ck('?dry=1 forces a dry run even with the switch on', r.body.dry===true&&opsWrites().length===0, r.body);
r=await call('','service_role');
const upd=DB.app_data.ops_items.find(i=>i.id==='prom_upd_E1_'+D(-3));
ck('switch on: creates exactly those two items, stamped with times and history, owned as previewed',
  r.body.dry===false&&r.body.created===2&&opsWrites().length===2&&upd&&upd.created_at&&upd.history.length===1&&upd.owner==='kat@cc.test'&&upd.source.lead_id==='L1', r.body);
r=await call('','anon');
ck('a rerun creates nothing new (ids come from the source)', r.body.created===0&&opsWrites().length===2, r.body);
DB.start_contract_current[0].next_update_owed_on=D(7); DB.start_contract_current[0].last_update_at=new Date().toISOString();
DB.episode_review[0].status='resolved';
r=await call('','service_role');
const closed=DB.app_data.ops_items.filter(i=>i.status==='done').map(i=>i.id+':'+i.resolution_code).sort();
ck('logging the update and deciding the review close both items on the next run, with a note; the manual item is untouched',
  r.body.closed===2&&closed.join()===['jrev_R1:review_decided','prom_upd_E1_'+D(-3)+':promise_satisfied'].sort().join()
  &&DB.app_data.ops_items.find(i=>i.id==='manual1').status==='open', {closed, body:r.body});
engineOk=false; const before=opsWrites().length;
r=await call('','service_role');
ck('if the shared engine file cannot be loaded it stops (502), writes no work, and logs the failure',
  r.status===502&&opsWrites().length===before&&DB.app_data.automation_log.slice(-1)[0].ok===false, r);
ck('every run was logged, including dry and failed ones', DB.app_data.automation_log.length===7, DB.app_data.automation_log.length);
fs.unlinkSync(tmp);
let ok=true; console.log('\nPROMISE-RUN · END-TO-END UNDER NODE\n'+'='.repeat(60));
for(const [n,g,note] of res){ ok=ok&&g; console.log((g?'PASS  ':'FAIL  ')+n+(note?'\n   └─ '+note:'')); }
console.log('='.repeat(60)); console.log(ok?`ALL ${res.length} CHECKS PASS`:`${res.filter(x=>!x[1]).length} FAILED`); process.exit(ok?0:1);
