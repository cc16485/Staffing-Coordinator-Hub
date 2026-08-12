// Supabase Edge Function: shared-backup (hub project zngsgedlsxinbygwmxwn)
// Weekly safety net for the shared hub database (Team + Staffing + Care
// Coordinator hubs). The July 2026 wipe incident showed how exposed app_data
// is — this snapshots EVERY app_data key plus the standalone tables to the
// private `backups` storage bucket, and emails the administrator a summary
// (with the full JSON inline when small enough for an off-site copy).
//
// Secrets: GHL_TOKEN, GHL_LOCATION_ID  ·  Optional: BACKUP_EMAIL
//
// 2026-08-10 — the table list is no longer hardcoded.
// It named three tables out of fifty-one, so Core knowledge, the recruiting
// tables and the new operating-foundation tables were all outside the safety
// net without anything saying so. It now asks the database what exists
// (backup_table_list()) and snapshots everything it finds.
//
// Tables are read with pagination, not a row limit, so size is not a reason to
// end up with half a table. .PARTIAL only ever appears if HARD_CAP is reached,
// which is a runaway guard rather than a size policy. If one ever does appear,
// it is a warning and NOT a restore point, which is why the name says so.
//
// Each table is uploaded and released before the next is read. Holding every
// table in memory before uploading any of them is how a backup dies on the
// largest table and takes the small ones down with it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// app_data is snapshotted separately in step 1, so it is not repeated here.
const SKIP = new Set(['app_data'])
const PAGE = 1_000        // PostgREST's own default ceiling. Do not raise it.
const HARD_CAP = 500_000  // runaway guard only, not a size policy

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const stamp = new Date().toISOString().slice(0, 10)

  try {
    // 1. app_data — every key, every hub, generically.
    const { data: appData, error: adErr } = await supabase.from('app_data').select('*')
    if (adErr) throw adErr
    const summary: Record<string, number | string> = {}
    for (const row of appData ?? []) {
      const d = (row as { key: string; data: unknown }).data
      summary[(row as { key: string }).key] = Array.isArray(d) ? d.length : typeof d
    }

    const files: Record<string, string> = {
      [`${stamp}/app_data.json`]: JSON.stringify(appData ?? [], null, 1),
    }

    // 2. Every table the database says exists, discovered at run time so a new
    //    table is inside the safety net the moment it is created rather than
    //    whenever someone remembers to edit this file.
    const { data: discovered, error: listErr } = await supabase.rpc('backup_table_list')
    if (listErr) throw new Error(`backup_table_list() failed: ${listErr.message}`)

    const tableCounts: Record<string, number | string> = {}
    const partial: string[] = []
    let stored = 0

    const put = async (path: string, content: string) => {
      const { error } = await supabase.storage
        .from('backups')
        .upload(path, new Blob([content], { type: 'application/json' }), { upsert: true })
      if (error) { console.error(`backup upload failed for ${path}:`, error.message); return false }
      stored++
      return true
    }

    for (const row of (discovered ?? []) as { table_name: string; order_col: string }[]) {
      const t = row.table_name
      if (SKIP.has(t)) continue
      try {
        // PAGINATED, not truncated. A .PARTIAL file is a warning, not a restore
        // point, so size is no longer a reason to have half a table.
        //
        // PAGE is 1000 because that is PostgREST's own default ceiling. Asking
        // for 5000 returns 1000 without complaining, and a loop that stops when
        // a page comes back "short" then declares a 2619-row table complete at
        // 1000 rows. That is exactly what happened on 2026-08-10, and the row
        // count audit is what caught it. So: stop on an EMPTY page, and advance
        // by what actually arrived rather than by what was asked for.
        //
        // Ordered by primary key, because unordered paging lets the server
        // return rows in a different order per request, which silently
        // duplicates some rows and drops others.
        const rows: unknown[] = []
        let from = 0, truncated = false
        for (;;) {
          let q = supabase.from(t).select('*').range(from, from + PAGE - 1)
          if (row.order_col) q = q.order(row.order_col, { ascending: true })
          const { data, error } = await q
          if (error) throw new Error(error.message)
          const page = data ?? []
          if (page.length === 0) break
          rows.push(...page)
          if (rows.length >= HARD_CAP) { truncated = true; break }
          from += page.length
        }

        const name = truncated ? `${t}.PARTIAL` : t
        // Written and released one table at a time. Holding fifty tables in
        // memory before uploading any of them is how a backup dies on the
        // largest table and takes the small ones with it.
        await put(`${stamp}/${name}.json`, JSON.stringify(rows, null, 1))
        tableCounts[t] = truncated ? `${rows.length} rows, PARTIAL (hit the ${HARD_CAP} guard)` : rows.length
        if (truncated) partial.push(t)
      } catch (e) {
        tableCounts[t] = `skipped (${e instanceof Error ? e.message.slice(0, 80) : 'error'})`
      }
    }

    // 3. app_data last, so it is the file most likely to survive a timeout,
    //    and kept in memory for the off-site email copy below.
    for (const [path, content] of Object.entries(files)) await put(path, content)

    // 4. Email the administrator — inline the app_data JSON when small enough
    //    so a copy exists entirely outside this database.
    const ghlToken = Deno.env.get('GHL_TOKEN')
    const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    const to = Deno.env.get('BACKUP_EMAIL') || 'samantha@mo-care.com'
    let emailed = false
    if (ghlToken && ghlLocation) {
      const ghlHeaders = {
        Authorization: `Bearer ${ghlToken}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }
      try {
        const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method: 'POST',
          headers: ghlHeaders,
          body: JSON.stringify({ locationId: ghlLocation, email: to, firstName: 'Hub', lastName: 'Backup' }),
        })
        const upJson = await up.json().catch(() => ({}))
        const contactId = upJson?.contact?.id ?? upJson?.id
        if (contactId) {
          const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          const appJson = files[`${stamp}/app_data.json`]
          const inline = appJson.length < 180_000
            ? `<p style="font-weight:bold;margin-bottom:4px">app_data.json (full off-site copy)</p>` +
              `<pre style="font-size:10px;background:#f5f7fa;padding:10px;border-radius:6px;white-space:pre-wrap">${esc(appJson)}</pre>`
            : `<p><i>app_data snapshot too large to inline (${Math.round(appJson.length / 1024)} KB) — full copy is in the backups vault.</i></p>`
          const em = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST',
            headers: ghlHeaders,
            body: JSON.stringify({
              type: 'Email',
              contactId,
              subject: `Hub backup ${stamp} — Staffing/Team/CC hubs snapshot`,
              html:
                `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2a36;line-height:1.5">` +
                `<p>Weekly snapshot of the shared hub database (Team, Staffing, Care Coordinator).</p>` +
                `<p><b>app_data keys:</b></p><ul>` +
                Object.entries(summary).map(([k, v]) => `<li>${esc(k)}: ${v}${typeof v === 'number' ? ' records' : ''}</li>`).join('') +
                `</ul><p><b>Tables (${Object.keys(tableCounts).length} found):</b></p><ul>` +
                Object.entries(tableCounts).map(([k, v]) => `<li>${esc(k)}: ${v}${typeof v === 'number' ? ' rows' : ''}</li>`).join('') +
                (partial.length
                  ? `</ul><p style="color:#b45309"><b>Captured only in part:</b> ${esc(partial.join(', '))}. ` +
                    `Those files are named .PARTIAL.json and are NOT a complete restore point for those tables.</p><ul>`
                  : '') +
                `</ul><p><b>Keep this email</b> — if the hubs ever lose data again (like July 5), this is the restore point.</p>` +
                inline +
                `</div>`,
            }),
          })
          emailed = em.ok
        }
      } catch (e) {
        console.error('backup email failed:', e instanceof Error ? e.message : e)
      }
    }

    const skipped = Object.entries(tableCounts)
      .filter(([, v]) => typeof v === 'string' && v.startsWith('skipped'))
      .map(([k]) => k)

    return json({
      success: true, date: stamp, stored, emailed,
      files_written: Object.keys(files).length,
      tables_found: Object.keys(tableCounts).length,
      tables_partial: partial,
      tables_skipped: skipped,
      app_data_keys: summary,
      tables: tableCounts,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'backup failed' }, 500)
  }
})
