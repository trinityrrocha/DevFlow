import { useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useNavigate } from '../router';
import { useAuth } from '../context/AuthContext';
import api, { errorMessage } from '../services/api';

export default function Profile() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [mfa, setMfa] = useState({ enabled: false, recovery_codes_remaining: 0 });
  const [setup, setSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user.must_change_password) {
      api.get('/auth/mfa/status')
        .then((response) => setMfa(response.data))
        .catch((requestError) => setError(errorMessage(requestError)));
    }
  }, [user.must_change_password]);

  const changePassword = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      await api.post('/users/profile/password', {
        current_password: form.get('current_password'),
        new_password: form.get('new_password')
      });
      window.dispatchEvent(new CustomEvent('devflow:session-expired'));
      navigate('/login', { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const startMfa = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await api.post('/auth/mfa/setup/start');
      setSetup(response.data);
      setRecoveryCodes([]);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const confirmMfa = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await api.post('/auth/mfa/setup/confirm', { code });
      setRecoveryCodes(response.data.recovery_codes);
      setMfa({ enabled: true, recovery_codes_remaining: response.data.recovery_codes.length });
      setSetup(null);
      setCode('');
      await refresh();
      setMessage('MFA habilitado. Guarde os códigos de recuperação em local seguro.');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const copyCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setMessage('Códigos copiados.');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Meu perfil</h1>
        <p className="mt-1 text-sm text-slate-500">{user.name} · {user.email}</p>
      </header>

      {user.must_change_password && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Esta conta usa uma senha temporária. A troca é obrigatória antes de acessar as demais áreas.
        </div>
      )}
      {user.must_configure_mfa && !user.must_change_password && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          A configuração do MFA é obrigatória para liberar as demais áreas do DevFlow.
        </div>
      )}
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      <section className="card p-6">
        <div className="mb-5 flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-indigo-600" />
          <div>
            <h2 className="font-semibold">Alterar senha</h2>
            <p className="text-sm text-slate-500">A alteração encerra todas as sessões abertas.</p>
          </div>
        </div>
        <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Senha atual
            <input name="current_password" type="password" required autoComplete="current-password" className="field mt-1" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Nova senha
            <input name="new_password" type="password" required minLength={12} autoComplete="new-password" className="field mt-1" />
          </label>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Use ao menos 12 caracteres, com maiúscula, minúscula, número e caractere especial.
          </p>
          <div className="sm:col-span-2">
            <button disabled={saving} className="btn-primary">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Alterar senha
            </button>
          </div>
        </form>
      </section>

      {!user.must_change_password && (
        <section className="card p-6">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <div>
              <h2 className="font-semibold">Autenticação em dois fatores</h2>
              <p className="text-sm text-slate-500">
                {mfa.enabled
                  ? `Ativa · ${mfa.recovery_codes_remaining} códigos de recuperação disponíveis`
                  : 'Proteja o acesso com um aplicativo autenticador TOTP.'}
              </p>
            </div>
          </div>

          {!mfa.enabled && !setup && (
            <button type="button" onClick={startMfa} disabled={saving} className="btn-secondary">
              Iniciar configuração
            </button>
          )}

          {setup && (
            <form onSubmit={confirmMfa} className="space-y-4">
              <div className="rounded-md bg-slate-50 p-4 text-sm">
                <p className="font-medium">1. Cadastre esta chave no aplicativo autenticador:</p>
                <code className="mt-2 block break-all rounded bg-white p-2 text-xs text-indigo-700">{setup.secret}</code>
                <p className="mt-3 text-xs text-slate-500">URI avançada: {setup.otpauth_url}</p>
              </div>
              <label className="block max-w-xs text-sm font-medium text-slate-700">
                2. Código de seis dígitos
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  required
                  className="field mt-1"
                />
              </label>
              <button disabled={saving} className="btn-primary">Confirmar e ativar</button>
            </form>
          )}

          {recoveryCodes.length > 0 && (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-amber-900">Códigos exibidos somente agora</p>
                <button type="button" onClick={copyCodes} className="btn-secondary">
                  <Copy className="mr-2 h-4 w-4" /> Copiar
                </button>
              </div>
              <pre className="mt-3 grid grid-cols-2 gap-2 whitespace-pre-wrap text-xs text-amber-950">
                {recoveryCodes.join('\n')}
              </pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
