/* registry.js · EVERY ACTION BEHIND THE DOOR (Phase 1, Slice 3, 2026-10-11).
   One line per contract action: what it is called, the words a person reads, its area, who it reaches (audience) and
   whether it changes anything. The contracts declare themselves against this list (contract.ts refuses an action that
   is not here), the 582 SQL seeds action_registry from it (a test proves they match), and the Owners Hub "Who may do
   what" view reads that table. Same shape as verbs.js: no import or export, valid for the page and the server.
   audience: none | staff | caregiver | applicant | family   (fixed per action, never per call) */
(function (root) {
  var R = {
    'client_fact.record':        { contract: 'client-fact', label: 'record a fact about a client',       area: 'clients', audience: 'none', mutating: true },
    'client_fact.record_person': { contract: 'client-fact', label: 'record a person on the Journey',     area: 'clients', audience: 'none', mutating: true },
    'client_fact.care_began':    { contract: 'client-fact', label: 'check whether care has begun',      area: 'clients', audience: 'none', mutating: false },
    'call_place.place':          { contract: 'call-place',  label: 'say who an unmatched call was with', area: 'comms',   audience: 'none', mutating: true }
  };
  root.CC_REGISTRY = {
    ACTIONS: R,
    get: function (a) { return Object.prototype.hasOwnProperty.call(R, a) ? R[a] : null; },
    list: function () { return Object.keys(R); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
