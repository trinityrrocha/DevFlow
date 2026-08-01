import { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Navigate, useNavigate } from '../router';
import { useAuth } from '../context/AuthContext';
import api, { errorMessage } from '../services/api';

export default function Login() {
  const { user, login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const [bootstrap, setBootstrap] = useState({ required: false, checked: false });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [setupForm, setSetupForm] = useState({ company_name: '', name: '', email: '', password: '', confirm: '', token: '' });
  const [mfa, setMfa] = useState(null);
  const [factor, setFactor] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/auth/bootstrap/status')
      .then(({ data }) => {
        setBootstrap({ ...data, checked: true });
      })
      .catch((requestError) => {
        setError(errorMessage(requestError));
        setBootstrap((current) => ({ ...current, checked: true }));
      });
  }, []);

  if (user) return <Navigate to="/" replace />;

  const submitLogin = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(loginForm.email, loginForm.password);
    setLoading(false);
    if (result.success) navigate('/');
    else if (result.mfa) {
      setMfa(result.mfa);
      setLoginForm((current) => ({ ...current, password: '' }));
    } else setError(result.error);
  };

  const submitMfa = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    const result = await verifyMfa(mfa.challenge_token, factor, recovery);
    setLoading(false);
    if (result.success) navigate('/');
    else setError(result.error);
  };

  const submitBootstrap = async (event) => {
    event.preventDefault();
    setError('');
    if (setupForm.password !== setupForm.confirm) return setError('As senhas não coincidem.');
    setLoading(true);
    try {
      await api.post('/auth/bootstrap', {
        company_name: setupForm.company_name,
        name: setupForm.name,
        email: setupForm.email,
        password: setupForm.password,
        bootstrap_token: setupForm.token
      });
      setBootstrap((current) => ({ ...current, required: false }));
      setLoginForm({ email: setupForm.email, password: '' });
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-600"><ShieldCheck className="h-9 w-9" /></span>
          <h1 className="mt-4 text-2xl font-bold">DevFlow</h1>
          <p className="mt-1 text-sm text-slate-500">Todo o ciclo de desenvolvimento em um só lugar.</p>
        </div>

        <div className="card p-6 shadow-lg">
          {!bootstrap.checked ? <p className="text-center text-sm text-slate-500">Verificando configuração...</p>
            : bootstrap.required ? (
              <form onSubmit={submitBootstrap} className="space-y-4">
                <div><h2 className="text-lg font-semibold">Configuração inicial</h2><p className="text-sm text-slate-500">Crie o Super Admin da instalação.</p></div>
                <Field label="Empresa" value={setupForm.company_name} onChange={(value) => setSetupForm({ ...setupForm, company_name: value })} />
                <Field label="Nome" value={setupForm.name} onChange={(value) => setSetupForm({ ...setupForm, name: value })} />
                <Field label="E-mail configurado do Super Admin" type="email" value={setupForm.email} onChange={(value) => setSetupForm({ ...setupForm, email: value })} />
                <Field label="Senha" type="password" value={setupForm.password} onChange={(value) => setSetupForm({ ...setupForm, password: value })} />
                <Field label="Confirmar senha" type="password" value={setupForm.confirm} onChange={(value) => setSetupForm({ ...setupForm, confirm: value })} />
                <Field label="Token de bootstrap" type="password" value={setupForm.token} onChange={(value) => setSetupForm({ ...setupForm, token: value })} />
                {error && <Alert>{error}</Alert>}
                <Submit loading={loading}>Criar Super Admin</Submit>
              </form>
            ) : mfa ? (
              <form onSubmit={submitMfa} className="space-y-4">
                <div className="text-center"><KeyRound className="mx-auto h-8 w-8 text-indigo-600" /><h2 className="mt-2 text-lg font-semibold">Verificação em duas etapas</h2></div>
                <Field label={recovery ? 'Código de recuperação' : 'Código de 6 dígitos'} value={factor} onChange={setFactor} />
                <button type="button" onClick={() => { setRecovery(!recovery); setFactor(''); }} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                  {recovery ? 'Usar aplicativo autenticador' : 'Usar código de recuperação'}
                </button>
                {error && <Alert>{error}</Alert>}
                <Submit loading={loading}>Verificar</Submit>
              </form>
            ) : (
              <form onSubmit={submitLogin} className="space-y-4">
                <div><h2 className="text-lg font-semibold">Entrar</h2><p className="text-sm text-slate-500">Use sua conta para acessar o fluxo.</p></div>
                <Field label="E-mail" type="email" value={loginForm.email} onChange={(value) => setLoginForm({ ...loginForm, email: value })} />
                <Field label="Senha" type="password" value={loginForm.password} onChange={(value) => setLoginForm({ ...loginForm, password: value })} />
                {error && <Alert>{error}</Alert>}
                <Submit loading={loading}>Entrar</Submit>
              </form>
            )}
        </div>
      </section>
    </main>
  );
}

function Field({ label, value, onChange, type = 'text', readOnly = false }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<input required readOnly={readOnly} type={type} value={value} onChange={(e) => onChange(e.target.value)} className="field mt-1" /></label>;
}
function Alert({ children }) {
  return <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{children}</div>;
}
function Submit({ loading, children }) {
  return <button disabled={loading} className="btn-primary w-full">{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{children}</button>;
}
