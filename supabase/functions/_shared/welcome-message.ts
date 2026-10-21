// =============================================================================
// welcome-message.ts · the ONE welcome message after Step 2 is checked (Samantha approved the onboarding design 2026-10-21,
// stop 5: "send the caregiver ONE friendly message containing their online orientation link, their caregiver profile
// completion link, a message explaining that we will mail their Caring Companions employee badge"; decision 2: the
// 15-minute welcome video call stays, booked from this same message, because their ID is checked on camera for the I-9).
// =============================================================================
// Sent by welcome-call (invite_auto with welcome: true) when the Step 2 server verifies Step 2 and
// ops_settings.welcome_message_live is true; otherwise the plain invitation goes exactly as before.
// The orientation link: the Training Platform makes it and sends it itself once AxisCare has them In Training. When the
// caller has the link (orientation), it is in this message; when not, the message says it comes in its own text.
// The profile reminders (day 3 and day 6 after this message, ops_settings.profile_reminders_live) are here too.
// Pure: the words only. No em dashes.
import { withStop } from './text-consent.ts'
const OFFICE = '(417) 234-8494'
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const shell = (body: string) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">${body}` +
  `<p style="color:#57606a">Questions? Call or text us at ${OFFICE}.<br>Caring Companions In-Home Senior Care</p></div>`
const btn = (href: string, label: string) => `<p><a href="${href}" style="background:#F0A63A;color:#122F52;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">${label}</a></p>`
export const profileLink = (token: string) => 'https://cc.mo-care.com/caregiver-profile.html?t=' + encodeURIComponent(token)

export function welcomeMessages(first: string, book: string, profile: string, orientation?: string | null) {
  const f = first || 'there'
  const third = orientation ? `3) Start your online orientation (about 2 hours): ${orientation}` : `3) Watch for your online orientation link. It comes in its own text from our training site.`
  return {
    text: withStop(`Hi ${f}, welcome to Caring Companions! Your paperwork is all checked. Three things, in any order: ` +
      `1) Book your 15-minute welcome video call (have your ID handy): ${book} ` +
      `2) Finish your caregiver profile, a friendly photo and a few words for families: ${profile} ` +
      `${third} We are also mailing you your Caring Companions employee badge! Questions? Call ${OFFICE}.`),
    subject: 'Welcome to Caring Companions! Your next three steps',
    html: shell(`<p>Hi ${esc(f)},</p><p>Welcome to Caring Companions! Your paperwork is all checked, and we are so glad you are joining us. Here are your next three steps. Do them in any order:</p>` +
      `<p><b>1. Book your 15-minute welcome video call.</b> We will say hello and look at your ID together for your I-9, so have it handy.</p>${btn(book, 'Book my welcome call')}` +
      `<p><b>2. Finish your caregiver profile.</b> Add a friendly photo of yourself (we need this one) and a few words. Families see your profile before you visit, so they know who is coming.</p>${btn(profile, 'Finish my profile')}` +
      (orientation ? `<p><b>3. Start your online orientation.</b> It takes about 2 hours, on your phone or computer.</p>${btn(orientation, 'Start my orientation')}`
        : `<p><b>3. Do your online orientation.</b> Your link comes in its own message from our training site. It takes about 2 hours, on your phone or computer.</p>`) +
      `<p>We are also mailing you your <b>Caring Companions employee badge</b>, so keep an eye on your mailbox!</p>`),
  }
}
export function profileReminderMessages(first: string, profile: string) {
  const f = first || 'there'
  return {
    text: withStop(`Hi ${f}, a friendly reminder from Caring Companions to finish your caregiver profile: ${profile} A photo and a few words is all it takes. Families love seeing who is coming! Questions? Call ${OFFICE}.`),
    subject: 'A quick reminder: your Caring Companions profile',
    html: shell(`<p>Hi ${esc(f)},</p><p>A friendly reminder to finish your caregiver profile. A friendly photo and a few words is all it takes, and families love seeing who is coming.</p>${btn(profile, 'Finish my profile')}`),
  }
}
