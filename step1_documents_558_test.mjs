// SLICE 2a: the Step 1 forms as versioned code, against Samantha's rulings of October 9 (sections 18 to 21 and her seven
// decisions). No network. node step1_documents_558_test.mjs
import path from 'path';
const FN = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions');
const D = await import(path.join(FN, '_shared/step1-documents.ts')); const C = await import(path.join(FN, '_shared/step1-crypto.ts'));
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 300)]);
const all = D.FORM_ORDER.map((k) => D.formText(k)).join('\n');
ck('seven forms in the eight-screen order, every one version 1', D.FORM_ORDER.length === 7 && D.FORM_ORDER.every((k) => D.FORMS[k].version === 1) && D.FORMS.employee_application.screen === '2 and 3' && D.FORMS.vehicle.screen === '8');
ck('nothing is approved for real applicants yet', Object.keys(D.APPROVED_FOR_REAL).length === 0);
ck('the FCRA disclosure is a draft for counsel; the screening consent is to confirm; the rest proposed', D.FORMS.fcra_disclosure.status === 'draft_for_counsel' && D.FORMS.edl_fcsr_consent.status === 'to_confirm' && ['employee_application', 'reference_consent', 'availability', 'experience', 'vehicle'].every((k) => D.FORMS[k].status === 'proposed'));
const app = D.formText('employee_application');
ck('Employee Application: no Social Security number or street address on it (they live on 5b), other names kept, lived outside Missouri added, preferred name added', !/SS#|social security/i.test(app) && !/Street Address|Zip Code/.test(app) && /other names you have used/.test(app) && /lived outside Missouri in the last five years/.test(app) && /What should families and the office call you/.test(app));
ck('Employee Application: the three typing mistakes are fixed', /Have you had any moving traffic violations/.test(app) && /pled guilty or no contest/.test(app) && /Date of Conviction/.test(app) && !/Convention|no consent|been had/.test(app));
ck('Employee Application: employers gain role, what you did and may-we-contact; the calm instruction; the not-a-participant line in the certification; the approved drug screening wording', /Your role \/ job title/.test(app) && /May we contact them/.test(app) && /Please check every detail; we use these to verify you/.test(app) && /I am not a participant in the Missouri in-home services program/.test(app) && /any drug screening required by Caring Companions' screening policy/.test(app) && !/pass a drug test/.test(app));
const ref = D.formText('reference_consent');
ck('Reference consent: her decision 1 (two professional, two personal, kept apart, a supervisor may be professional) and decision 2 (the sentence reworded)', D.REFERENCES_REQUIRED.professional === 2 && D.REFERENCES_REQUIRED.personal === 2 && /2 professional references \(a supervisor or manager/.test(ref) && /2 personal references/.test(ref) && /not a relative/.test(ref) && /contact the references I provide and to verify relevant employment information/.test(ref) && !/after working with Troutman/.test(ref));
const fcra = D.formText('fcra_disclosure');
ck('FCRA screen: solely the disclosure and the authorization (no EDL, FCSR, at-will, drug, Checkr or box words)', /Disclosure Regarding Background Investigation/.test(fcra) && /Summary of Your Rights/.test(fcra) && /authorize the Company to obtain consumer reports/.test(fcra) && !/EDL|FCSR|at will|at-will|drug|Checkr|Wellsky|Initial|Quarterly/.test(fcra));
const edl = D.formText('edl_fcsr_consent');
ck('EDL and FCSR screen: the EDL paragraph as written, the FCSR sentence, ONE consent sentence covering initial, quarterly and annual (her decision 3), no boxes, no vendor named (decision 4)', /searches the Employee Disqualification List \(EDL\) before hiring an individual \(and quarterly thereafter\)/.test(edl) && /Family Care Safety Registry \(FCSR\) background screening/.test(edl) && /This consent covers the initial check before I begin work and the quarterly and annual checks/.test(edl) && !/Select one statement|Checkr|Wellsky|Super Criminal/.test(edl) && D.SCREENING_PACKAGE.length === 0);
ck('5b carries the three identity fields, locked, with the plain line on why and how they are kept', /Social Security number/.test(edl) && /Date of birth/.test(edl) && /Street address/.test(edl) && D.FORMS.edl_fcsr_consent.sections[1].items.filter((i) => i.locked).map((i) => i.id).join() === 'ssn,dob' && /kept encrypted on our server, seen only by the office person who orders your checks, and every look is logged/.test(edl));
const av = D.formText('availability');
ck('Availability: live-in gone, the four windows, the text consent line, the AxisCare initials, the 90-day wording kept', !/Live-In|Live-in/.test(av) && /Morning;Afternoon;Evening;Overnight;Not available/.test(av) && /You may text me about shifts and schedules at this number/.test(av) && /\(Initials\)/.test(av) && /first ninety \(90\) days of employment/.test(av) && D.FORMS.availability.signature === 'typed+initials');
const ex = D.formText('experience');
ck('Experience: the three levels as written, the ten specialties, the matching facts and languages (section 21), the Level 1 sentence', /Hoyer lift \(if trained\), bedbound clients/.test(ex) && D.SPECIALTIES.length === 10 && /Homes with cats/.test(ex) && /Languages you speak with clients/.test(ex) && /Everyone starts at Level 1/.test(ex) && !D.MATCHING_FACTS.some((m) => /live|payor|medicaid|private pay/i.test(m.id)));
const ve = D.formText('vehicle');
ck('Vehicle: license number, state and expiry (locked), proof as two options incl. "I will provide" (decision 5), the photo optional, the two-choice acknowledgment, driving only after verification', /Driver's license number/.test(ve) && D.FORMS.vehicle.sections[0].items.find((i) => i.id === 'license_number').locked === true && /I will provide proof of current personal automobile insurance coverage to Caring Companions before orientation/.test(ve) && D.FORMS.vehicle.sections[0].items.find((i) => i.id === 'insurance_photo').required === false && /sign a Non-Driver Agreement/.test(ve) && /Driving duties are assigned only after the office has verified my license, insurance and Motor Vehicle Record/.test(ve));
ck('no em dash anywhere in the texts', !/—/.test(all));
const fp1 = await D.formFingerprint('availability'), fp2 = await D.formFingerprint('availability'), fp3 = await D.formFingerprint('experience');
ck('a form\'s wording has a stable fingerprint, different per form', fp1 === fp2 && fp1 !== fp3 && /^[0-9a-f]{64}$/.test(fp1));
// the lock
const KEK = Buffer.from(new Uint8Array(32).map((_, i) => i * 7 % 256)).toString('base64');
const s1 = await C.seal(KEK, 'offer-1', '123-45-6789'), s2 = await C.seal(KEK, 'offer-1', '123-45-6789');
ck('sealing is random (two seals differ) and opens back to the value', s1 !== s2 && (await C.open(KEK, 'offer-1', s1)) === '123-45-6789' && s1.startsWith('v1.'));
let moved = false; try { await C.open(KEK, 'offer-2', s1); moved = true; } catch { moved = false; }
ck('a sealed value cannot be moved to another offer', moved === false);
let wrong = false; try { await C.open(Buffer.alloc(32, 1).toString('base64'), 'offer-1', s1); wrong = true; } catch { wrong = false; }
ck('a wrong key opens nothing', wrong === false);
ck('last four and the SSN shape check', C.last4('123-45-6789') === '6789' && C.ssnLooksValid('123-45-6789') === false && C.ssnLooksValid('529-12-3456') === true && C.ssnLooksValid('000-12-3456') === false && C.ssnLooksValid('111-11-1111') === false && C.ssnLooksValid('529-00-3456') === false);
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
