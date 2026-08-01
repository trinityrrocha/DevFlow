import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { errorMessage } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.user);
      setCompanies(response.data.companies || []);
    } catch {
      setUser(null);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const expired = () => setUser(null);
    window.addEventListener('devflow:session-expired', expired);
    return () => window.removeEventListener('devflow:session-expired', expired);
  }, [refresh]);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      if (response.data.mfa_required) return { mfa: response.data };
      setUser(response.data.user);
      setCompanies(response.data.companies || []);
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  };

  const verifyMfa = async (challengeToken, factor, recovery = false) => {
    try {
      const response = await api.post('/auth/mfa', {
        challenge_token: challengeToken,
        ...(recovery ? { recovery_code: factor } : { code: factor })
      });
      setUser(response.data.user);
      setCompanies(response.data.companies || []);
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setCompanies([]);
    }
  };

  const switchCompany = async (companyId) => {
    const response = await api.post('/auth/company/switch', { company_id: companyId });
    setUser(response.data.user);
    setCompanies(response.data.companies || []);
    window.dispatchEvent(new CustomEvent('devflow:company-switched'));
  };

  const value = useMemo(
    () => ({ user, companies, loading, login, verifyMfa, logout, refresh, switchCompany }),
    [user, companies, loading, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro de AuthProvider.');
  return value;
}
