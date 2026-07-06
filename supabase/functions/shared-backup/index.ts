// Supabase Edge Function: shared-backup (hub project zngsgedlsxinbygwmxwn)
// Weekly safety net for the shared hub database (Team + Staffing + Care
// Coordinator hubs). The July 2026 wipe incident showed how exposed app_data
// is — this snapshots EVERY app_data key plus the standalone tables to the
// private `backups` storage bucket, and emails the administrator a summary
// (with the full JSON inline when small enough for an off-site copy).
//
// Secrets: GHL_TOKEN, GHL_LOCATION_ID  ·  Optional: BACKUP_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const TABLES = ['evv_submissions', 'client_queue', 'orient_bookings']

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

    // 2. Standalone tables (skip any that error — schemas vary by hub age).
    const tableCounts: Record<string, number | string> = {}
    for (const t of TABLES) {
      try {
        const { data, error } = await supabase.from(t).select('*')
        if (error) { tableCounts[t] = `skipped (${error.message.slice(0, 60)})`; continue }
        files[`${stamp}/${t}.json`] = JSON.stringify(data ?? [], null, 1)
        tableCounts[t] = (data ?? []).length
      } catch { tableCounts[t] = 'skipped' }
    }

    // 3. Store snapshots in the private backups bucket.
    let stored = 0
    for (const [path, content] of Object.entries(files)) {
      const { error } = await supabase.storage
        .from('backups')
        .upload(path, new Blob([content], { type: 'application/json' }), { upsert: true })
      if (!error) stored++
      else console.error(`backup upload failed for ${path}:`, error.message)
    }

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
                `</ul><p><b>Tables:</b></p><ul>` +
                Object.entries(tableCounts).map(([k, v]) => `<li>${esc(k)}: ${v}${typeof v === 'number' ? ' rows' : ''}</li>`).join('') +
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

    return json({ success: true, date: stamp, stored, emailed, app_data_keys: summary, tables: tableCounts })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'backup failed' }, 500)
  }
})
