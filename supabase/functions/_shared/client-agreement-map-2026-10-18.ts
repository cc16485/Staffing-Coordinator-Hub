// =============================================================================
// client-agreement-map-2026-10-18.ts · the THIRD Client Care Agreement master (Rev. 10/2026, overtime counted Monday to Sunday,
// signed from 2026-10-18 until the Booking App section and the "Can book in the app" choice on Exhibit I were added later that
// day). Kept unchanged so agreements signed on it are always rebuilt (countersign, the family's printed and emailed copies) on
// the exact wording the family read. Never edit; never delete.
// =============================================================================
export const DOC = 'client-care-agreement'
export const VERSION = "Rev. 10/2026"
export const PAGES = 23
export const PDF_SHA256 = "ce326142e4593c7caac65cc549e6992af8808eebbaac1f0fcdcababef0b8be11"
export const MASTER_PATH = 'master/client-care-agreement-rev-2026-10-18.pdf'
export type FieldType = 'text' | 'check' | 'initials' | 'signature'
export type Field = { type: FieldType; page: number; box: [number, number, number, number] }
export const FIELDS: Record<string, Field> = {
  "access.1_client_responsible_party": {
   "type": "check",
   "page": 4,
   "box": [
    58.2,
    321.1,
    67.2,
    330.1
   ]
  },
  "access.2_lockbox_access_a_ke": {
   "type": "check",
   "page": 4,
   "box": [
    58.2,
    354.8,
    67.2,
    363.8
   ]
  },
  "access.3_garage_door_access_code": {
   "type": "check",
   "page": 4,
   "box": [
    58.2,
    408.8,
    67.2,
    417.8
   ]
  },
  "access.4_other_access_option": {
   "type": "check",
   "page": 4,
   "box": [
    58.2,
    449.3,
    67.2,
    458.3
   ]
  },
  "access.describe": {
   "type": "text",
   "page": 4,
   "box": [
    113.8,
    466.6,
    553.7,
    480.9
   ]
  },
  "access.garage_code": {
   "type": "text",
   "page": 4,
   "box": [
    129.4,
    426.8,
    553.7,
    441.2
   ]
  },
  "access.lockbox_code": {
   "type": "text",
   "page": 4,
   "box": [
    458.6,
    386.3,
    553.7,
    400.7
   ]
  },
  "access.lockbox_location": {
   "type": "text",
   "page": 4,
   "box": [
    145.8,
    386.3,
    385.6,
    400.7
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
    241.6,
    296.1,
    253.7
   ]
  },
  "c1.axis_care_notes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    363.1,
    186.0,
    372.1
   ]
  },
  "c1.axis_invoices": {
   "type": "check",
   "page": 22,
   "box": [
    259.8,
    363.1,
    268.8,
    372.1
   ]
  },
  "c1.cell_phone": {
   "type": "text",
   "page": 22,
   "box": [
    235.6,
    225.8,
    306.0,
    237.9
   ]
  },
  "c1.city": {
   "type": "text",
   "page": 22,
   "box": [
    328.9,
    241.6,
    416.2,
    253.7
   ]
  },
  "c1.email": {
   "type": "text",
   "page": 22,
   "box": [
    344.2,
    225.8,
    553.7,
    237.9
   ]
  },
  "c1.email_care_plans": {
   "type": "check",
   "page": 22,
   "box": [
    285.9,
    381.1,
    294.9,
    390.1
   ]
  },
  "c1.email_invoices": {
   "type": "check",
   "page": 22,
   "box": [
    477.6,
    381.1,
    486.6,
    390.1
   ]
  },
  "c1.email_office_messages": {
   "type": "check",
   "page": 22,
   "box": [
    367.9,
    381.1,
    376.9,
    390.1
   ]
  },
  "c1.email_weekly_calendar": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    381.1,
    186.0,
    390.1
   ]
  },
  "c1.hipaa_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    278.3,
    236.0,
    287.3
   ]
  },
  "c1.hipaa_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    278.3,
    186.0,
    287.3
   ]
  },
  "c1.home_phone": {
   "type": "text",
   "page": 22,
   "box": [
    114.1,
    225.8,
    176.1,
    237.9
   ]
  },
  "c1.medical_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    296.3,
    236.0,
    305.3
   ]
  },
  "c1.medical_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    296.3,
    186.0,
    305.3
   ]
  },
  "c1.name": {
   "type": "text",
   "page": 22,
   "box": [
    86.5,
    209.3,
    380.6,
    222.2
   ]
  },
  "c1.poa_financial": {
   "type": "check",
   "page": 22,
   "box": [
    240.0,
    313.6,
    249.0,
    322.6
   ]
  },
  "c1.poa_health": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    313.6,
    186.0,
    322.6
   ]
  },
  "c1.poa_none": {
   "type": "check",
   "page": 22,
   "box": [
    313.8,
    313.6,
    322.8,
    322.6
   ]
  },
  "c1.relationship": {
   "type": "text",
   "page": 22,
   "box": [
    445.9,
    209.3,
    553.7,
    222.2
   ]
  },
  "c1.state": {
   "type": "text",
   "page": 22,
   "box": [
    453.7,
    241.6,
    476.9,
    253.7
   ]
  },
  "c1.text_caregiver_change": {
   "type": "check",
   "page": 22,
   "box": [
    266.7,
    345.8,
    275.7,
    354.8
   ]
  },
  "c1.text_running_late": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    345.8,
    186.0,
    354.8
   ]
  },
  "c1.zip": {
   "type": "text",
   "page": 22,
   "box": [
    506.3,
    241.6,
    553.7,
    253.7
   ]
  },
  "c2.address": {
   "type": "text",
   "page": 22,
   "box": [
    96.1,
    462.8,
    296.1,
    475.7
   ]
  },
  "c2.axis_care_notes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    585.1,
    186.0,
    594.1
   ]
  },
  "c2.axis_invoices": {
   "type": "check",
   "page": 22,
   "box": [
    259.8,
    585.1,
    268.8,
    594.1
   ]
  },
  "c2.cell_phone": {
   "type": "text",
   "page": 22,
   "box": [
    235.6,
    447.1,
    306.0,
    459.2
   ]
  },
  "c2.city": {
   "type": "text",
   "page": 22,
   "box": [
    328.9,
    462.8,
    416.2,
    475.7
   ]
  },
  "c2.email": {
   "type": "text",
   "page": 22,
   "box": [
    344.2,
    447.1,
    553.7,
    459.2
   ]
  },
  "c2.email_care_plans": {
   "type": "check",
   "page": 22,
   "box": [
    285.9,
    602.3,
    294.9,
    611.3
   ]
  },
  "c2.email_invoices": {
   "type": "check",
   "page": 22,
   "box": [
    477.6,
    602.3,
    486.6,
    611.3
   ]
  },
  "c2.email_office_messages": {
   "type": "check",
   "page": 22,
   "box": [
    367.9,
    602.3,
    376.9,
    611.3
   ]
  },
  "c2.email_weekly_calendar": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    602.3,
    186.0,
    611.3
   ]
  },
  "c2.hipaa_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    500.3,
    236.0,
    509.3
   ]
  },
  "c2.hipaa_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    500.3,
    186.0,
    509.3
   ]
  },
  "c2.home_phone": {
   "type": "text",
   "page": 22,
   "box": [
    114.1,
    447.1,
    176.1,
    459.2
   ]
  },
  "c2.medical_no": {
   "type": "check",
   "page": 22,
   "box": [
    227.0,
    517.6,
    236.0,
    526.6
   ]
  },
  "c2.medical_yes": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    517.6,
    186.0,
    526.6
   ]
  },
  "c2.name": {
   "type": "text",
   "page": 22,
   "box": [
    86.5,
    431.3,
    380.6,
    443.4
   ]
  },
  "c2.poa_financial": {
   "type": "check",
   "page": 22,
   "box": [
    240.0,
    534.8,
    249.0,
    543.8
   ]
  },
  "c2.poa_health": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    534.8,
    186.0,
    543.8
   ]
  },
  "c2.poa_none": {
   "type": "check",
   "page": 22,
   "box": [
    313.8,
    534.8,
    322.8,
    543.8
   ]
  },
  "c2.relationship": {
   "type": "text",
   "page": 22,
   "box": [
    445.9,
    431.3,
    553.7,
    443.4
   ]
  },
  "c2.state": {
   "type": "text",
   "page": 22,
   "box": [
    453.7,
    462.8,
    476.9,
    475.7
   ]
  },
  "c2.text_caregiver_change": {
   "type": "check",
   "page": 22,
   "box": [
    266.7,
    567.8,
    275.7,
    576.8
   ]
  },
  "c2.text_running_late": {
   "type": "check",
   "page": 22,
   "box": [
    177.0,
    567.8,
    186.0,
    576.8
   ]
  },
  "c2.zip": {
   "type": "text",
   "page": 22,
   "box": [
    506.3,
    462.8,
    553.7,
    475.7
   ]
  },
  "c3.address": {
   "type": "text",
   "page": 23,
   "box": [
    96.1,
    100.6,
    296.1,
    112.7
   ]
  },
  "c3.axis_care_notes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    222.8,
    186.0,
    231.8
   ]
  },
  "c3.axis_invoices": {
   "type": "check",
   "page": 23,
   "box": [
    259.8,
    222.8,
    268.8,
    231.8
   ]
  },
  "c3.cell_phone": {
   "type": "text",
   "page": 23,
   "box": [
    235.6,
    84.8,
    306.0,
    96.9
   ]
  },
  "c3.city": {
   "type": "text",
   "page": 23,
   "box": [
    328.9,
    100.6,
    416.2,
    112.7
   ]
  },
  "c3.email": {
   "type": "text",
   "page": 23,
   "box": [
    344.2,
    84.8,
    553.7,
    96.9
   ]
  },
  "c3.email_care_plans": {
   "type": "check",
   "page": 23,
   "box": [
    285.9,
    240.1,
    294.9,
    249.1
   ]
  },
  "c3.email_invoices": {
   "type": "check",
   "page": 23,
   "box": [
    477.6,
    240.1,
    486.6,
    249.1
   ]
  },
  "c3.email_office_messages": {
   "type": "check",
   "page": 23,
   "box": [
    367.9,
    240.1,
    376.9,
    249.1
   ]
  },
  "c3.email_weekly_calendar": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    240.1,
    186.0,
    249.1
   ]
  },
  "c3.hipaa_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    138.1,
    236.0,
    147.1
   ]
  },
  "c3.hipaa_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    138.1,
    186.0,
    147.1
   ]
  },
  "c3.home_phone": {
   "type": "text",
   "page": 23,
   "box": [
    114.1,
    84.8,
    176.1,
    96.9
   ]
  },
  "c3.medical_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    155.3,
    236.0,
    164.3
   ]
  },
  "c3.medical_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    155.3,
    186.0,
    164.3
   ]
  },
  "c3.name": {
   "type": "text",
   "page": 23,
   "box": [
    86.5,
    68.3,
    380.6,
    81.2
   ]
  },
  "c3.poa_financial": {
   "type": "check",
   "page": 23,
   "box": [
    240.0,
    172.6,
    249.0,
    181.6
   ]
  },
  "c3.poa_health": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    172.6,
    186.0,
    181.6
   ]
  },
  "c3.poa_none": {
   "type": "check",
   "page": 23,
   "box": [
    313.8,
    172.6,
    322.8,
    181.6
   ]
  },
  "c3.relationship": {
   "type": "text",
   "page": 23,
   "box": [
    445.9,
    68.3,
    553.7,
    81.2
   ]
  },
  "c3.state": {
   "type": "text",
   "page": 23,
   "box": [
    453.7,
    100.6,
    476.9,
    112.7
   ]
  },
  "c3.text_caregiver_change": {
   "type": "check",
   "page": 23,
   "box": [
    266.7,
    204.8,
    275.7,
    213.8
   ]
  },
  "c3.text_running_late": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    204.8,
    186.0,
    213.8
   ]
  },
  "c3.zip": {
   "type": "text",
   "page": 23,
   "box": [
    506.3,
    100.6,
    553.7,
    112.7
   ]
  },
  "c4.address": {
   "type": "text",
   "page": 23,
   "box": [
    96.1,
    321.8,
    296.1,
    334.7
   ]
  },
  "c4.axis_care_notes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    444.1,
    186.0,
    453.1
   ]
  },
  "c4.axis_invoices": {
   "type": "check",
   "page": 23,
   "box": [
    259.8,
    444.1,
    268.8,
    453.1
   ]
  },
  "c4.cell_phone": {
   "type": "text",
   "page": 23,
   "box": [
    235.6,
    306.1,
    306.0,
    318.2
   ]
  },
  "c4.city": {
   "type": "text",
   "page": 23,
   "box": [
    328.9,
    321.8,
    416.2,
    334.7
   ]
  },
  "c4.email": {
   "type": "text",
   "page": 23,
   "box": [
    344.2,
    306.1,
    553.7,
    318.2
   ]
  },
  "c4.email_care_plans": {
   "type": "check",
   "page": 23,
   "box": [
    285.9,
    461.3,
    294.9,
    470.3
   ]
  },
  "c4.email_invoices": {
   "type": "check",
   "page": 23,
   "box": [
    477.6,
    461.3,
    486.6,
    470.3
   ]
  },
  "c4.email_office_messages": {
   "type": "check",
   "page": 23,
   "box": [
    367.9,
    461.3,
    376.9,
    470.3
   ]
  },
  "c4.email_weekly_calendar": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    461.3,
    186.0,
    470.3
   ]
  },
  "c4.hipaa_no": {
   "type": "check",
   "page": 23,
   "box": [
    227.0,
    359.3,
    236.0,
    368.3
   ]
  },
  "c4.hipaa_yes": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    359.3,
    186.0,
    368.3
   ]
  },
  "c4.home_phone": {
   "type": "text",
   "page": 23,
   "box": [
    114.1,
    306.1,
    176.1,
    318.2
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
    290.3,
    380.6,
    302.4
   ]
  },
  "c4.poa_financial": {
   "type": "check",
   "page": 23,
   "box": [
    240.0,
    393.8,
    249.0,
    402.8
   ]
  },
  "c4.poa_health": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    393.8,
    186.0,
    402.8
   ]
  },
  "c4.poa_none": {
   "type": "check",
   "page": 23,
   "box": [
    313.8,
    393.8,
    322.8,
    402.8
   ]
  },
  "c4.relationship": {
   "type": "text",
   "page": 23,
   "box": [
    445.9,
    290.3,
    553.7,
    302.4
   ]
  },
  "c4.state": {
   "type": "text",
   "page": 23,
   "box": [
    453.7,
    321.8,
    476.9,
    334.7
   ]
  },
  "c4.text_caregiver_change": {
   "type": "check",
   "page": 23,
   "box": [
    266.7,
    426.8,
    275.7,
    435.8
   ]
  },
  "c4.text_running_late": {
   "type": "check",
   "page": 23,
   "box": [
    177.0,
    426.8,
    186.0,
    435.8
   ]
  },
  "c4.zip": {
   "type": "text",
   "page": 23,
   "box": [
    506.3,
    321.8,
    553.7,
    334.7
   ]
  },
  "car.accept": {
   "type": "check",
   "page": 5,
   "box": [
    178.8,
    564.8,
    187.8,
    573.8
   ]
  },
  "car.decline": {
   "type": "check",
   "page": 5,
   "box": [
    240.5,
    564.8,
    249.5,
    573.8
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
    627.8,
    552.7,
    642.2
   ]
  },
  "ci.sig.printed_name": {
   "type": "text",
   "page": 23,
   "box": [
    116.9,
    627.8,
    300.0,
    642.2
   ]
  },
  "ci.sig.signature": {
   "type": "signature",
   "page": 23,
   "box": [
    102.1,
    660.8,
    552.7,
    675.1
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
    118.6,
    459.4,
    127.6
   ]
  },
  "comm.decline": {
   "type": "check",
   "page": 8,
   "box": [
    512.1,
    118.6,
    521.1,
    127.6
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
    405.1,
    560.7,
    424.7
   ]
  },
  "ini.2": {
   "type": "initials",
   "page": 5,
   "box": [
    501.0,
    194.3,
    560.7,
    213.9
   ]
  },
  "ini.3": {
   "type": "initials",
   "page": 5,
   "box": [
    497.1,
    560.3,
    556.7,
    580.7
   ]
  },
  "ini.4": {
   "type": "initials",
   "page": 8,
   "box": [
    501.0,
    249.1,
    560.7,
    269.4
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
    232.6,
    431.1,
    241.6
   ]
  },
  "photos.no_photos": {
   "type": "check",
   "page": 7,
   "box": [
    499.1,
    232.6,
    508.1,
    241.6
   ]
  },
  "photos.share_with_my_family": {
   "type": "check",
   "page": 7,
   "box": [
    296.3,
    232.6,
    305.3,
    241.6
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
   "page": 5,
   "box": [
    135.6,
    633.1,
    380.6,
    647.4
   ]
  },
  "vehicle.driver_s_license": {
   "type": "text",
   "page": 5,
   "box": [
    124.6,
    675.1,
    380.6,
    689.4
   ]
  },
  "vehicle.expiration_date": {
   "type": "text",
   "page": 5,
   "box": [
    456.8,
    654.1,
    553.7,
    668.4
   ]
  },
  "vehicle.expiration_date_2": {
   "type": "text",
   "page": 5,
   "box": [
    456.8,
    675.1,
    553.7,
    689.4
   ]
  },
  "vehicle.insurance": {
   "type": "text",
   "page": 5,
   "box": [
    102.4,
    654.1,
    380.6,
    668.4
   ]
  },
  "vehicle.spare_key_location": {
   "type": "text",
   "page": 5,
   "box": [
    136.5,
    696.1,
    553.7,
    710.4
   ]
  },
  "vehicle.year": {
   "type": "text",
   "page": 5,
   "box": [
    415.5,
    633.1,
    553.7,
    647.4
   ]
  }
}
