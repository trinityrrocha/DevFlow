const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set(['ECONNABORTED', 'ERR_NETWORK', 'ETIMEDOUT']);

export function isTransientUpdatePollingError(error) {
  if (!error?.response) return true;
  return TRANSIENT_HTTP_STATUSES.has(error.response.status)
    || TRANSIENT_ERROR_CODES.has(error.code)
    || error.name === 'FetchError';
}

export function normalizeUpdateStatus(payload) {
  const state = payload?.state || payload?.status || 'processing';
  return { ...payload, state };
}
