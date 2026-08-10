const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set(['ECONNABORTED', 'ERR_NETWORK', 'ETIMEDOUT']);

export function isTransientUpdatePollingError(error) {
  if (!error?.response) return true;
  return TRANSIENT_HTTP_STATUSES.has(error.response.status)
    || TRANSIENT_ERROR_CODES.has(error.code)
    || error.name === 'FetchError';
}

export function normalizeUpdateStatus(payload) {
  const lifecycle = payload?.status;
  const state = ['completed', 'failed'].includes(lifecycle)
    ? lifecycle
    : payload?.state || lifecycle || 'processing';
  return { ...payload, state };
}

export function updatePollingOutcome(payload) {
  const status = normalizeUpdateStatus(payload);
  return {
    status,
    shouldReload: status.state === 'completed',
    shouldStop: ['completed', 'failed'].includes(status.state)
  };
}
