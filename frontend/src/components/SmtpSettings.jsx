import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Mail, Send } from 'lucide-react';
import api, { errorMessage } from '../services/api';

const initial = { enabled: false, host: '', port: 587, security: 'starttls', username: '', password: '', has_password: false, from_name: 'DevFlow', from_email: '', reply_to: '', timeout_seconds: 15, source: 'database' };

export default function SmtpSettings() {
  const [settings, setSettings] = useState(initial);
  const [recipient, setRecipient] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let active = true;
    api.get('/notifications/email/status').then(({ data }) => {
      if (active) setSettings({ ...initial, ...data, password: '' });
    }).catch((error) => active && setMessage({ type: 'error', text: errorMessage(error) }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const field = (name, value) => { setSettings((current) => ({ ...current, [name]: value })); setDirty(true); };
  const save = async (event) => {
    event.preventDefault(); setBusy('save'); setMessage(null);
    try {
      const payload = { ...settings, port: Number(settings.port), timeout_seconds: Number(settings.timeout_seconds) };
      delete payload.has_password; delete payload.source;
      if (!payload.password) delete payload.password;
      const { data } = await api.put('/notifications/email/settings', payload);
      setSettings({ ...initial, ...data, password: '' }); setDirty(false); setShowPassword(false);
      setMessage({ type: 'success', text: 'Configuracao SMTP salva com seguranca.' });
    } catch (error) { setMessage({ type: 'error', text: errorMessage(error) }); } finally { setBusy(''); }
  };
  const test = async () => {
    setBusy('test'); setMessage(null);
    try {
      const { data } = await api.post('/notifications/email/test', { to: recipient || undefined });
      setMessage({ type: 'success', text: data.message });
    } catch (error) {
      const details = error.response?.data?.details;
      const exact = details ? `\n\nLog sanitizado:\n${JSON.stringify(details, null, 2)}` : '';
      setMessage({ type: 'error', text: `${errorMessage(error)}${exact}` });
    } finally { setBusy(''); }
  };
  if (loading) return <p className="text-sm text-slate-500">Carregando configuracao SMTP...</p>;
  const updateSecurity = (value) => {
    const standard = [465, 587].includes(Number(settings.port));
    setSettings((current) => ({ ...current, security: value, port: standard ? value === 'ssl_tls' ? 465 : 587 : current.port }));
    setDirty(true);
  };
  const canTest = settings.host && settings.from_email && (!settings.username || settings.has_password);
  return <section className="card p-5"><h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><Mail className="h-5 w-5 text-indigo-600" />Servidor SMTP</h2>
    <form onSubmit={save} className="space-y-5">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={settings.enabled} onChange={(event) => field('enabled', event.target.checked)} />SMTP ativo</label>
      <div className="space-y-4 overflow-x-auto pb-1">
        <div data-smtp-row="connection" className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[250px_115px_115px_115px]">
          <Field label="Host SMTP" value={settings.host} onChange={(value) => field('host', value)} maxLength={255} />
          <Field label="Porta" type="number" value={settings.port} onChange={(value) => field('port', value)} min={1} max={65535} />
          <label className="text-sm font-medium">Seguranca<select className="field mt-1" value={settings.security} onChange={(event) => updateSecurity(event.target.value)}><option value="starttls">STARTTLS</option><option value="ssl_tls">SSL/TLS</option></select></label>
          <Field label="Timeout (segundos)" type="number" value={settings.timeout_seconds} onChange={(value) => field('timeout_seconds', value)} min={1} max={120} />
        </div>
        <div data-smtp-row="credentials" className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[250px_200px_minmax(250px,1fr)]">
          <Field label="Usuario SMTP" value={settings.username} onChange={(value) => field('username', value)} maxLength={320} autoComplete="username" />
          <label className="text-sm font-medium">Senha SMTP<div className="relative mt-1"><input type={showPassword ? 'text' : 'password'} value={settings.password} onChange={(event) => field('password', event.target.value)} maxLength={4096} autoComplete="new-password" placeholder="Preencha para alterar" className="field pr-10" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={showPassword ? 'Ocultar senha SMTP' : 'Mostrar senha SMTP'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><span className="mt-1 block text-xs font-normal text-slate-500">{settings.has_password ? 'Uma senha esta salva e nunca sera exibida.' : 'Nenhuma senha salva.'}</span></label>
          <Field label="Nome do remetente" value={settings.from_name} onChange={(value) => field('from_name', value)} maxLength={160} />
        </div>
        <div data-smtp-row="addresses" className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[250px_250px_250px]">
          <Field label="E-mail do remetente" type="email" value={settings.from_email} onChange={(value) => field('from_email', value)} maxLength={320} />
          <Field label="Reply-To" type="email" value={settings.reply_to} onChange={(value) => field('reply_to', value)} maxLength={320} />
          <Field label="Destinatario do teste" type="email" value={recipient} onChange={setRecipient} placeholder="Vazio usa o Super Admin" />
        </div>
      </div>
      <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">Origem atual: <strong>{settings.source === 'environment' ? 'arquivo de ambiente protegido' : 'banco cifrado com AES-256-GCM'}</strong>. A senha nunca e retornada pela API.</div>
      <div className="flex flex-wrap justify-end gap-3 border-t pt-4"><button type="button" onClick={test} disabled={dirty || busy || !canTest} className="btn-secondary"><Send className="mr-2 h-4 w-4" />{busy === 'test' ? 'Testando...' : 'Testar conexao'}</button><button disabled={Boolean(busy)} className="btn-primary">{busy === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</button></div>
      {dirty && <p className="text-xs text-amber-700">Salve as alteracoes antes de testar a conexao.</p>}
      {message && <pre role={message.type === 'error' ? 'alert' : 'status'} className={`whitespace-pre-wrap rounded-md border p-3 font-sans text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{message.text}</pre>}
    </form>
  </section>;
}

function Field({ label, value, onChange, className = '', ...props }) {
  return <label className={`text-sm font-medium ${className}`}>{label}<input className="field mt-1" value={value} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}
