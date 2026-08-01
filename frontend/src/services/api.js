import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true
});

const mutating = new Set(['post', 'put', 'patch', 'delete']);
const exempt = ['/auth/login', '/auth/bootstrap', '/auth/mfa'];
const readCookie = (name) => document.cookie
  .split('; ')
  .find((part) => part.startsWith(`${name}=`))
  ?.slice(name.length + 1);

let csrfPromise;
api.interceptors.request.use(async (config) => {
  const method = String(config.method || 'get').toLowerCase();
  const url = String(config.url || '');
  if (!mutating.has(method) || exempt.some((path) => url.includes(path))) return config;
  let token = readCookie('devflow_csrf');
  if (!token) {
    csrfPromise ||= api.get('/auth/csrf').finally(() => { csrfPromise = null; });
    await csrfPromise;
    token = readCookie('devflow_csrf');
  }
  if (token) config.headers.set('X-CSRF-Token', decodeURIComponent(token));
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !String(error.config?.url).includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('devflow:session-expired'));
    }
    return Promise.reject(error);
  }
);

export const errorMessage = (error) => {
  const details = error.response?.data?.details;
  if (Array.isArray(details) && details.length) {
    return details.map((item) => typeof item === 'string' ? item : `${item.field}: ${item.message}`).join(' • ');
  }
  return error.response?.data?.error || 'Não foi possível concluir a operação.';
};

export default api;
