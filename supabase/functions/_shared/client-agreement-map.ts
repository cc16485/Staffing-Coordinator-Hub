// =============================================================================
// client-agreement-map.ts · GENERATED from the Client Care Agreement build (cc-folder-inserts/src/agreement.py, field_map()).
// Do not edit by hand: rebuild the agreement, then regenerate this file. Every fill-in, checkbox, initials box and signature
// line on the printed agreement, with its page (1-based) and box in PDF points measured from the TOP-LEFT of a 612 x 792 page.
// PDF_SHA256 is the sha256 of the exact master PDF these boxes belong to; the function refuses any other file.
// 2026-10-30 (Samantha: an approved visit under 4 hours costs a flat $5.00 more per hour): the current master. Section 2 says
// "Any approved shift under four hours is billed at the Client's hourly rate plus $5.00 per hour, for every hour of that shift"
// (was "a rate increase of $5.00 per hour for each hour below four hours") and the Exhibit A Short-shift fee reads "Hourly rate
// plus $5.00 per hour". Page 9 carries her 2026-10-28 ending-services notice wording. 23 pages, every box the same as 10-18b.
// Earlier masters stay in client-agreement-map-2026-10-18b.ts, -2026-10-18.ts, -2026-10-17.ts and -2026-10-16.ts;
// agreement-masters.ts picks the right one for each agreement by its pdf_sha256.
// =============================================================================
export const DOC = 'client-care-agreement'
export const VERSION = "Rev. 10/2026"
export const PAGES = 23
export const PDF_SHA256 = "e11cbf8295107d42be8419fc76069543371c3788b0981d4c915823244bfc6309"
export const MASTER_PATH = 'master/client-care-agreement-rev-2026-10-30.pdf'
export type FieldType = 'text' | 'check' | 'initials' | 'signature'
export type Field = { type: FieldType; page: number; box: [number, number, number, number] }
export const FIELDS: Record<string, Field> = {
  "access.1_client_responsible_party": {
   "type": "check",
   "page": 4,
   "box": [
    58.2,
    445.6,
    67.2,
    454.6
   ]
  },
  "access.2_lockbox_access_a_ke": {
   "type": "check",
   "page": 4,
   "box": [
    58.2,
    479.3,
    67.2,
    488.3
   ]
  },
  "access.3_garage_door_access_code": {
   "type": "check",
   "page": 4,
   "box": [
    58.2,
    533.3,
    67.2,
    542.3
   ]
  },
  "access.4_other_access_option": {
   "type": "check",
   "page": 4,
   "box": [
    58.2,
    573.8,
    67.2,
    582.8
   ]
  },
  "access.describe": {
   "type": "text",
   "page": 4,
   "box": [
    113.8,
    591.1,
    553.7,
    605.4
   ]
  },
  "access.garage_code": {
   "type": "text",
   "page": 4,
   "box": [
    129.4,
    551.3,
    553.7,
    565.7
   ]
  },
  "access.lockbox_code": {
   "type": "text",
   "page": 4,
   "box": [
    458.6,
    510.8,
    553.7,
    525.2
   ]
  },
  "access.lockbox_location": {
   "type": "text",
   "page": 4,
   "box": [
    145.8,
    510.8,
    385.6,
    525.2
   ]
  },
  "backup.full_name": {
   "type": "text",
   "page": 16,
   "box": [
    101.2,
    70.6,
    380.6,
    84.9
   ]
  },
  "backup.primary_phone": {
   "type": "text",
   "page": 16,
   "box": [
    121.3,
    91.6,
    300.0,
    105.9
   ]
  },
  "backup.relationship_to_client": {
   "type": "text",
   "page": 16,
   "box": [
    479.8,
    70.6,
    553.7,
    84.9
   ]
  },
  "backup.secondary_phone": {
   "type": "text",
   "page": 16,
   "box": [
    387.3,
    91.6,
    553.7,
    105.9
   ]
  },
  "c1.address": {
   "type": "text",
   "page": 22,
   "box": [
    96.1,
    240.8,
    296.1,
    252.9
   ]
  },
  "c1.axis_care_notes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    371.3,
    186.0,
    380.3
   ]
  },
  "c1.axis_invoices": {
   "type": "check",
   "page": 22,
   "box": [
    259.8,
    371.3,
    268.8,
    380.3
   ]
  },
  "c1.book_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    324.1,
    236.0,
    333.1
   ]
  },
  "c1.book_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    324.1,
    186.0,
    333.1
   ]
  },
  "c1.cell_phone": {
   "type": "text",
   "page": 22,
   "box": [
    235.6,
    224.3,
    306.0,
    237.2
   ]
  },
  "c1.city": {
   "type": "text",
   "page": 22,
   "box": [
    328.9,
    240.8,
    416.2,
    252.9
   ]
  },
  "c1.email": {
   "type": "text",
   "page": 22,
   "box": [
    344.2,
    224.3,
    553.7,
    237.2
   ]
  },
  "c1.email_care_plans": {
   "type": "check",
   "page": 22,
   "box": [
    285.9,
    387.1,
    294.9,
    396.1
   ]
  },
  "c1.email_invoices": {
   "type": "check",
   "page": 22,
   "box": [
    477.6,
    387.1,
    486.6,
    396.1
   ]
  },
  "c1.email_office_messages": {
   "type": "check",
   "page": 22,
   "box": [
    367.9,
    387.1,
    376.9,
    396.1
   ]
  },
  "c1.email_weekly_calendar": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    387.1,
    186.0,
    396.1
   ]
  },
  "c1.hipaa_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    276.8,
    236.0,
    285.8
   ]
  },
  "c1.hipaa_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    276.8,
    186.0,
    285.8
   ]
  },
  "c1.home_phone": {
   "type": "text",
   "page": 22,
   "box": [
    114.1,
    224.3,
    176.1,
    237.2
   ]
  },
  "c1.medical_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    292.6,
    236.0,
    301.6
   ]
  },
  "c1.medical_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    292.6,
    186.0,
    301.6
   ]
  },
  "c1.name": {
   "type": "text",
   "page": 22,
   "box": [
    86.5,
    208.6,
    380.6,
    220.7
   ]
  },
  "c1.poa_financial": {
   "type": "check",
   "page": 22,
   "box": [
    240.0,
    308.3,
    249.0,
    317.3
   ]
  },
  "c1.poa_health": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    308.3,
    186.0,
    317.3
   ]
  },
  "c1.poa_none": {
   "type": "check",
   "page": 22,
   "box": [
    313.8,
    308.3,
    322.8,
    317.3
   ]
  },
  "c1.relationship": {
   "type": "text",
   "page": 22,
   "box": [
    445.9,
    208.6,
    553.7,
    220.7
   ]
  },
  "c1.state": {
   "type": "text",
   "page": 22,
   "box": [
    453.7,
    240.8,
    476.9,
    252.9
   ]
  },
  "c1.text_caregiver_change": {
   "type": "check",
   "page": 22,
   "box": [
    266.7,
    355.6,
    275.7,
    364.6
   ]
  },
  "c1.text_running_late": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    355.6,
    186.0,
    364.6
   ]
  },
  "c1.zip": {
   "type": "text",
   "page": 22,
   "box": [
    506.3,
    240.8,
    553.7,
    252.9
   ]
  },
  "c2.address": {
   "type": "text",
   "page": 22,
   "box": [
    96.1,
    465.1,
    296.1,
    477.2
   ]
  },
  "c2.axis_care_notes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    595.6,
    186.0,
    604.6
   ]
  },
  "c2.axis_invoices": {
   "type": "check",
   "page": 22,
   "box": [
    259.8,
    595.6,
    268.8,
    604.6
   ]
  },
  "c2.book_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    548.3,
    236.0,
    557.3
   ]
  },
  "c2.book_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    548.3,
    186.0,
    557.3
   ]
  },
  "c2.cell_phone": {
   "type": "text",
   "page": 22,
   "box": [
    235.6,
    449.3,
    306.0,
    461.4
   ]
  },
  "c2.city": {
   "type": "text",
   "page": 22,
   "box": [
    328.9,
    465.1,
    416.2,
    477.2
   ]
  },
  "c2.email": {
   "type": "text",
   "page": 22,
   "box": [
    344.2,
    449.3,
    553.7,
    461.4
   ]
  },
  "c2.email_care_plans": {
   "type": "check",
   "page": 22,
   "box": [
    285.9,
    611.3,
    294.9,
    620.3
   ]
  },
  "c2.email_invoices": {
   "type": "check",
   "page": 22,
   "box": [
    477.6,
    611.3,
    486.6,
    620.3
   ]
  },
  "c2.email_office_messages": {
   "type": "check",
   "page": 22,
   "box": [
    367.9,
    611.3,
    376.9,
    620.3
   ]
  },
  "c2.email_weekly_calendar": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    611.3,
    186.0,
    620.3
   ]
  },
  "c2.hipaa_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    501.1,
    236.0,
    510.1
   ]
  },
  "c2.hipaa_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    501.1,
    186.0,
    510.1
   ]
  },
  "c2.home_phone": {
   "type": "text",
   "page": 22,
   "box": [
    114.1,
    449.3,
    176.1,
    461.4
   ]
  },
  "c2.medical_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    516.8,
    236.0,
    525.8
   ]
  },
  "c2.medical_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    516.8,
    186.0,
    525.8
   ]
  },
  "c2.name": {
   "type": "text",
   "page": 22,
   "box": [
    86.5,
    432.8,
    380.6,
    445.7
   ]
  },
  "c2.poa_financial": {
   "type": "check",
   "page": 22,
   "box": [
    240.0,
    532.6,
    249.0,
    541.6
   ]
  },
  "c2.poa_health": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    532.6,
    186.0,
    541.6
   ]
  },
  "c2.poa_none": {
   "type": "check",
   "page": 22,
   "box": [
    313.8,
    532.6,
    322.8,
    541.6
   ]
  },
  "c2.relationship": {
   "type": "text",
   "page": 22,
   "box": [
    445.9,
    432.8,
    553.7,
    445.7
   ]
  },
  "c2.state": {
   "type": "text",
   "page": 22,
   "box": [
    453.7,
    465.1,
    476.9,
    477.2
   ]
  },
  "c2.text_caregiver_change": {
   "type": "check",
   "page": 22,
   "box": [
    266.7,
    579.8,
    275.7,
    588.8
   ]
  },
  "c2.text_running_late": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    579.8,
    186.0,
    588.8
   ]
  },
  "c2.zip": {
   "type": "text",
   "page": 22,
   "box": [
    506.3,
    465.1,
    553.7,
    477.2
   ]
  },
  "c3.address": {
   "type": "text",
   "page": 23,
   "box": [
    96.1,
    99.8,
    296.1,
    111.9
   ]
  },
  "c3.axis_care_notes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    230.3,
    186.0,
    239.3
   ]
  },
  "c3.axis_invoices": {
   "type": "check",
   "page": 23,
   "box": [
    259.8,
    230.3,
    268.8,
    239.3
   ]
  },
  "c3.book_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    183.1,
    236.0,
    192.1
   ]
  },
  "c3.book_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    183.1,
    186.0,
    192.1
   ]
  },
  "c3.cell_phone": {
   "type": "text",
   "page": 23,
   "box": [
    235.6,
    83.3,
    306.0,
    96.2
   ]
  },
  "c3.city": {
   "type": "text",
   "page": 23,
   "box": [
    328.9,
    99.8,
    416.2,
    111.9
   ]
  },
  "c3.email": {
   "type": "text",
   "page": 23,
   "box": [
    344.2,
    83.3,
    553.7,
    96.2
   ]
  },
  "c3.email_care_plans": {
   "type": "check",
   "page": 23,
   "box": [
    285.9,
    246.1,
    294.9,
    255.1
   ]
  },
  "c3.email_invoices": {
   "type": "check",
   "page": 23,
   "box": [
    477.6,
    246.1,
    486.6,
    255.1
   ]
  },
  "c3.email_office_messages": {
   "type": "check",
   "page": 23,
   "box": [
    367.9,
    246.1,
    376.9,
    255.1
   ]
  },
  "c3.email_weekly_calendar": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    246.1,
    186.0,
    255.1
   ]
  },
  "c3.hipaa_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    135.8,
    236.0,
    144.8
   ]
  },
  "c3.hipaa_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    135.8,
    186.0,
    144.8
   ]
  },
  "c3.home_phone": {
   "type": "text",
   "page": 23,
   "box": [
    114.1,
    83.3,
    176.1,
    96.2
   ]
  },
  "c3.medical_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    151.6,
    236.0,
    160.6
   ]
  },
  "c3.medical_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    151.6,
    186.0,
    160.6
   ]
  },
  "c3.name": {
   "type": "text",
   "page": 23,
   "box": [
    86.5,
    67.6,
    380.6,
    79.7
   ]
  },
  "c3.poa_financial": {
   "type": "check",
   "page": 23,
   "box": [
    240.0,
    167.3,
    249.0,
    176.3
   ]
  },
  "c3.poa_health": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    167.3,
    186.0,
    176.3
   ]
  },
  "c3.poa_none": {
   "type": "check",
   "page": 23,
   "box": [
    313.8,
    167.3,
    322.8,
    176.3
   ]
  },
  "c3.relationship": {
   "type": "text",
   "page": 23,
   "box": [
    445.9,
    67.6,
    553.7,
    79.7
   ]
  },
  "c3.state": {
   "type": "text",
   "page": 23,
   "box": [
    453.7,
    99.8,
    476.9,
    111.9
   ]
  },
  "c3.text_caregiver_change": {
   "type": "check",
   "page": 23,
   "box": [
    266.7,
    214.6,
    275.7,
    223.6
   ]
  },
  "c3.text_running_late": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    214.6,
    186.0,
    223.6
   ]
  },
  "c3.zip": {
   "type": "text",
   "page": 23,
   "box": [
    506.3,
    99.8,
    553.7,
    111.9
   ]
  },
  "c4.address": {
   "type": "text",
   "page": 23,
   "box": [
    96.1,
    324.1,
    296.1,
    336.9
   ]
  },
  "c4.axis_care_notes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    454.6,
    186.0,
    463.6
   ]
  },
  "c4.axis_invoices": {
   "type": "check",
   "page": 23,
   "box": [
    259.8,
    454.6,
    268.8,
    463.6
   ]
  },
  "c4.book_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    408.1,
    236.0,
    417.1
   ]
  },
  "c4.book_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    408.1,
    186.0,
    417.1
   ]
  },
  "c4.cell_phone": {
   "type": "text",
   "page": 23,
   "box": [
    235.6,
    308.3,
    306.0,
    320.4
   ]
  },
  "c4.city": {
   "type": "text",
   "page": 23,
   "box": [
    328.9,
    324.1,
    416.2,
    336.9
   ]
  },
  "c4.email": {
   "type": "text",
   "page": 23,
   "box": [
    344.2,
    308.3,
    553.7,
    320.4
   ]
  },
  "c4.email_care_plans": {
   "type": "check",
   "page": 23,
   "box": [
    285.9,
    470.3,
    294.9,
    479.3
   ]
  },
  "c4.email_invoices": {
   "type": "check",
   "page": 23,
   "box": [
    477.6,
    470.3,
    486.6,
    479.3
   ]
  },
  "c4.email_office_messages": {
   "type": "check",
   "page": 23,
   "box": [
    367.9,
    470.3,
    376.9,
    479.3
   ]
  },
  "c4.email_weekly_calendar": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    470.3,
    186.0,
    479.3
   ]
  },
  "c4.hipaa_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    360.8,
    236.0,
    369.8
   ]
  },
  "c4.hipaa_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    360.8,
    186.0,
    369.8
   ]
  },
  "c4.home_phone": {
   "type": "text",
   "page": 23,
   "box": [
    114.1,
    308.3,
    176.1,
    320.4
   ]
  },
  "c4.medical_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    376.6,
    236.0,
    385.6
   ]
  },
  "c4.medical_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    376.6,
    186.0,
    385.6
   ]
  },
  "c4.name": {
   "type": "text",
   "page": 23,
   "box": [
    86.5,
    292.6,
    380.6,
    304.7
   ]
  },
  "c4.poa_financial": {
   "type": "check",
   "page": 23,
   "box": [
    240.0,
    392.3,
    249.0,
    401.3
   ]
  },
  "c4.poa_health": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    392.3,
    186.0,
    401.3
   ]
  },
  "c4.poa_none": {
   "type": "check",
   "page": 23,
   "box": [
    313.8,
    392.3,
    322.8,
    401.3
   ]
  },
  "c4.relationship": {
   "type": "text",
   "page": 23,
   "box": [
    445.9,
    292.6,
    553.7,
    304.7
   ]
  },
  "c4.state": {
   "type": "text",
   "page": 23,
   "box": [
    453.7,
    324.1,
    476.9,
    336.9
   ]
  },
  "c4.text_caregiver_change": {
   "type": "check",
   "page": 23,
   "box": [
    266.7,
    438.8,
    275.7,
    447.8
   ]
  },
  "c4.text_running_late": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    438.8,
    186.0,
    447.8
   ]
  },
  "c4.zip": {
   "type": "text",
   "page": 23,
   "box": [
    506.3,
    324.1,
    553.7,
    336.9
   ]
  },
  "car.accept": {
   "type": "check",
   "page": 5,
   "box": [
    178.8,
    672.1,
    187.8,
    681.1
   ]
  },
  "car.decline": {
   "type": "check",
   "page": 5,
   "box": [
    240.5,
    672.1,
    249.5,
    681.1
   ]
  },
  "ci.client_s_name": {
   "type": "text",
   "page": 22,
   "box": [
    116.3,
    150.1,
    380.6,
    164.4
   ]
  },
  "ci.date_of_birth": {
   "type": "text",
   "page": 22,
   "box": [
    447.0,
    150.1,
    553.7,
    164.4
   ]
  },
  "ci.sig.date": {
   "type": "text",
   "page": 23,
   "box": [
    335.3,
    637.6,
    552.7,
    651.9
   ]
  },
  "ci.sig.printed_name": {
   "type": "text",
   "page": 23,
   "box": [
    116.9,
    637.6,
    300.0,
    651.9
   ]
  },
  "ci.sig.signature": {
   "type": "signature",
   "page": 23,
   "box": [
    102.1,
    670.6,
    552.7,
    684.9
   ]
  },
  "client.address": {
   "type": "text",
   "page": 1,
   "box": [
    96.1,
    354.1,
    327.7,
    368.4
   ]
  },
  "client.city": {
   "type": "text",
   "page": 1,
   "box": [
    360.5,
    354.1,
    474.4,
    368.4
   ]
  },
  "client.client_s_name": {
   "type": "text",
   "page": 1,
   "box": [
    117.3,
    333.1,
    380.6,
    347.4
   ]
  },
  "client.phone_number": {
   "type": "text",
   "page": 1,
   "box": [
    121.3,
    375.1,
    553.7,
    389.4
   ]
  },
  "client.spouse": {
   "type": "text",
   "page": 1,
   "box": [
    427.4,
    333.1,
    553.7,
    347.4
   ]
  },
  "client.zip": {
   "type": "text",
   "page": 1,
   "box": [
    503.8,
    354.1,
    553.7,
    368.4
   ]
  },
  "comm.accept": {
   "type": "check",
   "page": 8,
   "box": [
    450.4,
    245.3,
    459.4,
    254.3
   ]
  },
  "comm.decline": {
   "type": "check",
   "page": 8,
   "box": [
    512.1,
    245.3,
    521.1,
    254.3
   ]
  },
  "date.day": {
   "type": "text",
   "page": 1,
   "box": [
    176.9,
    273.8,
    210.9,
    284.4
   ]
  },
  "date.month": {
   "type": "text",
   "page": 1,
   "box": [
    244.8,
    273.8,
    354.8,
    284.4
   ]
  },
  "date.year": {
   "type": "text",
   "page": 1,
   "box": [
    372.2,
    273.8,
    398.2,
    284.4
   ]
  },
  "ini.1": {
   "type": "initials",
   "page": 3,
   "box": [
    501.0,
    536.3,
    560.7,
    555.9
   ]
  },
  "ini.2": {
   "type": "initials",
   "page": 5,
   "box": [
    501.0,
    300.8,
    560.7,
    321.2
   ]
  },
  "ini.3": {
   "type": "initials",
   "page": 5,
   "box": [
    497.1,
    667.6,
    556.7,
    687.9
   ]
  },
  "ini.4": {
   "type": "initials",
   "page": 8,
   "box": [
    501.0,
    376.6,
    560.7,
    396.9
   ]
  },
  "ini.5": {
   "type": "initials",
   "page": 10,
   "box": [
    501.0,
    453.8,
    560.7,
    474.2
   ]
  },
  "ini.6": {
   "type": "initials",
   "page": 21,
   "box": [
    501.0,
    387.1,
    560.7,
    407.4
   ]
  },
  "level.advanced_care": {
   "type": "check",
   "page": 2,
   "box": [
    249.7,
    171.8,
    258.7,
    180.8
   ]
  },
  "level.hourly_rate": {
   "type": "text",
   "page": 2,
   "box": [
    115.1,
    190.6,
    288.6,
    204.9
   ]
  },
  "level.personal_care": {
   "type": "check",
   "page": 2,
   "box": [
    154.5,
    171.8,
    163.5,
    180.8
   ]
  },
  "level.wellness_care": {
   "type": "check",
   "page": 2,
   "box": [
    58.2,
    171.8,
    67.2,
    180.8
   ]
  },
  "photos.marketing": {
   "type": "check",
   "page": 7,
   "box": [
    422.1,
    366.8,
    431.1,
    375.8
   ]
  },
  "photos.no_photos": {
   "type": "check",
   "page": 7,
   "box": [
    499.1,
    366.8,
    508.1,
    375.8
   ]
  },
  "photos.share_with_my_family": {
   "type": "check",
   "page": 7,
   "box": [
    296.3,
    366.8,
    305.3,
    375.8
   ]
  },
  "poa.cell_phone": {
   "type": "text",
   "page": 1,
   "box": [
    105.7,
    469.6,
    219.4,
    483.9
   ]
  },
  "poa.email": {
   "type": "text",
   "page": 1,
   "box": [
    257.6,
    469.6,
    553.7,
    483.9
   ]
  },
  "poa.initials": {
   "type": "initials",
   "page": 1,
   "box": [
    489.3,
    491.3,
    549.0,
    511.7
   ]
  },
  "poa.name": {
   "type": "text",
   "page": 1,
   "box": [
    86.5,
    448.6,
    380.6,
    462.9
   ]
  },
  "poa.relationship": {
   "type": "text",
   "page": 1,
   "box": [
    445.9,
    448.6,
    553.7,
    462.9
   ]
  },
  "rates.advanced_care": {
   "type": "check",
   "page": 11,
   "box": [
    52.5,
    249.8,
    61.5,
    258.8
   ]
  },
  "rates.personal_care": {
   "type": "check",
   "page": 11,
   "box": [
    52.5,
    214.6,
    61.5,
    223.6
   ]
  },
  "rates.wellness_care": {
   "type": "check",
   "page": 11,
   "box": [
    52.5,
    178.6,
    61.5,
    187.6
   ]
  },
  "sig.admin.date": {
   "type": "text",
   "page": 10,
   "box": [
    350.1,
    582.1,
    552.7,
    596.4
   ]
  },
  "sig.admin.printed_name": {
   "type": "text",
   "page": 10,
   "box": [
    384.3,
    513.1,
    552.7,
    527.4
   ]
  },
  "sig.admin.signature": {
   "type": "signature",
   "page": 10,
   "box": [
    369.6,
    537.8,
    552.7,
    561.2
   ]
  },
  "sig.client.date": {
   "type": "text",
   "page": 10,
   "box": [
    82.6,
    582.1,
    285.2,
    596.4
   ]
  },
  "sig.client.printed_name": {
   "type": "text",
   "page": 10,
   "box": [
    116.9,
    513.1,
    285.2,
    527.4
   ]
  },
  "sig.client.signature": {
   "type": "signature",
   "page": 10,
   "box": [
    102.1,
    537.8,
    285.2,
    561.2
   ]
  },
  "vehicle.car_make_model": {
   "type": "text",
   "page": 6,
   "box": [
    135.6,
    88.6,
    380.6,
    102.9
   ]
  },
  "vehicle.driver_s_license": {
   "type": "text",
   "page": 6,
   "box": [
    124.6,
    130.6,
    380.6,
    144.9
   ]
  },
  "vehicle.expiration_date": {
   "type": "text",
   "page": 6,
   "box": [
    456.8,
    109.6,
    553.7,
    123.9
   ]
  },
  "vehicle.expiration_date_2": {
   "type": "text",
   "page": 6,
   "box": [
    456.8,
    130.6,
    553.7,
    144.9
   ]
  },
  "vehicle.insurance": {
   "type": "text",
   "page": 6,
   "box": [
    102.4,
    109.6,
    380.6,
    123.9
   ]
  },
  "vehicle.spare_key_location": {
   "type": "text",
   "page": 6,
   "box": [
    136.5,
    151.6,
    553.7,
    165.9
   ]
  },
  "vehicle.year": {
   "type": "text",
   "page": 6,
   "box": [
    415.5,
    88.6,
    553.7,
    102.9
   ]
  }
}
