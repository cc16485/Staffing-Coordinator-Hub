import fs from 'fs'
const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
const src = fs.readFileSync('supabase/step1-before-checks.sql', 'utf8'); const m = /execute \$q\$([\s\S]*?)\$q\$;/.exec(src)
await db.exec(m[1])
const q = async (f) => (await db.query(`select public.evidence_field_kept('caregivers', '${f}') as k`)).rows[0].k
const before = [await q('ojt_date'), await q('ojt_online_proof')]
await db.exec(fs.readFileSync('evidence-training-fields.sql', 'utf8'))
const after = { ojt_date: await q('ojt_date'), ojt_signed: await q('ojt_signed'), ojt_proof: await q('ojt_proof'), ojt_online_proof: await q('ojt_online_proof'), ethics_date: await q('ethics_date'), casenet_date: await q('casenet_date'), ssn: await q('ssn'), orient_recorded_by: await q('orient_recorded_by') }
await db.exec(fs.readFileSync('evidence-training-fields.sql', 'utf8'))
await db.exec(fs.readFileSync('evidence-training-fields-rollback.sql', 'utf8'))
const rb = [await q('ojt_date'), await q('ojt_online_proof'), await q('casenet_date')]
const ok = before[0] === false && before[1] === true && after.ojt_date && after.ojt_signed && after.ojt_proof && after.ojt_online_proof && after.ethics_date && after.casenet_date && after.ssn === false && rb[0] === false && rb[1] === true && rb[2] === true
console.log(JSON.stringify({ before, after, rb }), ok ? 'PASS' : 'FAIL')
