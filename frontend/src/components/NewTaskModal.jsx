import { useEffect, useMemo, useState } from 'react';
import { Bug, FilePlus2, Loader2, X } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import { parseDurationInput } from '../utils/timing';
import { priorityDisplayName } from '../utils/formatters';

const emptyForm = {
  kind: 'REQUEST',
  project_id: '',
  task_type_id: '',
  priority_id: '',
  environment_id: '',
  workflow_id: '',
  title: '',
  initial_description: '',
  requester_id: '',
  client_environment: '',
  product_affected: '',
  related_requirement: '',
  related_task_id: '',
  bug_area: 'BACKEND',
  initial_evidence: '',
  backend_assignee_id: '',
  frontend_assignee_id: '',
  estimated_duration: ''
};

export default function NewTaskModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(emptyForm);
  const [catalogs, setCatalogs] = useState(null);
  const [relatedTasks, setRelatedTasks] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    Promise.all([api.get('/catalogs/bootstrap'), api.get('/tasks', { params: { limit: 100 } })])
      .then(([catalogResponse, taskResponse]) => {
        const data = catalogResponse.data;
        const activeUsers = data.users || [];
        setCatalogs(data);
        setRelatedTasks(taskResponse.data.tasks);
        const project = data.projects.find((item) => item.status === 'ACTIVE') || data.projects[0];
        const kind = 'REQUEST';
        setForm((current) => ({
          ...current,
          project_id: current.project_id || project?.id || '',
          task_type_id: current.task_type_id || data.task_types.find((item) => item.is_active && ['REQUEST', 'BOTH'].includes(item.applicable_kind))?.id || '',
          priority_id: current.priority_id || data.priorities.find((item) => item.code === 'MEDIUM')?.id || data.priorities.find((item) => item.is_active)?.id || '',
          environment_id: current.environment_id || project?.default_environment_id || data.environments.find((item) => item.is_active)?.id || '',
          workflow_id: current.workflow_id || data.workflows.find((item) => item.is_default && [kind, 'BOTH'].includes(item.task_kind))?.id || '',
          requester_id: current.requester_id || activeUsers[0]?.id || '',
          backend_assignee_id: current.backend_assignee_id || activeUsers.find((user) => user.profiles?.includes('BACKEND_DEVELOPER'))?.id || activeUsers[0]?.id || '',
          frontend_assignee_id: current.frontend_assignee_id || activeUsers.find((user) => user.profiles?.includes('FRONTEND_DEVELOPER'))?.id || activeUsers[0]?.id || ''
        }));
      })
      .catch((requestError) => setError(errorMessage(requestError)));
  }, [open]);

  const taskTypes = useMemo(
    () => catalogs?.task_types.filter((item) => item.is_active && [form.kind, 'BOTH'].includes(item.applicable_kind)) || [],
    [catalogs, form.kind]
  );
  const workflows = useMemo(
    () => catalogs?.workflows.filter((item) => item.is_active && [form.kind, 'BOTH'].includes(item.task_kind)) || [],
    [catalogs, form.kind]
  );
  if (!open) return null;

  const change = (field, value) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'kind' && catalogs) {
        next.task_type_id = catalogs.task_types.find((item) => item.is_active && [value, 'BOTH'].includes(item.applicable_kind))?.id || '';
        next.workflow_id = catalogs.workflows.find((item) => item.is_default && [value, 'BOTH'].includes(item.task_kind))?.id || '';
      }
      if (field === 'project_id' && catalogs) {
        next.environment_id = catalogs.projects.find((item) => item.id === value)?.default_environment_id || next.environment_id;
      }
      return next;
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    const estimatedSeconds = form.estimated_duration ? parseDurationInput(form.estimated_duration) : null;
    if (form.estimated_duration && estimatedSeconds == null) {
      setError('Informe a estimativa no formato dd-hh-mm, com horas de 00 a 23 e minutos de 00 a 59.');
      setSaving(false);
      return;
    }
    try {
      const payload = {
        ...form,
        estimated_duration_seconds: estimatedSeconds,
        workflow_id: form.workflow_id || undefined,
        product_affected: form.kind === 'BUG' ? form.product_affected : null,
        related_requirement: form.kind === 'BUG' ? form.related_requirement : null,
        related_task_id: form.kind === 'BUG' && form.related_task_id ? form.related_task_id : null,
        bug_area: form.kind === 'BUG' ? form.bug_area : null,
        initial_evidence: form.kind === 'BUG' ? form.initial_evidence : null,
        client_environment: form.client_environment || null
      };
      delete payload.estimated_duration;
      const response = await api.post('/tasks', payload);
      for (const file of files) {
        const body = new FormData();
        body.append('file', file);
        body.append('sourceSection', 'geral');
        await api.post(`/tasks/${response.data.task.id}/attachments`, body);
      }
      setForm(emptyForm);
      setFiles([]);
      onCreated(response.data.task);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const users = catalogs?.users || [];
  const noProject = catalogs && catalogs.projects.length === 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
      <form onSubmit={submit} className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto shadow-xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h2 id="new-task-title" className="text-lg font-semibold">Nova Tarefa</h2>
            <p className="text-sm text-slate-500">Crie um dossiê técnico vinculado a um projeto.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-400 hover:bg-slate-100" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-5 p-6">
          <div className="grid grid-cols-2 gap-3">
            {[
              ['REQUEST', FilePlus2, 'Nova Solicitação'],
              ['BUG', Bug, 'Reportar Bug']
            ].map(([value, Icon, text]) => (
              <button key={value} type="button" onClick={() => change('kind', value)}
                className={`flex items-center justify-center gap-2 rounded-lg border p-4 text-sm font-medium ${
                  form.kind === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'
                }`}>
                <Icon className="h-5 w-5" /> {text}
              </button>
            ))}
          </div>
          {noProject && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Cadastre um cliente e um projeto em Cadastros antes de criar tarefas.</div>}
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <Input label="Título *" required value={form.title} onChange={(value) => change('title', value)} />
          <label className="block text-sm font-medium text-slate-700">Descrição inicial *<textarea required rows={4} value={form.initial_description} onChange={(e) => change('initial_description', e.target.value)} className="textarea-field mt-1" /></label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Projeto *" value={form.project_id} onChange={(value) => change('project_id', value)} options={(catalogs?.projects || []).filter((item) => ['ACTIVE', 'DRAFT'].includes(item.status)).map((item) => [item.id, `${item.name} · ${item.client_name}`])} />
            <Select label="Tipo *" value={form.task_type_id} onChange={(value) => change('task_type_id', value)} options={taskTypes.map((item) => [item.id, item.name])} />
            <Select label="Prioridade *" value={form.priority_id} onChange={(value) => change('priority_id', value)} options={(catalogs?.priorities || []).filter((item) => item.is_active).map((item) => [item.id, priorityDisplayName(item)])} />
            <Select label="Ambiente *" value={form.environment_id} onChange={(value) => change('environment_id', value)} options={(catalogs?.environments || []).filter((item) => item.is_active).map((item) => [item.id, item.name])} />
            <Select label="Fluxo *" value={form.workflow_id} onChange={(value) => change('workflow_id', value)} options={workflows.map((item) => [item.id, item.name])} />
            <Select label="Solicitante *" value={form.requester_id} onChange={(value) => change('requester_id', value)} options={users.map((user) => [user.id, user.name])} />
            <Select label="Responsável Backend *" value={form.backend_assignee_id} onChange={(value) => change('backend_assignee_id', value)} options={users.map((user) => [user.id, user.name])} />
            <Select label="Responsável Frontend *" value={form.frontend_assignee_id} onChange={(value) => change('frontend_assignee_id', value)} options={users.map((user) => [user.id, user.name])} />
            <Input label="Tempo estimado (dd-hh-mm)" required={false} value={form.estimated_duration} onChange={(value) => change('estimated_duration', value.replace(/[^0-9-]/g, '').slice(0, 9))} placeholder="02-08-30" pattern="[0-9]{2,3}-[0-9]{2}-[0-9]{2}" />
          </div>

          {form.kind === 'BUG' && (
            <div className="space-y-4 rounded-lg border border-red-200 bg-red-50/50 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Produto afetado *" required value={form.product_affected} onChange={(value) => change('product_affected', value)} />
                <Select label="Classificação *" value={form.bug_area} onChange={(value) => change('bug_area', value)} options={[['BACKEND', 'Backend'], ['FRONTEND', 'Frontend'], ['BOTH', 'Backend e Frontend']]} />
              </div>
              <label className="block text-sm font-medium">Requisito relacionado *<textarea required rows={2} className="textarea-field mt-1" value={form.related_requirement} onChange={(e) => change('related_requirement', e.target.value)} /></label>
              <Select label="Tarefa de origem" required={false} value={form.related_task_id} onChange={(value) => change('related_task_id', value)} options={relatedTasks.map((task) => [task.id, `DF-${String(task.task_number).padStart(6, '0')} · ${task.title}`])} />
              <label className="block text-sm font-medium">Evidências *<textarea required rows={3} className="textarea-field mt-1" value={form.initial_evidence} onChange={(e) => change('initial_evidence', e.target.value)} /></label>
            </div>
          )}

          <label className="block text-sm font-medium text-slate-700">Anexos iniciais<input type="file" multiple onChange={(e) => setFiles([...e.target.files])} className="mt-1 block w-full rounded-md border border-dashed border-slate-300 p-3 text-sm" /></label>
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button disabled={saving || noProject || !catalogs} className="btn-primary">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{saving ? 'Criando...' : 'Criar tarefa'}</button>
        </footer>
      </form>
    </div>
  );
}

function Select({ label, value, onChange, options, required = true }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<select required={required} value={value} onChange={(event) => onChange(event.target.value)} className="field mt-1"><option value="">Selecione</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}

function Input({ label, value, onChange, required = false, placeholder, pattern }) {
  return <label className="block text-sm font-medium text-slate-700">{label}<input required={required} value={value} placeholder={placeholder} pattern={pattern} onChange={(event) => onChange(event.target.value)} className="field mt-1" /></label>;
}
