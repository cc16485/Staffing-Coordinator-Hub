// Supabase Edge Function: backup-verify (hub project zngsgedlsxinbygwmxwn)
// -----------------------------------------------------------------------------
// Proves the backup files can actually reconstruct data. A backup nobody has
// restored is a hope, not a safety net, and this project has already lost data
// once.
//
// It NEVER writes to a production table. The restore happens into a TEMP table
// inside one transaction, which Postgres drops on commit whatever the outcome,
// so there is no cleanup step that could be skipped and no temporary object
// left behind if this function dies halfway.
//
// For each table asked about:
//   1. download <date>/<table>.json from the backups bucket
//   2. rebuild the rows into a temp table shaped like the real one
//   3. compare row count, then an order-independent content hash
//   4. if the hashes differ, find WHICH COLUMNS differ, because "the hash did
//      not match" is not something anyone can act on
//
// app_data is checked separately: parsed, confirmed to be an array, and its
// keys compared against what is live right now.
//
// GET  /backup-verify?tables=domains,persons[&date=YYYY-MM-DD]
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const url = new URL(req.url)
  const stamp = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const wanted = (url.searchParams.get('tables') || 'domains')
    .split(',').map((s) => s.trim()).filter(Boolean)

  const out: Record<string, unknown> = { date: stamp, restore_tests: [] as unknown[] }

  try {
    // ── 1. Inventory of what is actually in this backup folder ──────────────
    const { data: listed, error: listErr } = await supabase.storage
      .from('backups').list(stamp, { limit: 500 })
    if (listErr) throw new Error(`could not list backups/${stamp}: ${listErr.message}`)

    const files = (listed ?? []).map((f) => ({
      name: f.name,
      bytes: (f as { metadata?: { size?: number } }).metadata?.size ?? 0,
    }))
    out.files = files.length
    out.partial_files = files.filter((f) => f.name.includes('.PARTIAL.')).map((f) => f.name)
    out.zero_byte_files = files.filter((f) => f.bytes === 0).map((f) => f.name)

    // ── 2. app_data: readable, an array, and the right keys ─────────────────
    const adFile = await supabase.storage.from('backups').download(`${stamp}/app_data.json`)
    if (adFile.error) {
      out.app_data = { ok: false, reason: `download failed: ${adFile.error.message}` }
    } else {
      const text = await adFile.data.text()
      let parsed: unknown = null
      let parseOk = true
      try { parsed = JSON.parse(text) } catch { parseOk = false }

      if (!parseOk || !Array.isArray(parsed)) {
        out.app_data = { ok: false, reason: parseOk ? 'not a JSON array' : 'not valid JSON' }
      } else {
        const backedKeys = (parsed as { key: string }[]).map((r) => r.key).sort()
        const { data: live } = await supabase.from('app_data').select('key')
        const liveKeys = (live ?? []).map((r: { key: string }) => r.key).sort()
        const missing = liveKeys.filter((k) => !backedKeys.includes(k))
        const emptyRows = (parsed as { key: string; data: unknown }[])
          .filter((r) => r.data === null || r.data === undefined).map((r) => r.key)
        out.app_data = {
          ok: missing.length === 0 && emptyRows.length === 0,
          bytes: text.length,
          keys_in_backup: backedKeys.length,
          keys_live: liveKeys.length,
          missing_from_backup: missing,
          keys_with_no_data: emptyRows,
        }
      }
    }

    // ── 2b. COMPLETENESS AUDIT, every table, not a sample ───────────────────
    // The sampled restore proof found a 2619-row table backed up as 1000 rows.
    // A sample can only find that by luck, so every file is now counted and
    // compared against count(*) on the live table. Estimates would have agreed
    // with the truncated file; count(*) does not.
    const { data: liveCounts, error: cntErr } = await supabase.rpc('backup_row_counts')
    if (cntErr) throw new Error(`backup_row_counts() failed: ${cntErr.message}`)
    const live: Record<string, number> = {}
    for (const r of (liveCounts ?? []) as { table_name: string; n: number }[]) {
      live[r.table_name] = Number(r.n)
    }

    const audit: { table: string; live: number; backed_up: number | string }[] = []
    const shortfall: string[] = []
    for (const f of files) {
      if (f.name === 'app_data.json') continue
      const table = f.name.replace(/\.PARTIAL/, '').replace(/\.json$/, '')
      if (!(table in live)) continue
      try {
        const dl = await supabase.storage.from('backups').download(`${stamp}/${f.name}`)
        if (dl.error) { audit.push({ table, live: live[table], backed_up: `unreadable` }); shortfall.push(table); continue }
        const parsed = JSON.parse(await dl.data.text())
        const n = Array.isArray(parsed) ? parsed.length : -1
        audit.push({ table, live: live[table], backed_up: n })
        if (n !== live[table]) shortfall.push(table)
      } catch {
        audit.push({ table, live: live[table], backed_up: 'parse failed' })
        shortfall.push(table)
      }
    }
    // A table that exists live but produced no file at all.
    for (const t of Object.keys(live)) {
      if (t === 'app_data') continue
      if (!files.some((f) => f.name === `${t}.json` || f.name === `${t}.PARTIAL.json`)) {
        audit.push({ table: t, live: live[t], backed_up: 'NO FILE' })
        shortfall.push(t)
      }
    }
    out.audit = audit.sort((a, b) => a.table.localeCompare(b.table))
    out.audit_shortfall = [...new Set(shortfall)].sort()
    out.audit_passed = shortfall.length === 0

    // ── 3. The restore proof, per table ─────────────────────────────────────
    for (const t of wanted) {
      const dl = await supabase.storage.from('backups').download(`${stamp}/${t}.json`)
      if (dl.error) {
        (out.restore_tests as unknown[]).push({ table: t, ok: false, reason: `no backup file: ${dl.error.message}` })
        continue
      }
      let rows: unknown
      try { rows = JSON.parse(await dl.data.text()) } catch {
        (out.restore_tests as unknown[]).push({ table: t, ok: false, reason: 'backup file is not valid JSON' })
        continue
      }

      const { data: result, error } = await supabase.rpc('backup_restore_test', {
        p_table: t, p_rows: rows,
      })
      if (error) {
        (out.restore_tests as unknown[]).push({ table: t, ok: false, reason: `restore failed: ${error.message}` })
        continue
      }
      const r = result as Record<string, unknown>
      ;(out.restore_tests as unknown[]).push({
        table: t,
        ok: r.rows_match === true && r.content_match === true,
        ...r,
      })
    }

    const tests = out.restore_tests as { ok: boolean }[]
    out.restore_passed = tests.length > 0 && tests.every((x) => x.ok)
                         && out.audit_passed === true
    out.success = true
    return json(out)
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : 'verify failed' }, 500)
  }
})
