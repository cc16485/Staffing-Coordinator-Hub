// SLICE 0 (Samantha approved 2026-10-08): the onboarding business-day clock. Pure functions, no network, no clock.
// node business_days_531_test.mjs
import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const B = await import(path.join(ROOT, 'supabase/functions/_shared/business-days.ts'));
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 300)]);
const H = [{ date: '2026-10-12', name: 'Columbus Day' }, { date: '2026-11-26', name: 'Thanksgiving Day' }, '2026-12-25', { date: 'junk' }, 7];

ck('isYmd accepts a real date and refuses junk', B.isYmd('2026-10-09') && !B.isYmd('2026-02-30') && !B.isYmd('10/09/2026') && !B.isYmd(''));
ck('holidayDates reads objects and strings, drops junk', [...B.holidayDates(H)].join(',') === '2026-10-12,2026-11-26,2026-12-25');
ck('Saturday and Sunday are weekends', B.isWeekend('2026-10-10') && B.isWeekend('2026-10-11') && !B.isWeekend('2026-10-09'));
ck('a holiday is not a business day', !B.isBusinessDay('2026-10-12', H) && B.isBusinessDay('2026-10-13', H));
ck('Friday to Monday', B.nextBusinessDay('2026-10-09', []) === '2026-10-12');
ck('Friday to Tuesday when Monday is a holiday', B.nextBusinessDay('2026-10-09', H) === '2026-10-13', B.nextBusinessDay('2026-10-09', H));
ck('a holiday on the due day skips it (Wed Nov 25 -> Fri Nov 27)', B.nextBusinessDay('2026-11-25', H) === '2026-11-27');
ck('two business days over a weekend', B.nextBusinessDay('2026-10-08', [], 2) === '2026-10-12');
ck('an empty holiday list is fine', B.nextBusinessDay('2026-12-24', []) === '2026-12-25' && B.nextBusinessDay('2026-12-24', H) === '2026-12-28');
// 5pm Central either side of the daylight-saving change (2026: DST ends Sunday Nov 1)
const oct = B.centralInstant('2026-10-30', 17), nov = B.centralInstant('2026-11-02', 17);
ck('5pm Central in October is 22:00 UTC (CDT)', oct.toISOString() === '2026-10-30T22:00:00.000Z', oct.toISOString());
ck('5pm Central in November is 23:00 UTC (CST)', nov.toISOString() === '2026-11-02T23:00:00.000Z', nov.toISOString());
ck('centralYmd gives the Chicago date late at night', B.centralYmd('2026-10-10T03:30:00Z') === '2026-10-09');
// due: approved Friday Oct 9 3pm Central (20:00Z) -> due Monday Oct 12 5pm (no holidays) / Tuesday Oct 13 (holiday)
ck('due next business day 5pm Central: Friday 3pm -> Monday 5pm', B.dueNextBusinessDay('2026-10-09T20:00:00Z', []) === '2026-10-12T22:00:00.000Z', B.dueNextBusinessDay('2026-10-09T20:00:00Z', []));
ck('due skips a Monday holiday -> Tuesday 5pm', B.dueNextBusinessDay('2026-10-09T20:00:00Z', H) === '2026-10-13T22:00:00.000Z');
ck('approved Monday 9am -> due Tuesday 5pm', B.dueNextBusinessDay('2026-10-05T14:00:00Z', []) === '2026-10-06T22:00:00.000Z');
ck('approved at 11pm Central counts as that day (due the next business day)', B.dueNextBusinessDay('2026-10-07T04:30:00Z', []) === '2026-10-07T22:00:00.000Z');
ck('due across the DST change: Friday Oct 30 -> Monday Nov 2 at 23:00Z', B.dueNextBusinessDay('2026-10-30T15:00:00Z', []) === '2026-11-02T23:00:00.000Z');
ck('businessDaysBetween counts only business days after the start', B.businessDaysBetween('2026-10-08', '2026-10-13', H) === 2 && B.businessDaysBetween('2026-10-13', '2026-10-08', H) === 0);
ck('businessDaysWaiting from instants', B.businessDaysWaiting('2026-10-08T20:00:00Z', '2026-10-13T14:00:00Z', H) === 2);
const F = B.federalHolidays(2026), byName = Object.fromEntries(F.map((h) => [h.name, h.date]));
ck('eleven federal holidays', F.length === 11);
ck("2026: New Year's Thu Jan 1, MLK Jan 19, Presidents Feb 16", byName["New Year's Day"] === '2026-01-01' && byName['Martin Luther King Jr. Day'] === '2026-01-19' && byName["Presidents' Day"] === '2026-02-16', byName);
ck('2026: Memorial May 25, Juneteenth Jun 19, Independence Jul 3 (observed, Jul 4 is Saturday)', byName['Memorial Day'] === '2026-05-25' && byName['Juneteenth'] === '2026-06-19' && byName['Independence Day'] === '2026-07-03', byName);
ck('2026: Labor Sep 7, Columbus Oct 12, Veterans Nov 11, Thanksgiving Nov 26, Christmas Dec 25', byName['Labor Day'] === '2026-09-07' && byName['Columbus Day'] === '2026-10-12' && byName['Veterans Day'] === '2026-11-11' && byName['Thanksgiving Day'] === '2026-11-26' && byName['Christmas Day'] === '2026-12-25', byName);
ck('2027: Christmas Saturday observed Friday Dec 24', B.federalHolidays(2027).find((h) => h.name === 'Christmas Day').date === '2027-12-24');
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((r) => !r[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
