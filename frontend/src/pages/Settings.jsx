import { useCallback, useEffect, useState } from 'react';
import { Building2, FolderKanban, Layers3, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Workflow } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';

const emptyClient = { name: '', code: '', contact_name: '', contact_email: '', notes: '' };
const emptyProject = {
  name: '', code: '', client_id: '', default_environment_id: '',
  github_repository_url: '', description: '', status: 'ACTIVE'
};
const newStage = (index, terminal = false) => ({
  code: terminal ? 'DONE' : `STAGE_${index + 1}`,
  name: terminal ? 'Concluído' : `Etapa ${index + 1}`,
  responsibility: 'ANY',
  requirements: '{}',
  tracks_time: !terminal,
  completes_task: terminal
});
const emptyWorkflow = {
  code: '',
  name: '',
  task_kind: 'BOTH',
  is_default: false,
  stages: [newStage(0), newStage(1, true)]
};

export default function Settings() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [client, setClient] = useState(emptyClient);
  const [project, setProject] = useState(emptyProject);
  const [workflow, setWorkflow] = useState(emptyWorkflow);
  const [catalogForms, setCatalogForms] = useState({
    environments: { code: '', name: '' },
    priorities: { code: '', name: '', weight: 1 },
    taskTypes: { code: '', name: '', applicable_kind: 'BOTH' }
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [updateCapabilities, setUpdateCapabilities] = useState(null);
  const [updateQueued, setUpdateQueued] = useState(null);
  const [mfaPolicy, setMfaPolicy] = useState(null);
  const [selectedMfaPolicy, setSelectedMfaPolicy] = useState('optional');

  const load = useCallback(async () => {
    try {
      const response = await api.get('/catalogs/bootstrap');
      setData(response.data);
      setProject((current) => ({
        ...current,
        client_id: current.client_id || response.data.clients[0]?.id || '',
        default_environment_id: current.default_environment_id || response.data.environments[0]?.id || ''
      }));
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, []);

  useEffect(() => {
    load();
    const switched = () => load();
    window.addEventListener('devflow:company-switched', switched);
    return () => window.removeEventListener('devflow:company-switched', switched);
  }, [load]);

  useEffect(() => {
    if (user?.is_super_admin) {
      api.get('/operations/update/capabilities').then(({ data: capabilities }) => {
        setUpdateCapabilities(capabilities);
      }).catch(() => setUpdateCapabilities(null));
      api.get('/auth/mfa/policy').then(({ data: policy }) => {
        setMfaPolicy(policy);
        setSelectedMfaPolicy(policy.enforcement_mode);
      }).catch(() => setMfaPolicy(null));
    }
  }, [user?.is_super_admin]);

  const mutate = async (operation, message) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await load();
      setNotice(message);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <p className="text-sm text-slate-500">Carregando cadastros...</p>;
  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Cadastros e configuração</h1>
        <p className="mt-1 text-sm text-slate-500">Clientes, projetos e catálogos independentes da empresa ativa.</p>
      </header>
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

      {user?.is_super_admin && updateCapabilities && <Section icon={RefreshCw} title="Atualizacao do sistema">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm text-slate-700">Versao instalada: <strong>{updateCapabilities.version}</strong></p>
            <p className="mt-1 text-xs text-slate-500">O pedido e assinado e enviado a uma fila privada. Somente o motor transacional update.sh pode executa-lo.</p>
            {updateQueued && <p className="mt-2 text-xs font-medium text-emerald-700">Pedido {updateQueued.id} enfileirado.</p>}
          </div>
          <button type="button" disabled={!updateCapabilities.enabled || saving} className="btn-primary" onClick={() => {
            if (!window.confirm('Confirmar a verificacao e instalacao da nova versao do DevFlow?')) return;
            mutate(async () => {
              const { data: queued } = await api.post('/operations/update/requests');
              setUpdateQueued(queued);
            }, 'Pedido de atualizacao assinado e enfileirado.');
          }}><RefreshCw className="mr-2 h-4 w-4" />Solicitar atualizacao</button>
        </div>
      </Section>}

      {user?.is_super_admin && mfaPolicy && <Section icon={ShieldCheck} title="Politica de autenticacao multifator">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="text-sm font-medium text-slate-700">
            Obrigatoriedade de MFA
            <select
              value={selectedMfaPolicy}
              onChange={(event) => setSelectedMfaPolicy(event.target.value)}
              className="field mt-1"
            >
              <option value="optional">Opcional para todos</option>
              <option value="admins">Obrigatorio para administradores</option>
              <option value="all">Obrigatorio para todos</option>
            </select>
            <span className="mt-2 block text-xs font-normal text-slate-500">
              A alteracao afeta somente a obrigatoriedade. MFA ja configurado por usuarios permanece ativo.
            </span>
          </label>
          <button type="button" disabled={saving || selectedMfaPolicy === mfaPolicy.enforcement_mode} className="btn-primary" onClick={() => {
            if (!window.confirm('Confirmar a alteracao da politica global de MFA? Usuarios abrangidos precisarao configurar o segundo fator.')) return;
            mutate(async () => {
              const { data: updated } = await api.patch('/auth/mfa/policy', { enforcement_mode: selectedMfaPolicy });
              setMfaPolicy(updated);
            }, 'Politica de MFA atualizada.');
          }}>Aplicar politica</button>
        </div>
      </Section>}

      <Section icon={Building2} title="Clientes">
        <form onSubmit={(event) => {
          event.preventDefault();
          mutate(() => api.post('/catalogs/clients', { ...client, code: client.code || null, contact_email: client.contact_email || null }), 'Cliente cadastrado.');
          setClient(emptyClient);
        }} className="grid gap-3 border-b border-slate-200 pb-5 sm:grid-cols-3">
          <Input label="Nome" required value={client.name} onChange={(value) => setClient({ ...client, name: value })} />
          <Input label="Código" value={client.code} onChange={(value) => setClient({ ...client, code: value })} />
          <Input label="Contato" value={client.contact_name} onChange={(value) => setClient({ ...client, contact_name: value })} />
          <Input label="E-mail" type="email" value={client.contact_email} onChange={(value) => setClient({ ...client, contact_email: value })} />
          <Input label="Observações" value={client.notes} onChange={(value) => setClient({ ...client, notes: value })} />
          <Submit saving={saving}>Adicionar cliente</Submit>
        </form>
        <Table headers={['Nome', 'Código', 'Contato', 'Status']} rows={data.clients.map((item) => [item.name, item.code || '—', item.contact_name || '—', item.is_active ? 'Ativo' : 'Inativo'])} />
      </Section>

      <Section icon={FolderKanban} title="Projetos">
        <form onSubmit={(event) => {
          event.preventDefault();
          mutate(() => api.post('/catalogs/projects', { ...project, github_repository_url: project.github_repository_url || null }), 'Projeto cadastrado.');
          setProject((current) => ({ ...emptyProject, client_id: current.client_id, default_environment_id: current.default_environment_id }));
        }} className="grid gap-3 border-b border-slate-200 pb-5 sm:grid-cols-3">
          <Input label="Nome" required value={project.name} onChange={(value) => setProject({ ...project, name: value })} />
          <Input label="Código (A-Z, 0-9, _)" required value={project.code} onChange={(value) => setProject({ ...project, code: value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
          <Select label="Cliente" value={project.client_id} onChange={(value) => setProject({ ...project, client_id: value })} options={data.clients.filter((item) => item.is_active).map((item) => [item.id, item.name])} />
          <Select label="Ambiente padrão" value={project.default_environment_id} onChange={(value) => setProject({ ...project, default_environment_id: value })} options={data.environments.filter((item) => item.is_active).map((item) => [item.id, item.name])} />
          <Input label="Repositório GitHub" value={project.github_repository_url} onChange={(value) => setProject({ ...project, github_repository_url: value })} />
          <Submit saving={saving}>Adicionar projeto</Submit>
        </form>
        <Table headers={['Projeto', 'Código', 'Cliente', 'Ambiente', 'Status']} rows={data.projects.map((item) => [item.name, item.code, item.client_name, item.default_environment_name, item.status])} />
      </Section>

      <Section icon={Layers3} title="Catálogos configuráveis">
        <div className="grid gap-5 lg:grid-cols-3">
          {[
            ['environments', 'Ambientes', data.environments],
            ['priorities', 'Prioridades', data.priorities],
            ['taskTypes', 'Tipos de tarefa', data.task_types]
          ].map(([key, title, items]) => {
            const form = catalogForms[key];
            return (
              <div key={key} className="rounded-lg border border-slate-200 p-4">
                <h3 className="font-semibold">{title}</h3>
                <ul className="my-3 space-y-1 text-sm text-slate-600">{items.map((item) => <li key={item.id}>{item.name} <span className="text-xs text-slate-400">({item.code})</span></li>)}</ul>
                <form onSubmit={(event) => {
                  event.preventDefault();
                  mutate(() => api.post(`/catalogs/${key}`, form), `${title}: item cadastrado.`);
                  setCatalogForms((current) => ({ ...current, [key]: key === 'priorities' ? { code: '', name: '', weight: 1 } : key === 'taskTypes' ? { code: '', name: '', applicable_kind: 'BOTH' } : { code: '', name: '' } }));
                }} className="space-y-2">
                  <input required placeholder="Código" value={form.code} onChange={(event) => setCatalogForms({ ...catalogForms, [key]: { ...form, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') } })} className="field" />
                  <input required placeholder="Nome" value={form.name} onChange={(event) => setCatalogForms({ ...catalogForms, [key]: { ...form, name: event.target.value } })} className="field" />
                  {key === 'priorities' && <input required type="number" min="0.1" step="0.1" value={form.weight} onChange={(event) => setCatalogForms({ ...catalogForms, [key]: { ...form, weight: Number(event.target.value) } })} className="field" />}
                  {key === 'taskTypes' && <select value={form.applicable_kind} onChange={(event) => setCatalogForms({ ...catalogForms, [key]: { ...form, applicable_kind: event.target.value } })} className="field"><option value="BOTH">Solicitação e Bug</option><option value="REQUEST">Solicitação</option><option value="BUG">Bug</option></select>}
                  <button disabled={saving} className="btn-secondary w-full"><Plus className="mr-2 h-4 w-4" />Adicionar</button>
                </form>
              </div>
            );
          })}
        </div>
      </Section>

      <Section icon={Workflow} title="Fluxos configuráveis">
        <div className="mb-5 grid gap-3 md:grid-cols-4">
          {data.workflows.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2"><strong className="text-sm">{item.name}</strong>{item.is_default && <span className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-semibold text-indigo-700">PADRÃO</span>}</div>
              <p className="mt-1 text-xs text-slate-500">{item.task_kind} · {item.stages.length} etapas</p>
              <p className="mt-2 text-xs text-slate-600">{item.stages.map((stage) => stage.name).join(' → ')}</p>
            </div>
          ))}
        </div>
        <form onSubmit={(event) => {
          event.preventDefault();
          const operation = async () => {
            const payload = {
              ...workflow,
              stages: workflow.stages.map((stage, index) => ({
                ...stage,
                sort_order: (index + 1) * 10,
                requirements: JSON.parse(stage.requirements || '{}')
              }))
            };
            await api.post('/catalogs/workflows', payload);
          };
          mutate(operation, 'Fluxo cadastrado.');
          setWorkflow(emptyWorkflow);
        }} className="rounded-lg border border-slate-200 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Input label="Nome do fluxo" required value={workflow.name} onChange={(value) => setWorkflow({ ...workflow, name: value })} />
            <Input label="Código" required value={workflow.code} onChange={(value) => setWorkflow({ ...workflow, code: value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
            <Select label="Aplicação" value={workflow.task_kind} onChange={(value) => setWorkflow({ ...workflow, task_kind: value })} options={[['BOTH', 'Solicitação e Bug'], ['REQUEST', 'Solicitação'], ['BUG', 'Bug']]} />
            <label className="flex items-end gap-2 pb-3 text-sm font-medium"><input type="checkbox" checked={workflow.is_default} onChange={(event) => setWorkflow({ ...workflow, is_default: event.target.checked })} />Definir como padrão</label>
          </div>
          <div className="mt-5 space-y-3">
            {workflow.stages.map((stage, index) => (
              <div key={index} className="grid gap-3 rounded-md bg-slate-50 p-3 lg:grid-cols-[1fr_1fr_1.2fr_2fr_auto]">
                <Input label={`Etapa ${index + 1}`} required value={stage.name} onChange={(value) => updateStage(setWorkflow, workflow, index, 'name', value)} />
                <Input label="Código" required value={stage.code} onChange={(value) => updateStage(setWorkflow, workflow, index, 'code', value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} />
                <Select label="Responsabilidade" value={stage.responsibility} onChange={(value) => updateStage(setWorkflow, workflow, index, 'responsibility', value)} options={[
                  ['ANY', 'Qualquer operador'], ['MANAGER', 'Gestor'],
                  ['BACKEND_ASSIGNEE', 'Responsável Backend'], ['FRONTEND_ASSIGNEE', 'Responsável Frontend']
                ]} />
                <label className="text-sm font-medium">Requisitos JSON<textarea rows={2} value={stage.requirements} onChange={(event) => updateStage(setWorkflow, workflow, index, 'requirements', event.target.value)} className="textarea-field mt-1 font-mono text-xs" /></label>
                <div className="flex items-end gap-3 pb-3">
                  <label className="text-xs"><input type="radio" name="terminal-stage" disabled={index !== workflow.stages.length - 1} checked={stage.completes_task} onChange={() => setWorkflow({
                    ...workflow,
                    stages: workflow.stages.map((item, itemIndex) => ({ ...item, completes_task: itemIndex === index }))
                  })} /> Final</label>
                  <label className="text-xs"><input type="checkbox" checked={stage.tracks_time} onChange={(event) => updateStage(setWorkflow, workflow, index, 'tracks_time', event.target.checked)} /> Tempo</label>
                  {workflow.stages.length > 2 && <button type="button" onClick={() => removeStage(setWorkflow, workflow, index)} className="rounded p-1 text-red-600" title="Remover etapa"><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap justify-between gap-3">
            <button type="button" onClick={() => setWorkflow({
              ...workflow,
              stages: [
                ...workflow.stages.map((stage) => ({ ...stage, completes_task: false })),
                newStage(workflow.stages.length, true)
              ]
            })} className="btn-secondary"><Plus className="mr-2 h-4 w-4" />Adicionar etapa</button>
            <Submit saving={saving}>Criar fluxo</Submit>
          </div>
          <p className="mt-3 text-xs text-slate-500">Exemplos de requisitos: <code>{'{"passing_test":true}'}</code>, <code>{'{"approval":true}'}</code> ou <code>{'{"submission_fields":["technical_notes"]}'}</code>. Fluxos em uso permanecem preservados.</p>
        </form>
      </Section>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return <section className="card p-5"><h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><Icon className="h-5 w-5 text-indigo-600" />{title}</h2>{children}</section>;
}
function Input({ label, value, onChange, required = false, type = 'text' }) {
  return <label className="text-sm font-medium">{label}<input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="field mt-1" /></label>;
}
function Select({ label, value, onChange, options }) {
  return <label className="text-sm font-medium">{label}<select required value={value} onChange={(event) => onChange(event.target.value)} className="field mt-1"><option value="">Selecione</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}
function Submit({ saving, children }) {
  return <button disabled={saving} className="btn-primary self-end">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{children}</button>;
}
function Table({ headers, rows }) {
  return <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr>{headers.map((header) => <th key={header} className="px-3 py-2">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`} className="border-t border-slate-100">{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`} className="px-3 py-2">{cell}</td>)}</tr>)}</tbody></table></div>;
}

function updateStage(setWorkflow, workflow, index, field, value) {
  setWorkflow({
    ...workflow,
    stages: workflow.stages.map((stage, itemIndex) => itemIndex === index ? { ...stage, [field]: value } : stage)
  });
}

function removeStage(setWorkflow, workflow, index) {
  const stages = workflow.stages.filter((_, itemIndex) => itemIndex !== index);
  if (!stages.some((stage) => stage.completes_task)) {
    stages[stages.length - 1] = { ...stages.at(-1), completes_task: true };
  }
  setWorkflow({ ...workflow, stages });
}
