'use strict';

const crypto = require('node:crypto');

const STALE_AFTER_HOURS = 12;
const SOURCES = Object.freeze({
  PJE: 'pje',
  DJEN: 'djen',
  DATAJUD: 'datajud',
  LOCAL: 'local_bridge',
  MANUAL: 'manual'
});

const OFFICIAL = new Set([SOURCES.PJE, SOURCES.DJEN, SOURCES.DATAJUD]);

function normalizeSource(input = {}) {
  const source = String(input.source || '').toLowerCase();
  const observedAt = input.observed_at || input.observedAt || null;
  const ok = input.ok === true;
  return Object.freeze({
    source,
    official: OFFICIAL.has(source),
    ok,
    observed_at: observedAt,
    explicit_no_change: input.explicit_no_change === true,
    movement_received: input.movement_received === true,
    document_hash: input.document_hash || null,
    reference: input.reference || null,
    error: input.error || null
  });
}

function isFreshObservedAt(observedAt, now = new Date()) {
  if (!observedAt) return false;
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return false;
  const ageHours = (now.getTime() - observed) / 36e5;
  return ageHours >= 0 && ageHours <= STALE_AFTER_HOURS;
}

function sourceState(readings = [], now = new Date()) {
  const normalized = (Array.isArray(readings) ? readings : []).map(normalizeSource);
  const successful = normalized.filter(r => r.ok && (r.explicit_no_change || r.movement_received));
  const officialSuccessful = successful.filter(r => r.official);
  const official = officialSuccessful.filter(r => isFreshObservedAt(r.observed_at, now));
  const failed = normalized.filter(r => !r.ok);
  let freshness = 'unknown';
  if (official.length) freshness = 'fresh';
  else if (officialSuccessful.length || failed.length) freshness = 'stale';
  else if (successful.length) freshness = 'provisional';
  return Object.freeze({ freshness, successful, official, official_successful: officialSuccessful, failed, readings: normalized });
}

function deadlineTruth({ suggested_due_at = null, confirmed_due_at = null, confirmed_at = null, authorization_id = null, official_source = null, official_observed_at = null } = {}, now = new Date()) {
  const source = String(official_source || '').toLowerCase();
  const officialFresh = OFFICIAL.has(source) && isFreshObservedAt(official_observed_at, now);
  if (confirmed_due_at && confirmed_at && authorization_id && officialFresh) {
    return Object.freeze({ due_at: confirmed_due_at, status: 'confirmed', legal_truth: true, authorization_id, official_source: source, official_observed_at });
  }
  return Object.freeze({ due_at: suggested_due_at || confirmed_due_at, status: (suggested_due_at || confirmed_due_at) ? 'suggested' : 'unknown', legal_truth: false, authorization_id: null, official_source: officialFresh ? source : null, official_observed_at: officialFresh ? official_observed_at : null });
}

function reconcile({ case_id, readings = [], deadline = {}, intent_id, now = new Date() } = {}) {
  const sources = sourceState(readings, now);
  const truth = deadlineTruth(deadline, now);
  const warnings = [];
  if (sources.freshness === 'unknown') warnings.push('LEX não confirmou atualização em fonte judicial.');
  if (sources.freshness === 'stale') warnings.push('Fontes judiciais indisponíveis, inválidas ou desatualizadas; estado não confirmado.');
  if (sources.freshness === 'provisional') warnings.push('Atualização local/manual é provisória até conferência em fonte oficial.');
  if (truth.status === 'suggested') warnings.push('Prazo sugerido: exige fonte oficial recente e autorização humana antes de virar prazo jurídico definitivo.');
  return Object.freeze({
    case_id: case_id || null,
    intent_id: String(intent_id || crypto.randomUUID()),
    sources,
    deadline: truth,
    warnings,
    requires_human_attention: warnings.length > 0 || !truth.legal_truth
  });
}

function canStampOfficialSync(readings = [], now = new Date()) {
  return sourceState(readings, now).official.length > 0;
}

function bridgeEnvelope({ case_id, path, sha256, source = SOURCES.LOCAL, observed_at = new Date().toISOString(), intent_id } = {}) {
  if (!case_id) throw new Error('CASE_ID_REQUIRED');
  if (!sha256) throw new Error('DOCUMENT_SHA256_REQUIRED');
  return Object.freeze({
    event_type: 'document.received',
    intent_id: String(intent_id || crypto.randomUUID()),
    case_id: String(case_id),
    source,
    observed_at,
    payload: Object.freeze({ path: path || null, sha256: String(sha256), authority: 'input_only', can_confirm_deadline: false, can_file: false })
  });
}

module.exports = { STALE_AFTER_HOURS, SOURCES, normalizeSource, isFreshObservedAt, sourceState, deadlineTruth, reconcile, canStampOfficialSync, bridgeEnvelope };
