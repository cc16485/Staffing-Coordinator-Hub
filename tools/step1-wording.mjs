// Prints the Step 1 forms exactly as the code holds them, as markdown, for Samantha's final wording review (node tools/step1-wording.mjs).
// The design doc section is generated from this, so the words she approves are the words the screens and PDFs use.
import path from 'path';
const D = await import(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'supabase/functions/_shared/step1-documents.ts'));
const out = [];
for (const key of D.FORM_ORDER) {
  const f = D.FORMS[key], fp = (await D.formFingerprint(key)).slice(0, 12);
  out.push(`### ${f.title} (screen ${f.screen}, version ${f.version}, ${f.status.replace(/_/g, ' ')}, fingerprint ${fp})`);
  for (const p of f.intro || []) out.push(p);
  for (const s of f.sections) {
    out.push(`**${s.h}.** ${(s.p || []).join(' ')}`.trim());
    for (const i of s.items || []) {
      const opts = i.options ? (i.kind === 'table' ? ` Columns: ${i.options.join(', ')}.` : i.kind === 'multi' && i.options.length > 20 ? '' : ` Options: ${i.options.join(' / ')}.`) : '';
      out.push(`- ${i.label}${i.kind === 'yesno' ? ' Yes / No.' : ''}${opts}${i.required ? ' Required.' : ''}${i.locked ? ' Kept in the lock.' : ''}${i.note ? ' ' + i.note : ''}`);
    }
  }
  out.push(`**Signed (${f.signature === 'typed+initials' ? 'typed name and initials' : 'typed name'}).** ${f.certification.join(' ')}`);
  out.push('');
}
console.log(out.join('\n'));
