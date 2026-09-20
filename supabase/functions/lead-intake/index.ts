// Supabase Edge Function: lead-intake (shared hub project)
// Public webhook: the website's "request care" form posts here and the
// submission becomes a lead in the CC Hub's pipeline, with the follow-up
// clock already started. Deployed with --no-verify-jwt (forms can't sign in),
// gated instead by a token in the URL: ?token=cclead_...
// Accepts JSON or normal form posts. Creates leads only — can't read anything.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { opEvent } from '../_shared/events.ts'
import { ldPush } from '../_shared/lead-truth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const expected = Deno.env.get('LEAD_INTAKE_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {}
  const ct = req.headers.get('content-type') || ''
  try {
    if (ct.includes('application/json')) body = await req.json()
    else {
      const form = await req.formData()
      for (const [k, v] of form.entries()) body = { ...body, [k]: String(v) }
    }
  } catch { return json({ error: 'could not read the submission' }, 400) }

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = body[k]
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
    }
    return ''
  }
  // Honeypot. A field no person can see, so anything that fills it in is a bot.
  // Answer politely and drop it on the floor: a bot that gets an error retries.
  for (const trap of ['website', 'url', 'company_website', '_gotcha']) {
    if (typeof body[trap] === 'string' && body[trap].trim()) {
      return json({ status: 'lead created' })
    }
  }

  // Tolerant field mapping — website builders name fields all kinds of ways.
  let first = pick('first_name', 'firstName', 'fname')
  let last = pick('last_name', 'lastName', 'lname')
  const fullName = pick('name', 'full_name', 'fullName')
  if (!first && fullName) { const parts = fullName.split(/\s+/); first = parts[0]; last = parts.slice(1).join(' ') }
  const phone = pick('phone', 'phone_number', 'mobile', 'tel')
  const email = pick('email', 'email_address')
  if (!first && !phone && !email) return json({ error: 'submission had no name, phone or email' }, 400)

  /* ── COURSE SIGNUPS ARE NOT CARE LEADS (her finding, 2026-09-19) ──────
     Somebody finishing a Dementia Journey module and wanting the next one
     gave us an email, not a care inquiry. They must never enter the lead
     pipeline, never be told "a care coordinator will call you shortly",
     never trip the untouched-lead alarms, and never skew conversion
     numbers. They land on their own list, carrying exactly what they
     asked for. Explicit kind wins; the legacy pattern (paren-tagged name,
     no phone) catches pages published before this change. */
  const msgRaw = pick('message', 'notes', 'comments', 'situation', 'how_can_we_help', 'description')
  const isCourseSignup = pick('kind') === 'course_signup'
    || (!phone && fullName.startsWith('(')
        && /journey|academy|module|waitlist/i.test(fullName + ' ' + msgRaw))
  if (isCourseSignup) {
    if (!email) return json({ error: 'an email is needed' }, 400)
    const sbC = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error: cErr } = await sbC.rpc('upsert_app_data_item', { target_key: 'course_signups', item: {
      id: 'cs_' + crypto.randomUUID().slice(0, 12),
      email: email.toLowerCase(),
      course: pick('course') || (/family.academy/i.test(fullName + ' ' + msgRaw) ? 'family-academy' : 'dementia-journey'),
      module: pick('module') || '',
      tag: fullName || '',
      asked_for: msgRaw.slice(0, 300) || 'course updates',
      at: new Date().toISOString(),
    } })
    if (cErr) return json({ error: cErr.message }, 500)
    /* No lead. No ack. No alerts. They get exactly the notification they
       asked for, when a human (or an explicitly approved capability)
       sends it. */
    return json({ status: 'signup recorded', routed: 'course_signup' })
  }
  /* Who sent them. Asked on the form as one optional line, and kept as its own
     field rather than buried in the notes, because "which partner is actually
     working" is a question worth being able to count. */
  const heard = pick('heard_from', 'how_did_you_hear', 'referral_source', 'source_detail')

  const notes = [
    pick('message', 'notes', 'comments', 'situation', 'how_can_we_help', 'description'),
    pick('care_for', 'who_needs_care') ? 'Care for: ' + pick('care_for', 'who_needs_care') : '',
    pick('city') ? 'City: ' + pick('city') : '',
    pick('best_time', 'preferred_contact_time') ? 'Best time: ' + pick('best_time', 'preferred_contact_time') : '',
  ].filter(Boolean).join('\n')

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const lead = {
    id: crypto.randomUUID(),
    first_name: first || '(website lead)',
    last_name: last,
    phone,
    email,
    source: heard ? 'Referral' : 'Website',
    referral_source_name: heard || '',
    status: 'New',
    interest_notes: notes || 'Website form submission (no message left).',
    follow_up_due: today, // the clock starts the moment they reach out
    created_at: new Date().toISOString(),
  }
  /* Contact truth: the inquiry itself is the first event on the record. */
  ldPush(lead, { channel: 'web', direction: 'in', outcome: 'inquiry', actor: 'family',
    ref: (notes || '').slice(0, 200) })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'leads', item: lead })
  if (!error) await opEvent(supabase, { verb: 'lead_inquiry', item_id: String(lead.id), area: 'growth_leads',
    actor_name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'a family',
    summary: `New care inquiry from ${[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'the website'} (${lead.source})` })
  if (error) return json({ error: error.message }, 500)

  // Best-effort GHL contact (Caring Companions inbound webhook) so every
  // website lead also exists in the CRM/phone system. No-op until the
  // GHL_HOOK_CCLEADS secret is set. `office` supports multi-location
  // (defaults to Springfield; pass office=oklahoma from OK pages later).
  const ghlHook = Deno.env.get('GHL_HOOK_CCLEADS')
  if (ghlHook) {
    const office = (pick('office') || 'springfield').toLowerCase()
    try {
      await fetch(ghlHook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: lead.first_name,
          last_name: lead.last_name,
          email,
          phone,
          source: 'Caring Companions website',
          office,
          city: pick('city'),
          message: (notes || '').slice(0, 900),
        }),
      })
    } catch (_e) { /* never block the lead on CRM */ }
  }

  /* ---- tell the office NOW, not when it goes cold -------------------------
     This used to be nobody's job. lead-intake wrote the lead and pinged GHL,
     and the only office alert in the system lived in lead-followup, which
     fires when a lead is already overdue. So a lead could sit for hours with
     nobody knowing it existed. Alerting from here means it does not depend on
     a cron run, a GHL workflow, or anything else staying healthy.
     Best effort in every direction: the lead is already saved, so a failure
     here must never fail the request. */
  let alerted = 0
  let acked = false
  try {
    const ghlToken = Deno.env.get('GHL_TOKEN')
    const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    if (ghlToken && ghlLocation) {
      const h = {
        Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
        'Content-Type': 'application/json', Accept: 'application/json',
      }
      const contactFor = async (p: string, e: string, first: string) => {
        const r = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method: 'POST', headers: h,
          body: JSON.stringify({
            locationId: ghlLocation,
            ...(p ? { phone: p } : {}), ...(e ? { email: e } : {}),
            firstName: first,
          }),
        })
        const j = await r.json().catch(() => ({}))
        // deno-lint-ignore no-explicit-any
        return ((j as any)?.contact?.id ?? (j as any)?.id ?? null) as string | null
      }
      const send = (contactId: string, type: 'SMS' | 'Email', payload: Record<string, unknown>) =>
        fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h, body: JSON.stringify({ type, contactId, ...payload }),
        })

      /* ---- answer the family in seconds, not on the next cron run ----------
         The greeting used to be lead-followup's job, on a schedule that runs
         every fifteen minutes and had stopped running. Somebody who writes in
         at 9:02 should hear back at 9:02. lead-followup still owns the nudges
         afterwards; ack_sent_at is what tells it we already said hello, so
         nobody gets greeted twice. */
      /* HER RULE, twice enforced by this block (both learned from her live
         test, 2026-09-19):
         1. QUIET HOURS: nothing lands before 8am or after 6pm Central. An
            evening inquiry is greeted next morning by the sweep instead
            (ack_sent_at stays unset, so the sweep knows to say hello).
         2. THE TYPED NUMBER IS THE ONLY NUMBER: GHL's upsert matches by
            email first and then texts that contact's EXISTING phone — which
            once sent a family's greeting to the office line. So the SMS
            goes through a PHONE-keyed contact and the email through an
            EMAIL-keyed one; a text can only ever reach the number they
            typed. */
      const chiHour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
      const withinHours = chiHour >= 8 && chiHour < 18
      if ((phone || email) && withinHours) {
        try {
          const firstName = (first || 'there').replace(/\(.*\)/, '').trim() || 'there'
          const line = `Hi ${firstName}, this is Caring Companions. We have your message and a care `
            + `coordinator will call you shortly. If you would rather not wait, we are on (417) 234-8494. `
            + `Reply STOP to opt out.`
          let sentAny = false
          if (phone) {
            const cidP = await contactFor(phone, '', firstName)
            if (cidP) { await send(cidP, 'SMS', { message: line }); sentAny = true }
          }
          if (email) {
            const cidE = await contactFor('', email, firstName)
            if (cidE) {
              sentAny = true
              await send(cidE, 'Email', {
                subject: 'We have your message',
                html: '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">'
                  + `<p>Hi ${firstName},</p>`
                  + '<p>Thank you for reaching out to Caring Companions. Your message is with our care '
                  + 'coordinators and one of them will call you shortly.</p>'
                  + '<p>If you would rather talk sooner, call us on <b>(417) 234-8494</b> and we will pick up.</p>'
                  + '<p>There is nothing you need to do in the meantime.</p>'
                  + '<p style="color:#57606a">Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>',
              })
            }
          }
          if (sentAny) {
            acked = true
            // deno-lint-ignore no-explicit-any
            ;(lead as any).ack_sent_at = new Date().toISOString()
            /* Automation said hello — recorded as automation, never as contact. */
            if (phone) ldPush(lead, { channel: 'sms', direction: 'out', outcome: 'sent', actor: 'automation', note: 'acknowledgment' })
            if (email) ldPush(lead, { channel: 'email', direction: 'out', outcome: 'sent', actor: 'automation', note: 'acknowledgment' })
            await supabase.rpc('upsert_app_data_item', { target_key: 'leads', item: lead })
          }
        } catch { /* the office alert below still needs to go out */ }
      }
      // Who hears. A row in applicant_alerts so it changes without a deploy.
      // If that table or column is not there, we still tell Samantha.
      let people: { name?: string; phone?: string | null; email?: string | null }[] = []
      try {
        const { data } = await supabase
          .from('applicant_alerts').select('name, phone, email')
          .eq('active', true).contains('alert_on', ['lead'])
        people = data ?? []
      } catch { /* fall through to the backstop */ }
      if (!people.length) people = [{ name: 'Samantha', email: 'samantha@mo-care.com' }]

      const who = [lead.first_name, lead.last_name].filter(Boolean).join(' ')
      const reach = [phone, email].filter(Boolean).join(' · ')
      const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
      const noWay = !phone && !email

      const subject = noWay
        ? '🔔 New website lead — NO contact details'
        : '🔔 New lead: ' + who + (phone ? ' · ' + phone : '')
      const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#16283a;">'
        + '<p style="font-size:30px;margin:0 0 8px;">🔔</p>'
        + '<p><b style="font-size:18px;">' + esc(who) + '</b></p>'
        + (reach ? '<p><b>Reach them:</b> ' + esc(reach) + '</p>' : '')
        + (lead.referral_source_name ? '<p><b>Heard about us from:</b> ' + esc(lead.referral_source_name) + '</p>' : '')
        + '<p><b>What they said:</b><br>' + esc(lead.interest_notes) + '</p>'
        + (noWay
          ? '<p style="background:#fdf0f0;color:#a33;border-radius:10px;padding:14px 16px;">'
            + '<b>They left no phone and no email.</b> There is no way to reach this person. '
            + 'If this keeps happening, the form is letting people through without contact details.</p>'
          : '<p style="background:#EAF4F6;border-radius:10px;padding:14px 16px;">'
            + 'The follow-up clock started the moment they hit send. First call within the hour wins these.</p>')
        + '<p><a href="https://cc.mo-care.com/#leads" style="display:inline-block;background:#1F7A8C;color:#fff;'
        + 'font-weight:bold;padding:11px 22px;border-radius:9px;text-decoration:none;">Open the lead &rarr;</a></p>'
        + '</div>'
      const sms = '🔔 New lead: ' + who + (reach ? ' — ' + reach : ' — NO phone or email left')
        + '. ' + String(lead.interest_notes).replace(/\s+/g, ' ').slice(0, 110)
        + ' — cc.mo-care.com/#leads'

      for (const p of people) {
        try {
          const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
            method: 'POST', headers: h,
            body: JSON.stringify({
              locationId: ghlLocation,
              ...(p.phone ? { phone: p.phone } : {}),
              ...(p.email ? { email: p.email } : {}),
              firstName: (p.name || 'Team').split(' ')[0],
            }),
          })
          const j = await up.json().catch(() => ({}))
          // deno-lint-ignore no-explicit-any
          const contactId = (j as any)?.contact?.id ?? (j as any)?.id
          if (!contactId) continue
          if (p.email) {
            await fetch('https://services.leadconnectorhq.com/conversations/messages', {
              method: 'POST', headers: h,
              body: JSON.stringify({ type: 'Email', contactId, subject, html }),
            })
          }
          if (p.phone) {
            await fetch('https://services.leadconnectorhq.com/conversations/messages', {
              method: 'POST', headers: h,
              body: JSON.stringify({ type: 'SMS', contactId, message: sms }),
            })
          }
          alerted++
        } catch { /* one bad recipient must not stop the rest */ }
      }
    }
  } catch { /* the lead is saved; alerting is the bonus */ }

  return json({ status: 'lead created', id: lead.id, acked, alerted })
})
