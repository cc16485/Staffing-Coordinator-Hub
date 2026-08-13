// =============================================================================
// lead-reconcile — is any lead invisible to the office?
// =============================================================================
// REPORT ONLY. Writes nothing. Creates no work.
//
// THE GAP THIS EXAMINES
//   The lead workflow is the most complete in the Hub — chase ladder, evolving
//   item, stand-down on human contact, closes at Converted or Lost. But nothing
//   checks GHL against the Hub. A lead that lands in GHL and never reaches the
//   Hub is invisible: no item, no chase, no escalation, and nobody notices
//   because the automation looks perfectly healthy.
//
// WHY THIS DOES NOT CREATE WORK
//   GHL holds 9,570 contacts and roughly 4,460 of them are a single VA lead
//   campaign. "Which GHL contacts are leads Caring Companions should be
//   working?" is a business question, not a technical one, and answering it
//   wrong by creating four thousand work items would be worse than the gap.
//
//   So this measures the gap and shows its shape. The rule comes after.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

const clean = (v: unknown) => String(v ?? '').trim()

function normPhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return d.length > 11 ? '+' + d : null
}
function normEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

/* Tags that suggest a contact is a CARE enquiry for Caring Companions, rather
   than a hiring applicant or a campaign from another business line. Derived
   from the 237 tags actually in use, not invented. Deliberately narrow: a tag
   we are unsure about is reported separately rather than counted as a lead. */
const CARE_LEAD_TAGS = /cc website lead|^lead$|care enquiry|care inquiry|consultation/
const APPLICANT_TAGS = /applicant|applied|interview|orientation|hrcloud|hired|caregiver/
const OTHER_CAMPAIGN = /^va |^ht |hometogether|guide|cds/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })

  /* Hub leads. */
  const { data: rows } = await sb.from('app_data')
    .select('key, data').in('key', ['leads', 'ops_items'])
  // deno-lint-ignore no-explicit-any
  const leads = (rows?.find(r => r.key === 'leads')?.data ?? []) as any[]
  // deno-lint-ignore no-explicit-any
  const items = (rows?.find(r => r.key === 'ops_items')?.data ?? []) as any[]

  const hubPhones = new Set<string>()
  const hubEmails = new Set<string>()
  for (const l of leads) {
    const p = normPhone(l.phone); if (p) hubPhones.add(p)
    const e = normEmail(l.email); if (e) hubEmails.add(e)
  }

  /* GHL contacts, from the scan cache rather than a fresh pull — the cache is
     complete (9,570, verified) and this must not depend on a live GHL call. */
  // deno-lint-ignore no-explicit-any
  const contacts: any[] = []
  let from = 0
  for (;;) {
    const { data } = await sb.from('identity_scan_cache')
      .select('ghl_contact_id, first_name, last_name, phone, email, tags')
      .range(from, from + 999)
    if (!data || !data.length) break
    contacts.push(...data)
    if (data.length < 1000) break
    from += 1000
  }

  const buckets = {
    care_lead: [] as string[],
    applicant: [] as string[],
    other_campaign: [] as string[],
    untagged: [] as string[],
    unclassifiable: [] as string[],
  }
  let careLeadsInHub = 0, careLeadsMissing = 0, careLeadsNoContact = 0
  const missingSample: Array<Record<string, unknown>> = []

  for (const c of contacts) {
    const tags = (Array.isArray(c.tags) ? c.tags : []).map((t: unknown) => String(t).toLowerCase())
    const isCare = tags.some((t: string) => CARE_LEAD_TAGS.test(t))
    const isApplicant = tags.some((t: string) => APPLICANT_TAGS.test(t))
    const isOther = tags.some((t: string) => OTHER_CAMPAIGN.test(t))

    if (!tags.length) { buckets.untagged.push(c.ghl_contact_id); continue }
    if (isCare && !isApplicant) buckets.care_lead.push(c.ghl_contact_id)
    else if (isApplicant) { buckets.applicant.push(c.ghl_contact_id); continue }
    else if (isOther) { buckets.other_campaign.push(c.ghl_contact_id); continue }
    else { buckets.unclassifiable.push(c.ghl_contact_id); continue }

    /* Only care leads are measured against the Hub. */
    const p = normPhone(c.phone), e = normEmail(c.email)
    if (!p && !e) { careLeadsNoContact++; continue }
    const known = (p && hubPhones.has(p)) || (e && hubEmails.has(e))
    if (known) { careLeadsInHub++; continue }
    careLeadsMissing++
    if (missingSample.length < 25) {
      missingSample.push({
        name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || '(no name)',
        line_last4: p ? p.slice(-4) : null,
        has_email: !!e,
        tags: tags.slice(0, 4),
      })
    }
  }

  /* The other direction: a Hub lead with no GHL contact cannot be messaged. */
  const ghlPhones = new Set(contacts.map(c => normPhone(c.phone)).filter(Boolean) as string[])
  const ghlEmails = new Set(contacts.map(c => normEmail(c.email)).filter(Boolean) as string[])
  let hubLeadsWithoutGhl = 0
  for (const l of leads) {
    const p = normPhone(l.phone), e = normEmail(l.email)
    if (!p && !e) continue
    if (!(p && ghlPhones.has(p)) && !(e && ghlEmails.has(e))) hubLeadsWithoutGhl++
  }

  /* And: does every open Hub lead actually have a work item? */
  const openLeadIds = new Set(leads
    .filter(l => !['converted', 'lost'].includes(String(l.status ?? 'New').toLowerCase()))
    .map(l => `ops_lead_${l.id}`))
  const itemIds = new Set(items.map(i => String(i.id)))
  const openLeadsWithNoItem = [...openLeadIds].filter(id => !itemIds.has(id)).length

  return new Response(JSON.stringify({
    read_only: true, wrote_nothing: true, created_no_work: true,
    ghl_contacts_examined: contacts.length,
    hub_leads: leads.length,

    classification: {
      care_lead: buckets.care_lead.length,
      applicant: buckets.applicant.length,
      other_campaign: buckets.other_campaign.length,
      untagged: buckets.untagged.length,
      unclassifiable: buckets.unclassifiable.length,
      note: 'Only care_lead is measured against the Hub. Applicants, other ' +
            'campaigns and untagged contacts are counted and left alone, ' +
            'because deciding they are leads is a business call.',
    },

    the_gap: {
      care_leads_in_ghl: buckets.care_lead.length,
      also_known_to_the_hub: careLeadsInHub,
      INVISIBLE_TO_THE_OFFICE: careLeadsMissing,
      no_phone_or_email_to_match_on: careLeadsNoContact,
      hub_leads_with_no_ghl_contact: hubLeadsWithoutGhl,
      open_hub_leads_with_no_work_item: openLeadsWithNoItem,
    },

    invisible_sample: missingSample,

    what_this_does_not_do: 'It creates no work. Which GHL contacts count as ' +
      'leads Caring Companions should be working is a business rule, and ' +
      'getting it wrong here would mean thousands of work items.',
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
