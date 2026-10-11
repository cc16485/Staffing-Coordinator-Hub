/**
 * 587/588 · How a reply to the interview reminder is read (Samantha: "if they reply no they aren't coming ... open up
 * the interview spot for someone else"). Shared by interview-messages (588: the Hub reads replies itself) and
 * interview-reply (the GoHighLevel-workflow route, kept but unused).
 */
/** 'no' | 'yes' | 'other'. Deliberately strict: only an unmistakable answer acts; everything else goes to a person. */
export function classify(message: string): 'no' | 'yes' | 'other' {
  const t = String(message || '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ?]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return 'other'
  if (/\?/.test(t)) return 'other'                                         // a question needs a person
  if (/\b(late|move|resched|reschedule|another time|different time|later today|instead|but)\b/.test(t)) return 'other'
  if (/\bno (problem|worries|prob)\b/.test(t)) return 'other'               // "no problem, see you then"
  const no = /^(no|nope|nah|n|no sorry|sorry no|no thanks|no thank you|cancel|cancel it|cancel please|please cancel|cancel my interview)$/.test(t)
    || /^(sorry |so sorry |i'm sorry |no |unfortunately |actually |oh |hey )*(i )?(can't|cannot|can not|won't|will not|am not able to|i'm not able to|not able to|unable to) (make it|come|be there|attend|go|make the interview)( tomorrow| today)?( sorry)?$/.test(t)
    || /^(sorry |actually |unfortunately )*(i'm |i am )?not (coming|going to make it|gonna make it)( tomorrow| today)?( sorry)?$/.test(t)
    || /^(i )?(need|have) to cancel( my interview| it)?( sorry)?$/.test(t)
  const yes = /^(yes|y|yep|yeah|yea|yes ma'am|yes sir|ok|okay|sure|confirmed|confirm|see you then|see you tomorrow|i'll be there|i will be there|yes i'll be there|yes i will be there|yes see you then|yes see you tomorrow)( thank you| thanks| thx)?$/.test(t)
  if (no && !yes) return 'no'
  if (yes && !no) return 'yes'
  return 'other'
}
