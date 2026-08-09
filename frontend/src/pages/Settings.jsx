import { useCallback, useEffect, useState } from 'react';
import { Layers3, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Workflow } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import SmtpSettings from '../components/SmtpSettings';

const newStage = (index, terminal = false) => ({ code: terminal ? 'DONE' : `STAGE_${index + 1}`, name: terminal ? 'Concluido' : `Etapa ${index + 1}`, responsibility: 'ANY', requirements: '{}', tracks_time: !terminal, completes_task: terminal });
const emptyWorkflow = { code: '', name: '', task_kind: 'BOTH', is_default: false, stages: [newStage(0), newStage(1, true)] };
const emptyCatalogs = { environments: { code: '', name: '' }, priorities: { code: '', name: '', weight: 1 }, taskTypes: { code: '', name: '', applicable_kind: 'BOTH' } };
const UPDATE_NOTICE_KEY = 'devflow:update-completed';

export default function Settings({ section = 'catalogs' }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [workflow, setWorkflow] = useState(emptyWorkflow);
  const [catalogForms, setCatalogForms] = useState(emptyCatalogs);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [capabilities, setCapabilities] = useState(null);
  const [queued, setQueued] = useState(null);
  const [mfaPolicy, setMfaPolicy] = useState(null);
  const [selectedMfaPolicy, setSelectedMfaPolicy] = useState('optional');

  const loadCatalogs = useCallback(async () => {
    if (!['catalogs', 'workflows'].includes(section)) return;
    try { setData((await api.get('/catalogs/bootstrap')).data); } catch (requestError) { setError(errorMessage(requestError)); }
  }, [section]);

  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);
  useEffect(() => {
    if (window.sessionStorage.getItem(UPDATE_NOTICE_KEY)) {
      window.sessionStorage.removeItem(UPDATE_NOTICE_KEY);
      setNotice('Atualizacao concluida. O DevFlow voltou a ficar disponivel.');
    }
  }, []);
  useEffect(() => {
    if (!user?.is_super_admin) return;
    if (section === 'updates') {
      api.get('/operations/update/capabilities').then(({ data: value }) => setCapabilities(value)).catch(() => setCapabilities(null));
    }
    if (section === 'mfa') api.get('/auth/mfa/policy').then(({ data: value }) => { setMfaPolicy(value); setSelectedMfaPolicy(value.enforcement_mode); }).catch(() => setMfaPolicy(null));
  }, [section, user?.is_super_admin]);

  const mutate = async (operation, message) => {
    setSaving(true); setError(''); setNotice('');
    try { await operation(); await loadCatalogs(); setNotice(message); } catch (requestError) { setError(errorMessage(requestError)); } finally { setSaving(false); }
  };

  const titles = { mfa: ['Politica de autenticacao multifator', 'Defina a obrigatoriedade do segundo fator sem alterar configuracoes existentes.'], catalogs: ['Catalogos configuraveis', 'Ambientes, prioridades e tipos de tarefa da empresa ativa.'], workflows: ['Fluxos configuraveis', 'Etapas, responsabilidades e requisitos do ciclo de desenvolvimento.'], smtp: ['Servidor SMTP', 'Consulte a configuracao sanitizada do servidor de e-mail e envie uma mensagem de teste.'], updates: ['Atualizacoes', 'Solicitacoes assinadas para o mecanismo transacional de atualizacao.'] };
  return <div className="space-y-7"><header><h1 className="text-2xl font-bold">{titles[section][0]}</h1><p className="mt-1 text-sm text-slate-500">{titles[section][1]}</p></header>{error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}{notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
    {section === 'updates' && <UpdateSettings capabilities={capabilities} queued={queued} saving={saving} mutate={mutate} setQueued={setQueued} />}
    {section === 'smtp' && <SmtpSettings />}
    {section === 'mfa' && <MfaSettings policy={mfaPolicy} selected={selectedMfaPolicy} setSelected={setSelectedMfaPolicy} saving={saving} mutate={mutate} setPolicy={setMfaPolicy} />}
    {section === 'catalogs' && (data ? <CatalogSettings data={data} forms={catalogForms} setForms={setCatalogForms} saving={saving} mutate={mutate} /> : <Loading />)}
    {section === 'workflows' && (data ? <WorkflowSettings data={data} workflow={workflow} setWorkflow={setWorkflow} saving={saving} mutate={mutate} /> : <Loading />)}
  </div>;
}

