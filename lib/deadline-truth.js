'use strict';

const { checkFreshness } = require('./freshness');

const OFFICIAL_SOURCES = Object.freeze(['PJE', 'DJEN', 'DATAJUD']);
const MINTED = new WeakSet();

class DeadlineTruthError extends Error {
  constructor(code, meta) {
    super(code);
    this.name = 'DeadlineTruthError';
    this.code = code;
    if (meta) this.meta = meta;
  }
}

function mintDeadlineTruth(refs, deps) {
  const { readingId, authorizationId } = refs || {};
  const { readingLog, authorizationLog } = deps || {};
  if (!readingLog || !authorizationLog) throw new DeadlineTruthError('stores_unavailable');
  if (typeof readingId !== 'string' || !readingId) throw new DeadlineTruthError('reading_ref_missing');
  if (typeof authorizationId !== 'string' || !authorizationId) throw new DeadlineTruthError('authorization_ref_missing');

  const reading = readingLog.get(readingId);
  if (!reading) throw new DeadlineTruthError('reading_not_found');
  const source = String(reading.source || '').toUpperCase();
  if (!OFFICIAL_SOURCES.includes(source)) throw new DeadlineTruthError('source_not_official', { source });
  if (!reading.raw_receipt) throw new DeadlineTruthError('reading_receipt_missing');
  if (reading.due_at == null) throw new DeadlineTruthError('reading_has_no_due_at');

  const freshness = checkFreshness(reading, { now: deps.now, maxAgeMs: deps.maxAgeMs, maxClockSkewMs: deps.maxClockSkewMs });
  if (!freshness.fresh) throw new DeadlineTruthError('reading_not_fresh', { reason: freshness.reason });

  const auth = authorizationLog.get(authorizationId);
  if (!auth) throw new DeadlineTruthError('authorization_not_found');
  if (auth.reading_id !== readingId) throw new DeadlineTruthError('authorization_reading_mismatch');
  if (!auth.human_id || !auth.authorized_at) throw new DeadlineTruthError('authorization_incomplete');
  if (auth.process_id && reading.process_id && String(auth.process_id) !== String(reading.process_id)) {
    throw new DeadlineTruthError('authorization_process_mismatch');
  }

  const truth = Object.freeze({
    legal_truth: true,
    process_id: reading.process_id,
    due_at: reading.due_at,
    source,
    observed_at: reading.observed_at,
    reading_id: readingId,
    authorization_id: authorizationId,
    authorized_by: auth.human_id,
    authorized_at: auth.authorized_at,
    minted_at: Number.isFinite(deps.now) ? deps.now : Date.now()
  });
  MINTED.add(truth);
  return truth;
}

function isLegalTruth(obj) {
  return typeof obj === 'object' && obj !== null && MINTED.has(obj);
}

module.exports = { mintDeadlineTruth, isLegalTruth, DeadlineTruthError, _internal: { OFFICIAL_SOURCES } };
