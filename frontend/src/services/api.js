import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true
});

const mutating = new Set(['post', 'put', 'patch', 'delete']);
export const csrfExemptPaths = new Set([
  '/auth/login', '/auth/bootstrap', '/auth/mfa', '/auth/password/forgot', '/auth/password/reset'
]);
export const normalizeApiPath = (url) => String(url || '').split('?')[0].replace(/^\/api/, '');
export const isCsrfExempt = (url) => csrfExemptPaths.has(normalizeApiPath(url));
export const readCookie = (name) => document.cookie
  .split('; ')
  .find((part) => part.startsWith(`${name}=`))
  ?.slice(name.length + 1);
export const responseErrorCode = (error) => error.response?.data?.error?.code
  || error.response?.data?.code;

let csrfPromise;
const refreshCsrf = async () => {
  csrfPromise ||= api.get('/auth/csrf').finally(() => { csrfPromise = null; });
  await csrfPromise;
};

api.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toLowerCase();
  const url = String(config.url || '');
  if (!mutating.has(method) || isCsrfExempt(url)) return config;
  let token = readCookie('devflow_csrf');
  if (!token) {
    await refreshCsrf();
    token = readCookie('devflow_csrf');
  }
  if (token) {
    const value = decodeURIComponent(token);
    if (config.headers?.set) config.headers.set('X-CSRF-Token', value);
    else config.headers = { ...config.headers, 'X-CSRF-Token': value };
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const code = responseErrorCode(error);
    const request = error.config;
    if (code === 'CSRF_INVALID' && request && !request.__devflowCsrfRetried
      && !isCsrfExempt(request.url)) {
      request.__devflowCsrfRetried = true;
      await refreshCsrf();
      return api(request);
    }
    if (error.response?.status === 401 && !String(error.config?.url).includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('devflow:session-expired'));
    }
    return Promise.reject(error);
  }
);

export const errorMessage = (error) => {
  const structured = error.response?.data?.error;
  if (structured && typeof structured === 'object' && structured.message) return structured.message;
  const details = error.response?.data?.details;
  if (Array.isArray(details) && details.length) {
    return details.map((item) => typeof item === 'string' ? item : `${item.field}: ${item.message}`).join(' • ');
  }
  return error.response?.data?.error || 'Não foi possível concluir a operação.';
};

export default api;