function UpdateSettings({ capabilities, queued, saving, mutate, setQueued }) {
  const [updateStatus, setUpdateStatus] = useState(null);
  const [connectionInterrupted, setConnectionInterrupted] = useState(false);
  useEffect(() => {
    if (!queued?.id || ['completed', 'failed'].includes(updateStatus?.state)) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const { data } = await api.get(`/operations/update/requests/${queued.id}`);
        if (active) setUpdateStatus(data);
      } catch { /* A proxima consulta tenta novamente sem expor detalhes internos. */ }
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [queued?.id, updateStatus?.state]);
  useEffect(() => {
    if (!queued?.id || !capabilities?.availableVersion || updateStatus?.state === 'failed') return undefined;
    let active = true;
    const pollHealth = async () => {
      try {
        const { data } = await api.get('/health', { timeout: 4500 });
        if (!active) return;
        const expected = data.status === 'ok'
          && data.version === capabilities.availableVersion
          && (!capabilities.availableCommit || data.commit === capabilities.availableCommit);
        if (expected && (connectionInterrupted || updateStatus?.state === 'completed')) {
          window.sessionStorage.setItem(UPDATE_NOTICE_KEY, 'true');
          window.location.reload();
        }
      } catch {
        if (active) setConnectionInterrupted(true);
      }
    };
    pollHealth();
    const timer = window.setInterval(pollHealth, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [queued?.id, capabilities?.availableVersion, capabilities?.availableCommit, connectionInterrupted, updateStatus?.state]);
  if (!capabilities) return <Loading />;
  const requestActive = queued?.id && !['completed', 'failed'].includes(updateStatus?.state);
  const canUpdate = capabilities.executionAvailable && capabilities.updateAvailable && !requestActive;
  const confirmUpdate = () => {
    const message = `Atualizar o DevFlow de ${capabilities.installedVersion} para ${capabilities.availableVersion}?\n\nUm backup validado sera criado e o sistema ficara temporariamente em manutencao. Em caso de falha, o rollback sera automatico.`;
    if (!window.confirm(message)) return;
    mutate(async () => {
      const { data } = await api.post('/operations/update/requests');
      setQueued(data); setUpdateStatus({ state: 'pending', message: 'Atualizacao aguardando processamento.' });
    }, 'Pedido de atualizacao enfileirado.');
  };
  return <div className="space-y-6"><Section icon={RefreshCw} title="Atualizacao do sistema"><div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-slate-200 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Versao instalada</p><p className="mt-1 font-semibold">{capabilities.installedVersion}</p><p className="mt-1 break-all text-xs text-slate-400">{capabilities.installedCommit}</p></div><div className="rounded-lg border border-slate-200 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">Versao disponivel</p><p className="mt-1 font-semibold">{capabilities.availableVersion}</p><p className="mt-1 break-all text-xs text-slate-400">{capabilities.availableCommit}</p></div></div><div className="rounded-lg bg-slate-50 p-4"><p className="text-sm font-medium">Changelog</p><pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-slate-600">{capabilities.changelog || 'Nao foi possivel consultar o changelog agora.'}</pre></div><div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">Antes de alterar a aplicacao, o DevFlow cria e valida um backup. Durante migrations e troca de containers, o acesso publico exibe manutencao HTTP 503. Uma falha aciona rollback automatico.</div>{updateStatus && <div className={`rounded-lg border p-4 text-sm ${updateStatus.state === 'failed' ? 'border-red-200 bg-red-50 text-red-700' : updateStatus.state === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}><strong>{updateStatus.state}</strong><p className="mt-1">{updateStatus.message}</p>{connectionInterrupted && updateStatus.state !== 'failed' && <p className="mt-2 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Aguardando o retorno saudavel da nova versao...</p>}</div>}<div className="flex justify-end"><button type="button" disabled={!canUpdate || saving} className="btn-primary" onClick={confirmUpdate}>{saving || (updateStatus && !['completed', 'failed'].includes(updateStatus.state)) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Solicitar atualizacao</button></div></div></Section>
    </div>;
}

function MfaSettings({ policy, selected, setSelected, saving, mutate, setPolicy }) {
  if (!policy) return <Loading />;
  return <Section icon={ShieldCheck} title="Politica de autenticacao multifator"><div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end"><label className="text-sm font-medium">Obrigatoriedade de MFA<select value={selected} onChange={(event) => setSelected(event.target.value)} className="field mt-1"><option value="optional">Opcional para todos</option><option value="admins">Obrigatorio para administradores</option><option value="all">Obrigatorio para todos</option></select><span className="mt-2 block text-xs font-normal text-slate-500">MFA ja configurado permanece ativo. O padrao continua opcional.</span></label><button type="button" disabled={saving || selected === policy.enforcement_mode} className="btn-primary" onClick={() => { if (!window.confirm('Confirmar alteracao da politica de MFA?')) return; mutate(async () => { const { data } = await api.patch('/auth/mfa/policy', { enforcement_mode: selected }); setPolicy(data); }, 'Politica de MFA atualizada.'); }}>Aplicar politica</button></div></Section>;
}

function CatalogSettings({ data, forms, setForms, saving, mutate }) {
  const configs = [['environments', 'Ambientes', data.environments], ['priorities', 'Prioridades', data.priorities], ['taskTypes', 'Tipos de tarefa', data.task_types]];
  return <Section icon={Layers3} title="Catalogos configuraveis"><div className="grid gap-5 lg:grid-cols-3">{configs.map(([key, title, items]) => { const form = forms[key]; return <div key={key} className="rounded-lg border border-slate-200 p-4"><h2 className="font-semibold">{title}</h2><ul className="my-3 space-y-1 text-sm text-slate-600">{items.map((item) => <li key={item.id}>{item.name} <span className="text-xs text-slate-400">({item.code})</span></li>)}</ul><form onSubmit={(event) => { event.preventDefault(); mutate(() => api.post(`/catalogs/${key}`, form), `${title}: item cadastrado.`); setForms({ ...forms, [key]: key === 'priorities' ? { code: '', name: '', weight: 1 } : key === 'taskTypes' ? { code: '', name: '', applicable_kind: 'BOTH' } : { code: '', name: '' } }); }} className="space-y-2"><input required placeholder="Codigo" value={form.code} onChange={(event) => setForms({ ...forms, [key]: { ...form, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') } })} className="field" /><input required placeholder="Nome" value={form.name} onChange={(event) => setForms({ ...forms, [key]: { ...form, name: event.target.value } })} className="field" />{key === 'priorities' && <input type="number" min="0.1" step="0.1" value={form.weight} onChange={(event) => setForms({ ...forms, [key]: { ...form, weight: Number(event.target.value) } })} className="field" />}{key === 'taskTypes' && <select value={form.applicable_kind} onChange={(event) => setForms({ ...forms, [key]: { ...form, applicable_kind: event.target.value } })} className="field"><option value="BOTH">Solicitacao e Bug</option><option value="REQUEST">Solicitacao</option><option value="BUG">Bug</option></select>}<button disabled={saving} className="btn-secondary w-full"><Plus className="mr-2 h-4 w-4" />Adicionar</button></form></div>; })}</div></Section>;
}

function WorkflowSettings({ data, workflow, setWorkflow, saving, mutate }) {
  const update = (index, field, value) => setWorkflow({ ...workflow, stages: workflow.stages.map((stage, itemIndex) => itemIndex === index ? { ...stage, [field]: value } : stage) });
  return <Section icon={Workflow} title="Fluxos configuraveis"><div className="mb-5 grid gap-3 md:grid-cols-3">{data.workflows.map((item) => <div key={item.id} className="rounded-lg border p-4"><strong className="text-sm">{item.name}</strong><p className="mt-1 text-xs text-slate-500">{item.task_kind} · {item.stages.length} etapas</p><p className="mt-2 text-xs">{item.stages.map((stage) => stage.name).join(' → ')}</p></div>)}</div><form onSubmit={(event) => { event.preventDefault(); mutate(() => api.post('/catalogs/workflows', { ...workflow, stages: workflow.stages.map((stage, index) => ({ ...stage, sort_order: (index + 1) * 10, requirements: JSON.parse(stage.requirements || '{}') })) }), 'Fluxo cadastrado.'); setWorkflow(emptyWorkflow); }} className="rounded-lg border p-4"><div className="grid gap-3 md:grid-cols-3"><Field label="Nome" value={workflow.name} onChange={(value) => setWorkflow({ ...workflow, name: value })} /><Field label="Codigo" value={workflow.code} onChange={(value) => setWorkflow({ ...workflow, code: value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} /><label className="text-sm font-medium">Aplicacao<select className="field mt-1" value={workflow.task_kind} onChange={(event) => setWorkflow({ ...workflow, task_kind: event.target.value })}><option value="BOTH">Ambos</option><option value="REQUEST">Solicitacao</option><option value="BUG">Bug</option></select></label></div><div className="mt-4 space-y-3">{workflow.stages.map((stage, index) => <div key={`${stage.code}-${index}`} className="grid gap-3 rounded bg-slate-50 p-3 lg:grid-cols-[1fr_1fr_1fr_auto]"><Field label={`Etapa ${index + 1}`} value={stage.name} onChange={(value) => update(index, 'name', value)} /><Field label="Codigo" value={stage.code} onChange={(value) => update(index, 'code', value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} /><label className="text-sm font-medium">Responsabilidade<select className="field mt-1" value={stage.responsibility} onChange={(event) => update(index, 'responsibility', event.target.value)}>{['ANY', 'MANAGER', 'BACKEND_ASSIGNEE', 'FRONTEND_ASSIGNEE'].map((value) => <option key={value}>{value}</option>)}</select></label><div className="flex items-end gap-2 pb-2"><label className="text-xs"><input type="checkbox" checked={stage.tracks_time} onChange={(event) => update(index, 'tracks_time', event.target.checked)} /> Tempo</label>{workflow.stages.length > 2 && <button type="button" aria-label="Remover etapa" onClick={() => setWorkflow({ ...workflow, stages: workflow.stages.filter((_, itemIndex) => itemIndex !== index) })} className="text-red-600"><Trash2 className="h-4 w-4" /></button>}</div></div>)}</div><div className="mt-4 flex justify-between"><button type="button" className="btn-secondary" onClick={() => setWorkflow({ ...workflow, stages: [...workflow.stages.map((stage) => ({ ...stage, completes_task: false })), newStage(workflow.stages.length, true)] })}><Plus className="mr-2 h-4 w-4" />Adicionar etapa</button><button disabled={saving} className="btn-primary">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar fluxo</button></div></form></Section>;
}

function Section({ icon: Icon, title, children }) { return <section className="card p-5"><h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><Icon className="h-5 w-5 text-indigo-600" />{title}</h2>{children}</section>; }
function Field({ label, value, onChange }) { return <label className="text-sm font-medium">{label}<input required className="field mt-1" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function Loading() { return <p className="text-sm text-slate-500">Carregando configuracao...</p>; }
