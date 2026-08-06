import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, Download, GitBranch, Loader2, MessageSquare, Paperclip, Pause, Play, RotateCcw, Save, Send, ShieldCheck, TestTube2, Upload, XCircle } from 'lucide-react';
import { Link, useParams } from '../router';
import { useAuth } from '../context/AuthContext';
import api, { errorMessage } from '../services/api';
import StatusBadge from '../components/StatusBadge';
import WorkflowStepper from '../components/WorkflowStepper';
import { formatDate, formatDuration, label } from '../utils/formatters';

const tabs = [
  ['summary', 'Resumo', Clock3],
  ['tests', 'Testes', TestTube2],
  ['github', 'GitHub', GitBranch],
  ['attachments', 'Anexos', Paperclip],
  ['comments', 'Comentários', MessageSquare],
  ['history', 'Histórico', ShieldCheck]
];

export default function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('summary');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/tasks/${id}`);
      setData(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, [id]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const mutate = async (operation, success) => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await operation();
      setMessage(success);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <p className="text-sm text-slate-500">Carregando tarefa...</p>;
  const { task, workflow_stages: workflowStages } = data;
  const currentIndex = workflowStages.findIndex((stage) => stage.id === task.current_stage_id);
  const nextStage = workflowStages[currentIndex + 1];
  const previousStage = workflowStages[currentIndex - 1];
  const canManage = user.permissions?.includes('tasks.manage') || user.profiles?.includes('MANAGER');
  const canOperate = canManage
    || (task.responsibility === 'ANY' && user.permissions?.includes('tasks.operate'))
    || (task.responsibility === 'BACKEND_ASSIGNEE' && user.id === task.backend_assignee_id)
    || (task.responsibility === 'FRONTEND_ASSIGNEE' && user.id === task.frontend_assignee_id);

  const transition = (target, backward = false) => {
    const reason = backward ? window.prompt('Informe o motivo do retrocesso:') : undefined;
    if (backward && !reason) return;
    mutate(() => api.post(`/tasks/${id}/transition`, { target_stage: target, reason }), backward ? 'Etapa retornada.' : 'Tarefa avançada.');
  };

  const stateAction = (action) => {
    const reason = window.prompt(`Informe o motivo para ${action === 'pause' ? 'pausar' : action === 'reopen' ? 'reabrir' : 'cancelar'}:`);
    if (!reason) return;
    mutate(() => api.post(`/tasks/${id}/state`, { action, reason }), 'Estado atualizado.');
  };

  return (
    <div className="animate-fadeIn space-y-6">
      <header>
        <Link to="/task" className="mb-3 inline-flex items-center text-sm font-medium text-slate-500 hover:text-indigo-600"><ArrowLeft className="mr-1 h-4 w-4" />Voltar às tarefas</Link>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-indigo-600">{task.code}</span><StatusBadge value={task.kind} /><StatusBadge value={task.state} /><StatusBadge value={task.priority} /></div>
            <h1 className="mt-2 text-2xl font-bold">{task.title}</h1>
            <p className="mt-1 text-sm text-slate-500">Solicitante: {task.requester_name} · Criada em {formatDate(task.created_at)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && task.state === 'ACTIVE' && <button onClick={() => stateAction('pause')} className="btn-secondary"><Pause className="mr-2 h-4 w-4" />Pausar</button>}
            {canManage && ['PAUSED', 'CANCELED', 'COMPLETED'].includes(task.state) && <button onClick={() => stateAction('reopen')} className="btn-secondary"><Play className="mr-2 h-4 w-4" />Reabrir</button>}
            {canManage && !['CANCELED', 'COMPLETED'].includes(task.state) && <button onClick={() => stateAction('cancel')} className="btn-danger"><XCircle className="mr-2 h-4 w-4" />Cancelar</button>}
          </div>
        </div>
      </header>

      <section className="card overflow-x-auto p-5"><WorkflowStepper stages={workflowStages} current={task.current_stage_id} state={task.state} /></section>

      {(error || message) && <div role="alert" className={`rounded-md border p-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>{error || message}</div>}

      <section className="card">
        <nav className="flex overflow-x-auto border-b border-slate-200 px-2">
          {tabs.map(([value, text, Icon]) => (
            <button key={value} onClick={() => setTab(value)} className={`inline-flex h-12 shrink-0 items-center border-b-2 px-4 text-sm font-medium ${tab === value ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <Icon className="mr-2 h-4 w-4" />{text}
            </button>
          ))}
        </nav>
        <div className="p-5 md:p-6">
          {tab === 'summary' && <Summary data={data} user={user} mutate={mutate} />}
          {tab === 'tests' && <Tests data={data} user={user} mutate={mutate} />}
          {tab === 'github' && <Github data={data} user={user} mutate={mutate} />}
          {tab === 'attachments' && <Attachments data={data} user={user} mutate={mutate} />}
          {tab === 'comments' && <Comments data={data} mutate={mutate} />}
          {tab === 'history' && <History events={data.events} />}
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold">Controle da etapa</h2>
            {task.missing_requirements.length > 0
              ? <div className="mt-2"><p className="text-sm text-amber-800">Pendências para avançar:</p><ul className="mt-1 list-inside list-disc text-sm text-amber-700">{task.missing_requirements.map((item) => <li key={item}>{item}</li>)}</ul></div>
              : <p className="mt-1 text-sm text-green-700">Todos os requisitos da etapa estão preenchidos.</p>}
          </div>
          <div className="flex gap-2">
            {canManage && previousStage && task.state === 'ACTIVE' && <button disabled={saving} onClick={() => transition(previousStage.id, true)} className="btn-secondary"><RotateCcw className="mr-2 h-4 w-4" />Retroceder</button>}
            {canOperate && nextStage && task.state === 'ACTIVE' && <button disabled={saving || task.missing_requirements.length > 0} onClick={() => transition(nextStage.id)} className="btn-primary">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Avançar para {nextStage.name}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}

function Summary({ data, user, mutate }) {
  const { task, submissions } = data;
  const current = submissions.find((item) => item.stage === task.stage) || {};
  const [notes, setNotes] = useState({ technical_notes: current.technical_notes || '', observations: current.observations || '' });
  const [admin, setAdmin] = useState({ priority_id: task.priority_id, backend_assignee_id: task.backend_assignee_id, frontend_assignee_id: task.frontend_assignee_id });
  const [users, setUsers] = useState([]);
  const [priorities, setPriorities] = useState([]);

  useEffect(() => {
    setNotes({ technical_notes: current.technical_notes || '', observations: current.observations || '' });
  }, [current.technical_notes, current.observations]);

  useEffect(() => {
    if (user.permissions?.includes('tasks.manage')) {
      Promise.all([api.get('/users'), api.get('/catalogs/priorities')]).then(([usersResponse, prioritiesResponse]) => {
        setUsers(usersResponse.data.users.filter((item) => item.is_active));
        setPriorities(prioritiesResponse.data.items.filter((item) => item.is_active));
      });
    }
  }, [user.permissions]);

  const detailRows = [
    ['Etapa', task.stage_name],
    ['Estado', label(task.state)],
    ['Prioridade', task.priority_name],
    ['Ambiente', task.environment_name],
    ['Responsável Backend', task.backend_assignee_name],
    ['Responsável Frontend', task.frontend_assignee_name],
    ['Tempo total', formatDuration(task.total_seconds)],
    ['Tempo nesta etapa', formatDuration(task.current_stage_seconds)]
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{detailRows.map(([name, value]) => <div key={name} className="rounded-md border border-slate-200 p-3"><p className="text-xs font-medium text-slate-500">{name}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>)}</div>
      <div><h3 className="text-sm font-semibold">Descrição inicial</h3><p className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-sm text-slate-700">{task.initial_description}</p></div>
      {task.kind === 'BUG' && <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm"><p><strong>Produto:</strong> {task.product_affected}</p><p className="mt-1"><strong>Requisito:</strong> {task.related_requirement}</p><p className="mt-1"><strong>Evidências:</strong> {task.initial_evidence}</p></div>}

      {Array.isArray(task.requirements?.submission_fields) && task.requirements.submission_fields.length > 0 && task.state === 'ACTIVE' && (
        <form onSubmit={(event) => { event.preventDefault(); mutate(() => api.put(`/tasks/${task.id}/submission`, notes), 'Informações da etapa salvas.'); }} className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold">Informações da etapa {label(task.stage)}</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">Informações técnicas<textarea rows={4} className="textarea-field mt-1" value={notes.technical_notes} onChange={(e) => setNotes({ ...notes, technical_notes: e.target.value })} /></label>
            <label className="text-sm font-medium">Observações<textarea rows={4} className="textarea-field mt-1" value={notes.observations} onChange={(e) => setNotes({ ...notes, observations: e.target.value })} /></label>
          </div>
          <button className="btn-primary mt-3"><Save className="mr-2 h-4 w-4" />Salvar etapa</button>
        </form>
      )}

      {user.permissions?.includes('tasks.manage') && (
        <form onSubmit={(event) => { event.preventDefault(); mutate(() => api.patch(`/tasks/${task.id}/administration`, admin), 'Administração atualizada.'); }} className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
          <h3 className="font-semibold text-indigo-900">Administração da tarefa</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Select value={admin.priority_id} onChange={(value) => setAdmin({ ...admin, priority_id: value })} options={priorities.map((item) => [item.id, item.name])} />
            <Select value={admin.backend_assignee_id} onChange={(value) => setAdmin({ ...admin, backend_assignee_id: value })} options={users.map((item) => [item.id, `Backend: ${item.name}`])} />
            <Select value={admin.frontend_assignee_id} onChange={(value) => setAdmin({ ...admin, frontend_assignee_id: value })} options={users.map((item) => [item.id, `Frontend: ${item.name}`])} />
          </div>
          <button className="btn-primary mt-3"><Save className="mr-2 h-4 w-4" />Salvar administração</button>
        </form>
      )}
    </div>
  );
}

function Tests({ data, user, mutate }) {
  const { task } = data;
  const [form, setForm] = useState({ description: '', result: 'PASSED', evidence: '' });
  const [approval, setApproval] = useState({ decision: 'APPROVED', notes: '' });
  const canApprove = user.permissions?.includes('tasks.manage') || user.profiles?.includes('MANAGER');
  const canOperate = canApprove
    || (task.responsibility === 'ANY' && user.permissions?.includes('tasks.operate'))
    || (task.responsibility === 'BACKEND_ASSIGNEE' && user.id === task.backend_assignee_id)
    || (task.responsibility === 'FRONTEND_ASSIGNEE' && user.id === task.frontend_assignee_id);
  const canRegisterTest = canOperate && task.requirements?.passing_test;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        <h3 className="font-semibold">Registros de teste</h3>
        <div className="mt-3 space-y-3">
          {data.tests.length === 0 && <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">Nenhum teste registrado.</p>}
          {data.tests.map((test) => <div key={test.id} className="rounded-md border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><StatusBadge value={test.result} /><span className="ml-2 text-xs font-medium text-slate-500">{test.stage_name}</span></div><span className="text-xs text-slate-400">{formatDate(test.created_at)}</span></div><p className="mt-2 text-sm font-medium">{test.description}</p>{test.evidence && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{test.evidence}</p>}<p className="mt-2 text-xs text-slate-400">por {test.created_by_name}</p></div>)}
        </div>
        {data.approvals.length > 0 && <><h3 className="mt-6 font-semibold">Aprovações</h3><div className="mt-3 space-y-2">{data.approvals.map((item) => <div key={item.id} className="rounded-md border border-slate-200 p-3 text-sm"><StatusBadge value={item.decision} /><strong className="ml-2">{item.stage_name}</strong><p className="mt-1 text-slate-600">{item.notes}</p><p className="mt-1 text-xs text-slate-400">{item.created_by_name} · {formatDate(item.created_at)}</p></div>)}</div></>}
      </div>
      <div className="space-y-4">
        {canRegisterTest && <form onSubmit={(event) => { event.preventDefault(); mutate(() => api.post(`/tasks/${task.id}/tests`, form), 'Teste registrado.'); setForm({ ...form, description: '', evidence: '' }); }} className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold">Registrar teste</h3>
          <div className="mt-3 space-y-3">
            <p className="text-sm font-medium text-slate-600">Contexto: {label(task.stage)}</p>
            <textarea required rows={3} className="textarea-field" placeholder="Teste realizado" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Select value={form.result} onChange={(value) => setForm({ ...form, result: value })} options={['PASSED', 'FAILED', 'BLOCKED'].map((value) => [value, label(value)])} />
            <textarea rows={3} className="textarea-field" placeholder="Evidências" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
            <button className="btn-primary w-full"><TestTube2 className="mr-2 h-4 w-4" />Registrar</button>
          </div>
        </form>}
        {canApprove && task.requirements?.approval && (
          <form onSubmit={(event) => { event.preventDefault(); mutate(() => api.post(`/tasks/${task.id}/approvals`, approval), 'Decisão registrada.'); setApproval({ ...approval, notes: '' }); }} className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
            <h3 className="font-semibold">Aprovar ou reprovar</h3>
            <div className="mt-3 space-y-3">
              <p className="text-sm font-medium text-slate-600">Contexto: {label(task.stage)}</p>
              <Select value={approval.decision} onChange={(value) => setApproval({ ...approval, decision: value })} options={[['APPROVED', 'Aprovar'], ['REJECTED', 'Reprovar']]} />
              <textarea required rows={3} className="textarea-field" placeholder="Observações da decisão" value={approval.notes} onChange={(e) => setApproval({ ...approval, notes: e.target.value })} />
              <button className="btn-primary w-full"><CheckCircle2 className="mr-2 h-4 w-4" />Registrar decisão</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Github({ data, user, mutate }) {
  const { task } = data;
  const [form, setForm] = useState(data.github || { repository_url: '', branch: '', commit_sha: '', pull_request_url: '', release: '' });
  const canEdit = Array.isArray(task.requirements?.github_fields)
    && (user.permissions?.includes('tasks.manage') || user.profiles?.includes('MANAGER'));
  useEffect(() => setForm(data.github || { repository_url: '', branch: '', commit_sha: '', pull_request_url: '', release: '' }), [data.github]);
  return (
    <form onSubmit={(event) => { event.preventDefault(); mutate(() => api.put(`/tasks/${task.id}/github`, form), 'Metadados GitHub salvos.'); }} className="mx-auto max-w-2xl">
      <div className="mb-5 rounded-md border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">Integração automática será adicionada futuramente. Nesta fase, os vínculos são registrados manualmente.</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Link do repositório" value={form.repository_url || ''} onChange={(value) => setForm({ ...form, repository_url: value })} className="sm:col-span-2" />
        <Input label="Branch" value={form.branch || ''} onChange={(value) => setForm({ ...form, branch: value })} />
        <Input label="Commit" value={form.commit_sha || ''} onChange={(value) => setForm({ ...form, commit_sha: value })} />
        <Input label="Pull Request" value={form.pull_request_url || ''} onChange={(value) => setForm({ ...form, pull_request_url: value })} />
        <Input label="Release" value={form.release || ''} onChange={(value) => setForm({ ...form, release: value })} />
      </div>
      {canEdit && <button className="btn-primary mt-4"><Save className="mr-2 h-4 w-4" />Salvar GitHub</button>}
    </form>
  );
}

function Attachments({ data, user, mutate }) {
  const [file, setFile] = useState(null);
  const [description, setDescription] = useState('');
  const upload = () => {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    body.append('description', description);
    mutate(() => api.post(`/tasks/${data.task.id}/attachments`, body), 'Anexo incluído.');
    setFile(null);
    setDescription('');
  };
  return (
    <div className="space-y-5">
      <div className="rounded-lg border-2 border-dashed border-slate-300 p-5 text-center">
        <Upload className="mx-auto h-7 w-7 text-slate-400" />
        <input type="file" onChange={(e) => setFile(e.target.files[0] || null)} className="mt-3 text-sm" />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição opcional" className="field mt-3 max-w-md" />
        <div><button type="button" disabled={!file} onClick={upload} className="btn-primary mt-3">Enviar anexo</button></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.attachments.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-4">
            <div className="min-w-0"><p className="truncate text-sm font-medium">{item.original_name}</p><p className="text-xs text-slate-500">{Math.ceil(item.size_bytes / 1024)} KB · {item.created_by_name}</p></div>
            <div className="flex gap-1">
              <a href={`${api.defaults.baseURL}/tasks/${data.task.id}/attachments/${item.id}`} className="rounded-md p-2 text-indigo-600 hover:bg-indigo-50" title="Baixar"><Download className="h-4 w-4" /></a>
              {user.access_level === 'ADMIN' && <button onClick={() => mutate(() => api.delete(`/tasks/${data.task.id}/attachments/${item.id}`), 'Anexo removido logicamente.')} className="rounded-md p-2 text-red-600 hover:bg-red-50" title="Remover"><XCircle className="h-4 w-4" /></button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Comments({ data, mutate }) {
  const [content, setContent] = useState('');
  return (
    <div className="mx-auto max-w-3xl">
      <div className="space-y-3">
        {data.comments.length === 0 && <p className="rounded-md bg-slate-50 p-5 text-center text-sm text-slate-500">Nenhum comentário.</p>}
        {data.comments.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 p-4"><div className="flex justify-between gap-3"><strong className="text-sm">{item.created_by_name}</strong><span className="text-xs text-slate-400">{formatDate(item.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{item.content}</p></div>)}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); mutate(() => api.post(`/tasks/${data.task.id}/comments`, { content }), 'Comentário registrado.'); setContent(''); }} className="mt-5 flex gap-3">
        <textarea required rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Escreva um comentário..." className="textarea-field" />
        <button className="btn-primary h-auto px-4"><Send className="h-4 w-4" /><span className="sr-only">Enviar</span></button>
      </form>
    </div>
  );
}

function History({ events }) {
  return (
    <ol className="relative mx-auto max-w-3xl border-l border-slate-200">
      {events.map((event) => <li key={event.id} className="mb-6 ml-6"><span className="absolute -left-2 flex h-4 w-4 rounded-full border-2 border-white bg-indigo-500" /><div className="rounded-md border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{event.event_type}</strong><span className="text-xs text-slate-400">{formatDate(event.created_at)}</span></div><p className="mt-1 text-sm text-slate-600">{event.description}</p><p className="mt-2 text-xs text-slate-400">por {event.actor_name}</p></div></li>)}
    </ol>
  );
}

function Select({ value, onChange, options }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="field">{options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}</select>;
}
function Input({ label: inputLabel, value, onChange, className = '' }) {
  return <label className={`text-sm font-medium ${className}`}>{inputLabel}<input value={value} onChange={(e) => onChange(e.target.value)} className="field mt-1" /></label>;
}
