import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Clock3, Copy, Download, File, FileArchive, FileCode2, FileSpreadsheet, FileText, FileVideo2, GitBranch, Loader2, MessageSquare, Paperclip, Pause, Pencil, Play, Plus, RotateCcw, Save, Send, ShieldCheck, TestTube2, Trash2, Upload, X, XCircle } from 'lucide-react';
import { Link, useNavigate, useParams } from '../router';
import { useAuth } from '../context/AuthContext';
import api, { errorMessage } from '../services/api';
import StatusBadge from '../components/StatusBadge';
import WorkflowStepper from '../components/WorkflowStepper';
import StagePrerequisiteChecklist from '../components/StagePrerequisiteChecklist';
import CentralTimeline from '../components/CentralTimeline';
import { formatDate, formatDuration, label, priorityDisplayName } from '../utils/formatters';
import { durationInput, formatSignedDuration, parseDurationInput } from '../utils/timing';
import { CODE_LANGUAGES, codeLanguageLabel, resolveCodeLanguage } from '../utils/codeLanguages';
import useEditorTheme from '../hooks/useEditorTheme';
import { attachmentTimelineItems, githubTimelineItems, historyTimelineItems, qaTimelineItems } from '../utils/timeline';
import StrongConfirmationModal from '../components/StrongConfirmationModal';

const CodeEditor = lazy(() => import('../components/CodeEditor'));

const QA_ACCESS_PROFILES = [
  ['Super Admin', 'Super Admin'],
  ['Administrador', 'Administrador']
];
const QA_EXCLUDED_PROFILES = new Set(['Cliente', 'Desenvolvedor Backend', 'Desenvolvedor Frontend']);
const QA_COMPONENT_OPTIONS = [
  ['', 'Não informado'],
  ['Não se aplica', 'Não se aplica'],
  ['Não testado', 'Não testado'],
  ['Em desenvolvimento', 'Em desenvolvimento'],
  ['Pronto para teste', 'Pronto para teste'],
  ['Validado', 'Validado']
];

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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('summary');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [timerPending, setTimerPending] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);

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
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <p className="text-sm text-slate-500">Carregando tarefa...</p>;
  const { task, workflow_stages: workflowStages } = data;
  const currentIndex = workflowStages.findIndex((stage) => stage.id === task.current_stage_id);
  const nextStage = workflowStages[currentIndex + 1];
  const previousStage = workflowStages[currentIndex - 1];
  const canManage = user.is_super_admin || user.permissions?.includes('tasks.manage') || user.profiles?.includes('MANAGER');
  const canDeleteTask = user.is_super_admin || user.permissions?.includes('tasks.manage');
  const canOperate = canManage
    || (task.responsibility === 'ANY' && user.permissions?.includes('tasks.operate'))
    || (task.responsibility === 'BACKEND_ASSIGNEE' && user.id === task.backend_assignee_id)
    || (task.responsibility === 'FRONTEND_ASSIGNEE' && user.id === task.frontend_assignee_id);
  const isRoadmapStage = String(task.stage || '').toUpperCase() === 'ROADMAP'
    || String(task.stage_name || '').trim().toLowerCase() === 'roadmap';
  const isFrontendApprovalStage = String(task.stage || '').toUpperCase() === 'FRONTEND_APPROVAL';
  const advanceBlocked = task.missing_requirements.length > 0;

  const transition = (target, backward = false) => {
    const reason = backward ? window.prompt('Informe o motivo do retrocesso:') : undefined;
    if (backward && !reason) return;
    mutate(() => api.post(`/tasks/${id}/transition`, { target_stage: target, reason }), backward ? 'Etapa retornada.' : 'Tarefa avançada.');
  };

  const reopenTask = () => {
    const reason = window.prompt('Informe o motivo para reabrir:');
    if (!reason) return;
    mutate(() => api.post(`/tasks/${id}/state`, { action: 'reopen', reason }), 'Estado atualizado.');
  };
  const timerAction = async (action) => {
    const messages = { start: 'Cronometro iniciado.', pause: 'Cronometro pausado.', resume: 'Cronometro retomado.' };
    setTimerPending(true);
    try {
      return await mutate(() => api.post(`/tasks/${id}/timer`, { action }), messages[action]);
    } finally {
      setTimerPending(false);
    }
  };
  const deleteTask = async (confirmation) => {
    setSaving(true); setError(''); setMessage('');
    try {
      await api.delete(`/tasks/${id}`, { data: { confirmation } });
      navigate('/task');
    } catch (requestError) {
      setError(errorMessage(requestError));
      setDeleteConfirmationOpen(false);
    } finally { setSaving(false); }
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
            {canManage && ['PAUSED', 'CANCELED', 'COMPLETED'].includes(task.state) && <button onClick={reopenTask} className="btn-secondary"><Play className="mr-2 h-4 w-4" />Reabrir</button>}
            {canDeleteTask && <button type="button" onClick={() => setDeleteConfirmationOpen(true)} className="btn-danger"><Trash2 className="mr-2 h-4 w-4" />Excluir tarefa</button>}
          </div>
        </div>
      </header>

      <section className="-mt-2 overflow-x-auto py-1" aria-label="Etapas da tarefa"><WorkflowStepper stages={workflowStages} current={task.current_stage_id} state={task.state} /></section>

      {!isRoadmapStage && <section className={`card p-5 ${task.is_overdue ? 'border-red-300' : ''}`} aria-label={`Tempos da etapa ${task.stage_name}`}>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">{[
          ['Etapa atual', task.stage_name],
          ['Lead time', formatSignedDuration(task.lead_time_seconds)],
          ['Touch time', formatSignedDuration(task.active_elapsed_seconds)],
          ['Tempo restante', formatSignedDuration(task.remaining_seconds)],
          ['Cronometro', task.timer_status]
        ].map(([name, value]) => <div key={name}><p className="text-xs font-medium text-slate-500">{name}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>)}</div><div className="flex flex-wrap gap-2">{canOperate && task.tracks_time && task.state === 'ACTIVE' && ['not_started', 'running', 'paused'].includes(task.timer_status) && <button type="button" aria-busy={timerPending} disabled={saving || timerPending} onClick={() => timerAction(task.timer_status === 'running' ? 'pause' : task.timer_status === 'paused' ? 'resume' : 'start')} className={task.timer_status === 'running' ? 'inline-flex h-10 items-center justify-center rounded-md bg-amber-500 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50' : 'btn-primary'}>{timerPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : task.timer_status === 'running' ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}{task.timer_status === 'running' ? 'Pause' : 'Iniciar'}</button>}</div></div>
        {data.stage_touch_by_user?.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label="Touch time por desenvolvedor">{data.stage_touch_by_user.map((item) => <div key={item.user_id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-3"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ${item.is_running ? 'bg-emerald-600' : 'bg-indigo-600'}`}>{item.user_name.split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><span className="text-xs"><strong>{item.user_name}</strong> · {formatDuration(item.active_seconds)}</span></div>)}</div>}
        <p className={`mt-4 text-sm font-semibold ${task.is_overdue ? 'text-red-700' : 'text-emerald-700'}`}><span className="sr-only">Status do prazo: </span>{task.is_overdue ? 'Tarefa atrasada' : task.estimated_duration_seconds == null ? 'Estimativa nao definida' : 'Dentro do prazo'}</p>
      </section>}

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
          {tab === 'github' && <Github data={data} user={user} mutate={mutate} saving={saving} />}
          {tab === 'attachments' && <Attachments data={data} user={user} mutate={mutate} />}
          {tab === 'comments' && <Comments data={data} mutate={mutate} />}
          {tab === 'history' && <History events={data.events} timerEvents={data.timer_events} />}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Controle da etapa</h2>
        {isFrontendApprovalStage
          ? <FrontendApprovalPanel task={task} user={user} previousStage={previousStage} nextStage={nextStage} canReview={canOperate} saving={saving} mutate={mutate} />
          : <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <StagePrerequisiteChecklist task={task} tests={data.tests} githubCards={data.github_cards} attachments={data.attachments} />
              <div className="flex flex-wrap justify-end gap-2">
                {canManage && previousStage && task.state === 'ACTIVE' && <button disabled={saving} onClick={() => transition(previousStage.id, true)} className="btn-secondary"><RotateCcw className="mr-2 h-4 w-4" />Retroceder</button>}
                {canOperate && nextStage && task.state === 'ACTIVE' && <button aria-describedby="stage-prerequisite-checklist" title={advanceBlocked ? 'Conclua as pendências obrigatórias antes de avançar.' : `Avançar para ${nextStage.name}`} disabled={saving || advanceBlocked} onClick={() => transition(nextStage.id)} className={advanceBlocked ? 'inline-flex h-10 items-center justify-center rounded-md border border-amber-400 bg-amber-100 px-4 text-sm font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-80' : 'btn-primary'}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{advanceBlocked && <AlertTriangle className="mr-2 h-4 w-4" />}Avançar para {nextStage.name}</button>}
              </div>
            </div>}
      </section>
      {deleteConfirmationOpen && <StrongConfirmationModal title={`Excluir a tarefa ${task.code}?`} message="A tarefa será movida para a lixeira e deixará de aparecer nas áreas operacionais do DevFlow." confirmationText={task.code} actionLabel="Excluir tarefa" busy={saving} onCancel={() => setDeleteConfirmationOpen(false)} onConfirm={deleteTask} />}
    </div>
  );
}

function FrontendApprovalPanel({ task, user, previousStage, nextStage, canReview, saving, mutate }) {
  const [approvalNotes, setApprovalNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const activeReview = task.state === 'ACTIVE' && canReview;
  const approve = () => mutate(async () => {
    const notes = approvalNotes.trim();
    await api.post(`/tasks/${task.id}/approvals`, { decision: 'APPROVED', notes });
    await api.post(`/tasks/${task.id}/comments`, { content: `Aprovação do Frontend: ${notes}` });
    await api.post(`/tasks/${task.id}/transition`, { target_stage: nextStage.id });
  }, 'Frontend aprovado e encaminhado para Update GitHub.');
  const reject = () => mutate(async () => {
    const reason = rejectionReason.trim();
    await api.post(`/tasks/${task.id}/approvals`, { decision: 'REJECTED', notes: reason });
    const response = await api.post(`/tasks/${task.id}/comments`, { content: `Reprovação do Frontend: ${reason}` });
    if (evidenceFile) {
      const body = new FormData();
      body.append('file', evidenceFile);
      body.append('comment_id', response.data.comment.id);
      body.append('description', 'Evidência da reprovação do Frontend');
      body.append('sourceSection', 'comentarios');
      await api.post(`/tasks/${task.id}/attachments`, body);
    }
    await api.post(`/tasks/${task.id}/transition`, { target_stage: previousStage.id, reason });
  }, 'Frontend reprovado e devolvido para a etapa Frontend.');

  return <div className="mt-4 space-y-4">
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900"><p className="font-semibold">Revisão dedicada do Frontend</p><p className="mt-1">Responsável pela revisão: {canReview ? user.name : 'Gestor ou Administrador atribuído à etapa'}.</p></div>
    <div className="grid gap-4 xl:grid-cols-2">
      <form onSubmit={(event) => { event.preventDefault(); approve(); }} className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
        <h3 className="flex items-center gap-2 font-semibold text-emerald-800"><CheckCircle2 className="h-5 w-5" />Aprovar Frontend</h3>
        <label className="mt-3 block text-sm font-medium text-slate-700">Descrição/Observações de Aprovação<textarea required minLength={3} maxLength={50000} rows={4} disabled={!activeReview || saving} value={approvalNotes} onChange={(event) => setApprovalNotes(event.target.value)} className="textarea-field mt-1 disabled:bg-slate-100" /></label>
        <button disabled={!activeReview || saving || approvalNotes.trim().length < 3 || !nextStage} className="btn-primary mt-3">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aprovar Frontend</button>
      </form>
      <form onSubmit={(event) => { event.preventDefault(); reject(); }} className="rounded-xl border border-red-200 bg-red-50/60 p-4">
        <h3 className="flex items-center gap-2 font-semibold text-red-800"><RotateCcw className="h-5 w-5" />Reprovar / Devolver para Frontend</h3>
        <label className="mt-3 block text-sm font-medium text-slate-700">Motivo da Reprovação<textarea required minLength={5} maxLength={50000} rows={4} disabled={!activeReview || saving} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} className="textarea-field mt-1 disabled:bg-slate-100" /></label>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600"><Paperclip className="h-4 w-4" /><input type="file" disabled={!activeReview || saving} onChange={(event) => setEvidenceFile(event.target.files[0] || null)} className="sr-only" />{evidenceFile ? evidenceFile.name : 'Anexar evidência da reprovação'}</label>
        <button disabled={!activeReview || saving || rejectionReason.trim().length < 5 || !previousStage} className="btn-danger mt-3">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reprovar / Devolver para Frontend</button>
      </form>
    </div>
  </div>;
}

function Summary({ data, user, mutate }) {
  const { task, submissions } = data;
  const current = submissions.find((item) => item.stage === task.stage) || {};
  const [notes, setNotes] = useState({ technical_notes: current.technical_notes || '', observations: current.observations || '' });
  const [admin, setAdmin] = useState({ priority_id: task.priority_id, backend_assignee_id: task.backend_assignee_id, frontend_assignee_id: task.frontend_assignee_id, estimated_duration: durationInput(task.estimated_duration_seconds) });
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

  const summaryIsRoadmap = String(task.stage || '').toUpperCase() === 'ROADMAP'
    || String(task.stage_name || '').trim().toLowerCase() === 'roadmap';
  const detailRows = [
    ['Etapa', task.stage_name],
    ['Estado', label(task.state)],
    ['Prioridade', priorityDisplayName(task)],
    ['Ambiente', task.environment_name],
    ['Responsável Backend', task.backend_assignee_name],
    ['Responsável Frontend', task.frontend_assignee_name],
    ...(summaryIsRoadmap ? [] : [
      ['Tempo total', formatDuration(task.total_seconds)],
      ['Tempo nesta etapa', formatDuration(task.current_stage_seconds)]
    ])
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
        <form onSubmit={(event) => { event.preventDefault(); const estimate = admin.estimated_duration ? parseDurationInput(admin.estimated_duration) : undefined; mutate(() => api.patch(`/tasks/${task.id}/administration`, { priority_id: admin.priority_id, backend_assignee_id: admin.backend_assignee_id, frontend_assignee_id: admin.frontend_assignee_id, estimated_duration_seconds: estimate }), 'Administração atualizada.'); }} className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
          <h3 className="font-semibold text-indigo-900">Administração da tarefa</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <Select value={admin.priority_id} onChange={(value) => setAdmin({ ...admin, priority_id: value })} options={priorities.map((item) => [item.id, priorityDisplayName(item)])} />
            <Select value={admin.backend_assignee_id} onChange={(value) => setAdmin({ ...admin, backend_assignee_id: value })} options={users.map((item) => [item.id, `Backend: ${item.name}`])} />
            <Select value={admin.frontend_assignee_id} onChange={(value) => setAdmin({ ...admin, frontend_assignee_id: value })} options={users.map((item) => [item.id, `Frontend: ${item.name}`])} />
            {!summaryIsRoadmap && <input aria-label="Tempo estimado dd-hh-mm" pattern="[0-9]{2,3}-[0-9]{2}-[0-9]{2}" placeholder="Estimativa dd-hh-mm" value={admin.estimated_duration} onChange={(event) => setAdmin({ ...admin, estimated_duration: event.target.value.replace(/[^0-9-]/g, '').slice(0, 9) })} className="field" />}
          </div>
          <button className="btn-primary mt-3"><Save className="mr-2 h-4 w-4" />Salvar administração</button>
        </form>
      )}
    </div>
  );
}

function Tests({ data, user, mutate }) {
  const { task } = data;
  const createEmptyTest = () => ({ status: 'APPROVED', environments: ['local'], context: '', validated_profiles: [], backend_info: '', frontend_info: '', testing_notes: '' });
  const [form, setForm] = useState(createEmptyTest);
  const [systemProfiles, setSystemProfiles] = useState([]);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [modal, setModal] = useState({ open: false, mode: 'view', test: null });
  const [approval, setApproval] = useState({ decision: 'APPROVED', notes: '' });
  useEffect(() => {
    let active = true;
    api.get('/users/profiles').then(({ data: response }) => {
      if (active) setSystemProfiles(response.profiles || []);
    }).catch(() => {
      if (active) setSystemProfiles([]);
    });
    return () => { active = false; };
  }, []);
  const canApprove = user.permissions?.includes('tasks.manage') || user.profiles?.includes('MANAGER');
  const canOperate = canApprove
    || (task.responsibility === 'ANY' && user.permissions?.includes('tasks.operate'))
    || (task.responsibility === 'BACKEND_ASSIGNEE' && user.id === task.backend_assignee_id)
    || (task.responsibility === 'FRONTEND_ASSIGNEE' && user.id === task.frontend_assignee_id);
  const canRegisterTest = canOperate;
  const canChangeTest = (test) => canApprove || test.author_id === user.id;
  const orderedTests = qaTimelineItems(data.tests);
  const profileOptions = [...QA_ACCESS_PROFILES, ...systemProfiles.filter((profile) => !QA_EXCLUDED_PROFILES.has(profile.name)).map((profile) => [profile.name, profile.name]), ...form.validated_profiles.filter((profile) => !QA_EXCLUDED_PROFILES.has(profile)).map((profile) => [profile, profile])]
    .filter((option, index, options) => options.findIndex(([value]) => value === option[0]) === index);
  const toggleGroupValue = (field, value, checked) => setForm((current) => ({
    ...current,
    [field]: checked ? [...new Set([...current[field], value])] : current[field].filter((item) => item !== value)
  }));
  const openTest = (mode, test = null) => {
    setForm(test ? {
      status: test.status,
      environments: test.environment === 'local_nuvem' ? ['local', 'cloud'] : ['local'],
      context: test.context,
      validated_profiles: String(test.validated_profiles || '').split(',').map((profile) => profile.trim()).filter((profile) => profile && !QA_EXCLUDED_PROFILES.has(profile)),
      backend_info: test.backend_info,
      frontend_info: test.frontend_info,
      testing_notes: test.testing_notes
    } : createEmptyTest());
    setAttachmentFile(null);
    setModal({ open: true, mode, test });
  };
  const closeTest = () => {
    setModal({ open: false, mode: 'view', test: null });
    setAttachmentFile(null);
  };
  const saveTest = async () => {
    let testId = modal.test?.id;
    const payload = {
      status: form.status,
      environment: form.environments.includes('cloud') ? 'local_nuvem' : 'local',
      context: form.context,
      validated_profiles: form.validated_profiles.join(', '),
      backend_info: form.backend_info,
      frontend_info: form.frontend_info,
      testing_notes: form.testing_notes
    };
    if (modal.mode === 'create') {
      const response = await api.post(`/tasks/${task.id}/tests`, payload);
      testId = response.data.test.id;
    } else {
      await api.patch(`/tasks/${task.id}/tests/${testId}`, payload);
    }
    if (attachmentFile) {
      const body = new FormData();
      body.append('file', attachmentFile);
      body.append('test_id', testId);
      body.append('sourceSection', 'testes');
      await api.post(`/tasks/${task.id}/attachments`, body);
    }
  };
  const submitTest = async (event) => {
    event.preventDefault();
    const changed = await mutate(saveTest, modal.mode === 'create' ? 'Teste registrado.' : 'Teste atualizado.');
    if (changed) closeTest();
  };
  const removeTest = async (event, test) => {
    event.stopPropagation();
    if (!window.confirm('Remover logicamente este registro de teste?')) return;
    await mutate(() => api.delete(`/tasks/${task.id}/tests/${test.id}`), 'Teste removido logicamente.');
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Registros de teste</h3>
          {canRegisterTest && <button type="button" onClick={() => openTest('create')} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Registrar Novo Teste</button>}
        </div>
        {orderedTests.length === 0 && <p className="mt-4 rounded-md bg-slate-50 p-4 text-center text-sm text-slate-500">Nenhum teste registrado.</p>}
        {orderedTests.length > 0 && <div className="mt-4 overflow-x-auto pb-1"><CentralTimeline items={orderedTests} ariaLabel="Linha do tempo dos testes por Backend e Frontend" renderItem={(test, { sideLabel }) => (
              <article onClick={() => openTest('view', test)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openTest('view', test); }} role="button" tabIndex={0} className="w-[490px] max-w-[calc(100vw-3rem)] cursor-pointer rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${test.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{test.status === 'APPROVED' ? 'Aprovado' : 'Não Aprovado'}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{sideLabel}: {test.componentInfo}</span></div>
                {canChangeTest(test) && <div className="flex gap-1"><button type="button" onClick={(event) => { event.stopPropagation(); openTest('edit', test); }} className="rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50" aria-label="Editar teste"><Pencil className="h-4 w-4" /></button><button type="button" onClick={(event) => removeTest(event, test)} className="rounded-md p-1.5 text-red-600 hover:bg-red-50" aria-label="Excluir teste"><Trash2 className="h-4 w-4" /></button></div>}
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700">{formatShortDateTime(test.created_at)}</p>
              <p className="mt-1 text-sm text-slate-500">{test.created_by_name}</p>
              </article>
          )} /></div>}
      </section>
      <section className="max-w-xl">
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
        {data.approvals.length > 0 && <><h3 className="mt-6 font-semibold">Aprovações</h3><div className="mt-3 space-y-2">{data.approvals.map((item) => <div key={item.id} className="rounded-md border border-slate-200 p-3 text-sm"><StatusBadge value={item.decision} /><strong className="ml-2">{item.stage_name}</strong><p className="mt-1 text-slate-600">{item.notes}</p><p className="mt-1 text-xs text-slate-400">{item.created_by_name} · {formatDate(item.created_at)}</p></div>)}</div></>}
      </section>
      {modal.open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTest(); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="task-test-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-4"><h2 id="task-test-title" className="text-lg font-semibold">{modal.mode === 'create' ? 'Registrar Novo Teste' : modal.mode === 'edit' ? 'Editar Teste' : 'Detalhes do Teste'}</h2><button type="button" onClick={closeTest} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X className="h-5 w-5" /></button></div>
          <form onSubmit={submitTest} className="mt-5 space-y-4">
            <label className="block text-sm font-medium">Status<Select value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={[["APPROVED", "Aprovado"], ["NOT_APPROVED", "Não Aprovado"]]} disabled={modal.mode === 'view'} /></label>
            <CheckboxGroup legend="Ambiente" options={[["local", "Local"], ["cloud", "Nuvem"]]} values={form.environments} onChange={(value, checked) => toggleGroupValue('environments', value, checked)} disabled={modal.mode === 'view'} />
            <label className="block text-sm font-medium">Contexto<textarea required disabled={modal.mode === 'view'} rows={4} className="textarea-field mt-1 disabled:bg-slate-50" value={form.context} onChange={(event) => setForm({ ...form, context: event.target.value })} /></label>
            <CheckboxGroup legend="Perfis Validados" options={profileOptions} values={form.validated_profiles} onChange={(value, checked) => toggleGroupValue('validated_profiles', value, checked)} disabled={modal.mode === 'view'} />
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Backend<Select disabled={modal.mode === 'view'} value={form.backend_info} onChange={(value) => setForm({ ...form, backend_info: value })} options={qaComponentOptions(form.backend_info)} /></label><label className="text-sm font-medium">Frontend<Select disabled={modal.mode === 'view'} value={form.frontend_info} onChange={(value) => setForm({ ...form, frontend_info: value })} options={qaComponentOptions(form.frontend_info)} /></label></div>
            <label className="block text-sm font-medium">Testando<textarea disabled={modal.mode === 'view'} rows={5} className="textarea-field mt-1 disabled:bg-slate-50" value={form.testing_notes} onChange={(event) => setForm({ ...form, testing_notes: event.target.value })} /></label>
            {modal.test?.attachments?.length > 0 && <div><p className="text-sm font-medium">Anexos deste teste</p><div className="mt-2 space-y-2">{modal.test.attachments.map((attachment) => <AttachmentLink key={attachment.id} taskId={task.id} item={attachment} />)}</div></div>}
            {modal.mode !== 'view' && <label className="block rounded-lg border-2 border-dashed border-slate-300 p-4 text-sm font-medium">Anexo do teste<input type="file" onChange={(event) => setAttachmentFile(event.target.files[0] || null)} className="mt-2 block w-full text-xs" /></label>}
            <div className="flex justify-end gap-2"><button type="button" onClick={closeTest} className="btn-secondary">{modal.mode === 'view' ? 'Fechar' : 'Cancelar'}</button>{modal.mode !== 'view' && <button disabled={form.environments.length === 0 || form.validated_profiles.length === 0} className="btn-primary"><Save className="mr-2 h-4 w-4" />Salvar teste</button>}</div>
          </form>
        </div>
      </div>}
    </div>
  );
}

function Github({ data, user, mutate, saving }) {
  const { task } = data;
  const emptyGithub = { technical_area: 'BACKEND', repository_url: '', branch: '', commit_sha: '', pull_request_url: '', release: '', file_name: '', language: 'auto', code_content: '', explanation: '' };
  const [form, setForm] = useState(emptyGithub);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const [expanded, setExpanded] = useState('');
  const [formError, setFormError] = useState('');
  const dialogRef = useRef(null);
  const lastTrigger = useRef(null);
  const codeEditorRef = useRef(null);
  const editorTheme = useEditorTheme();
  const canEdit = user.permissions?.includes('tasks.manage') || user.profiles?.includes('MANAGER')
      || (task.responsibility === 'ANY' && user.permissions?.includes('tasks.operate'))
      || (task.responsibility === 'BACKEND_ASSIGNEE' && user.id === task.backend_assignee_id)
      || (task.responsibility === 'FRONTEND_ASSIGNEE' && user.id === task.frontend_assignee_id);
  const canDelete = user.permissions?.includes('tasks.manage');
  const cards = data.github_cards || (data.github ? [data.github] : []);
  const timelineCards = githubTimelineItems(cards);
  const normalizeCard = (card) => ({ ...emptyGithub, ...card, language: card.language || 'plaintext', repository_url: card.repository_url || '', branch: card.branch || '', commit_sha: card.commit_sha || '', pull_request_url: card.pull_request_url || '', release: card.release || '', file_name: card.file_name || '', code_content: card.code_content || '', explanation: card.explanation || card.notes_code || '' });
  const effectiveLanguage = resolveCodeLanguage(form.file_name, form.language);
  const close = () => { codeEditorRef.current = null; setOpen(false); setFormError(''); window.setTimeout(() => lastTrigger.current?.focus(), 0); };
  const show = (event, card = null) => {
    lastTrigger.current = event.currentTarget;
    codeEditorRef.current = null;
    setForm(card ? normalizeCard(card) : emptyGithub);
    setFormError('');
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const focusable = () => [...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])')];
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [open]);
  const save = async (event) => {
    event.preventDefault();
    const codeContent = codeEditorRef.current?.getValue() ?? form.code_content;
    if (!codeContent.trim()) { setFormError('Informe o codigo da anotacao.'); return; }
    if (new TextEncoder().encode(codeContent).byteLength > 200000) { setFormError('O codigo excede o limite de 200 KB.'); return; }
    setFormError('');
    const payload = { technical_area: form.technical_area, repository_url: form.repository_url || null, branch: form.branch || null, commit_sha: form.commit_sha || null, pull_request_url: form.pull_request_url || null, release: form.release || null, file_name: form.file_name || null, language: effectiveLanguage, code_content: codeContent, explanation: form.explanation || null };
    const saved = await mutate(() => form.id ? api.patch(`/tasks/${task.id}/github/${form.id}`, payload) : api.post(`/tasks/${task.id}/github`, payload), form.id ? 'Registro GitHub atualizado.' : 'Registro GitHub adicionado.');
    if (saved) close();
  };
  const copyCode = async (event, card) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(card.code_content || '');
      setCopied(card.id);
    } catch {
      setCopied(`error:${card.id}`);
    }
    window.setTimeout(() => setCopied(''), 1800);
  };
  const remove = async (event, card) => {
    event.stopPropagation();
    if (!window.confirm(`Remover logicamente a anotacao ${card.file_name || card.title || ''}?`)) return;
    await mutate(() => api.delete(`/tasks/${task.id}/github/${card.id}`), 'Registro GitHub removido.');
  };
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800"><span>Os vinculos tecnicos sao registrados manualmente e preservados no dossie da tarefa.</span>{canEdit && <button type="button" onClick={(event) => show(event)} className="btn-primary"><Plus className="mr-2 h-4 w-4" />Adicionar anotacao</button>}</div>
      {cards.length === 0 ? <p className="rounded-md bg-slate-50 p-5 text-center text-sm text-slate-500">Nenhum registro GitHub.</p> : <CentralTimeline items={timelineCards} ariaLabel="Linha do tempo GitHub por Backend e Frontend" renderItem={(card, { sideLabel }) => <article className="w-[490px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3"><div className="min-w-0"><p className="flex items-center gap-2 truncate text-sm font-semibold"><FileCode2 className="h-4 w-4 text-indigo-600" />{card.file_name || card.title || 'Trecho sem arquivo'}</p><p className="mt-1 text-xs text-slate-500">{codeLanguageLabel(card.language)} · {card.author_name || 'Autor nao identificado'} · {formatDate(card.created_at || card.updated_at)}</p><p className="mt-1 text-xs text-slate-500">Etapa na criacao: {card.stage_name || 'Nao registrada'} · Etapa atual: {task.stage_name}</p></div><div className="flex flex-wrap items-center gap-2">{card.code_content && <button type="button" onClick={(event) => copyCode(event, card)} className="btn-secondary h-8 px-3 text-xs"><Copy className="mr-1.5 h-3.5 w-3.5" />{copied === card.id ? 'Codigo copiado' : copied === `error:${card.id}` ? 'Falha ao copiar' : 'Copiar codigo'}</button>}{card.code_content && <button type="button" aria-expanded={expanded === card.id} onClick={() => setExpanded(expanded === card.id ? '' : card.id)} className="btn-secondary h-8 px-3 text-xs">{expanded === card.id ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}{expanded === card.id ? 'Recolher' : 'Visualizar codigo'}</button>}{canEdit && <button type="button" onClick={(event) => show(event, card)} className="btn-secondary h-8 px-3 text-xs"><Pencil className="mr-1 h-3.5 w-3.5" />Editar</button>}{canDelete && <button type="button" disabled={saving} onClick={(event) => remove(event, card)} className="btn-danger h-8 px-3 text-xs"><Trash2 className="mr-1 h-3.5 w-3.5" />Excluir</button>}</div></header>
        <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-500">Área técnica: {sideLabel}</p>
        {card.code_content && expanded === card.id && <div className="border-b border-slate-200"><MonacoEditor height="240px" language={card.language || 'plaintext'} value={card.code_content} readOnly theme={editorTheme} options={{ overviewRulerLanes: 0 }} /></div>}
        {card.explanation && <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-6 text-slate-700">{card.explanation}</p>}
        {(card.repository_url || card.branch || card.commit_sha) && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{card.repository_url || 'Repositorio nao informado'}{card.branch ? ` · ${card.branch}` : ''}{card.commit_sha ? ` · ${card.commit_sha}` : ''}</p>}
      </article>} />}
      {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="github-dialog-title" className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3"><h2 id="github-dialog-title" className="text-lg font-semibold">{form.id ? 'Editar anotacao GitHub' : 'Adicionar anotacao GitHub'}</h2><button type="button" onClick={close} aria-label="Fechar" className="rounded-md p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
          <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium sm:col-span-2">Área técnica<select className="field mt-1 sm:max-w-xs" value={form.technical_area} onChange={(event) => setForm({ ...form, technical_area: event.target.value })}><option value="BACKEND">Backend</option><option value="FRONTEND">Frontend</option><option value="BOTH">Backend e Frontend</option></select></label>
            <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2 sm:items-end">
              <Input label="Nome ou caminho do arquivo" value={form.file_name} onChange={(fileName) => setForm({ ...form, file_name: fileName })} placeholder="backend/services/autenticacao.pas" maxLength={500} />
              <label className="text-sm font-medium">Linguagem<select className="field mt-1" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>{CODE_LANGUAGES.map(([value, text]) => <option key={value} value={value}>{value === 'auto' ? `${text} — ${codeLanguageLabel(effectiveLanguage)} detectado` : text}</option>)}</select></label>
            </div>
            <div className="sm:col-span-2"><p className="text-sm font-medium">Codigo <span className="text-red-600">*</span></p><MonacoEditor height="400px" minHeight="400px" wrapperClassName="mt-1" language={effectiveLanguage} value={form.code_content} onMount={(editor) => { codeEditorRef.current = editor; }} readOnly={!canEdit} theme={editorTheme} ariaLabel="Codigo da anotacao" /><span className="mt-1 block text-xs text-slate-500">Linguagem ativa: {codeLanguageLabel(effectiveLanguage)} · limite de 200 KB.</span></div>
            <label className="text-sm font-medium sm:col-span-2">Explicacao tecnica<textarea rows={6} value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} readOnly={!canEdit} className="textarea-field mt-1" maxLength="50000" placeholder="Contexto, motivo e impacto deste trecho." /></label>
            {formError && <p role="alert" className="sm:col-span-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
            <div className="sm:col-span-2"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Vinculos opcionais</p><div className="grid gap-4 sm:grid-cols-2"><Input label="Link do repositorio" type="url" value={form.repository_url} onChange={(value) => setForm({ ...form, repository_url: value })} className="sm:col-span-2" />
            <Input label="Branch" value={form.branch} onChange={(value) => setForm({ ...form, branch: value })} />
            <Input label="Commit" value={form.commit_sha} onChange={(value) => setForm({ ...form, commit_sha: value })} />
            <Input label="Pull Request" type="url" value={form.pull_request_url} onChange={(value) => setForm({ ...form, pull_request_url: value })} />
            <Input label="Release" value={form.release} onChange={(value) => setForm({ ...form, release: value })} />
            </div></div>
            <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={close} className="btn-secondary">Cancelar</button>{canEdit && <button disabled={saving} className="btn-primary">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar anotacao</button>}</div>
          </form>
        </div>
      </div>}
    </div>
  );
}

function Attachments({ data, user, mutate }) {
  const [file, setFile] = useState(null);
  const [description, setDescription] = useState('');
  const [sourceSection, setSourceSection] = useState('backend');
  const upload = () => {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    body.append('description', description);
    body.append('sourceSection', sourceSection);
    mutate(() => api.post(`/tasks/${data.task.id}/attachments`, body), 'Anexo incluído.');
    setFile(null);
    setDescription('');
  };
  return (
    <div className="space-y-5">
      <div className="rounded-lg border-2 border-dashed border-slate-300 p-5 text-center">
        <Upload className="mx-auto h-7 w-7 text-slate-400" />
        <input type="file" onChange={(e) => setFile(e.target.files[0] || null)} className="mt-3 text-sm" />
        <div className="mx-auto mt-3 grid max-w-md gap-3 sm:grid-cols-2"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição opcional" className="field" /><label className="sr-only" htmlFor="attachment-source">Origem técnica</label><select id="attachment-source" value={sourceSection} onChange={(event) => setSourceSection(event.target.value)} className="field"><option value="backend">Backend</option><option value="frontend">Frontend</option><option value="geral">Geral</option></select></div>
        <div><button type="button" disabled={!file} onClick={upload} className="btn-primary mt-3">Enviar anexo</button></div>
      </div>
      <div className="overflow-x-auto pb-1"><CentralTimeline items={attachmentTimelineItems(data.attachments)} ariaLabel="Linha do tempo dos anexos por Backend e Frontend" renderItem={(item) => (
          <article className="flex h-[171px] w-[490px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <AttachmentPreview taskId={data.task.id} item={item} />
            <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="whitespace-nowrap text-sm font-semibold text-slate-700">{formatShortDateTime(item.created_at)}</p><p className="truncate text-xs text-slate-500">{item.created_by_name}</p></div><div className="flex shrink-0 gap-1">
              <a href={`${api.defaults.baseURL}/tasks/${data.task.id}/attachments/${item.id}`} download={item.original_name} className="rounded-md p-2.5 text-indigo-600 hover:bg-indigo-50" title="Baixar"><Download className="h-5 w-5" /></a>
              {user.access_level === 'ADMIN' && <button onClick={() => mutate(() => api.delete(`/tasks/${data.task.id}/attachments/${item.id}`), 'Anexo removido logicamente.')} className="rounded-md p-2.5 text-red-600 hover:bg-red-50" title="Remover"><XCircle className="h-5 w-5" /></button>}
              </div></div>
              <span className="w-fit max-w-full truncate rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">Anexado em: {attachmentSourceLabel(item.source_section)}</span>
              <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{item.original_name}</p><p className="truncate text-xs text-slate-500">{Math.ceil(item.size_bytes / 1024)} KB{item.description ? ` · ${item.description}` : ''}</p></div>
            </div>
          </article>
        )} /></div>
    </div>
  );
}

function Comments({ data, mutate }) {
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  const sendComment = async () => {
    const response = await api.post(`/tasks/${data.task.id}/comments`, { content });
    if (file) {
      const body = new FormData();
      body.append('file', file);
      body.append('comment_id', response.data.comment.id);
      body.append('sourceSection', 'comentarios');
      await api.post(`/tasks/${data.task.id}/attachments`, body);
    }
  };
  return (
    <div className="mx-auto max-w-3xl">
      <div className="space-y-3 rounded-xl bg-slate-50 p-4">
        {data.comments.length === 0 && <p className="rounded-md bg-slate-50 p-5 text-center text-sm text-slate-500">Nenhum comentário.</p>}
        {data.comments.map((item) => <div key={item.id} className="max-w-[85%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="flex justify-between gap-5"><strong className="text-sm text-indigo-700">{item.created_by_name}</strong><span className="text-xs text-slate-400">{formatDate(item.created_at)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{item.content}</p>{item.attachments?.map((attachment) => <AttachmentLink key={attachment.id} taskId={data.task.id} item={attachment} />)}</div>)}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); mutate(sendComment, 'Comentário registrado.'); setContent(''); setFile(null); }} className="mt-5 flex items-end gap-3">
        <div className="flex-1"><textarea required rows={1} value={content} onChange={(event) => { setContent(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`; }} placeholder="Escreva um comentário..." className="textarea-field min-h-10 resize-none py-2" /><label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-slate-500"><Paperclip className="h-4 w-4" /><input type="file" onChange={(event) => setFile(event.target.files[0] || null)} className="sr-only" />{file ? file.name : 'Anexar arquivo'}</label></div>
        <button className="btn-primary h-auto px-4"><Send className="h-4 w-4" /><span className="sr-only">Enviar</span></button>
      </form>
    </div>
  );
}

function AttachmentLink({ taskId, item }) {
  const url = `${api.defaults.baseURL}/tasks/${taskId}/attachments/${item.id}`;
  if (isImageAttachment(item)) return <a href={url} target="_blank" rel="noreferrer" className="mt-2 block w-fit"><img src={url} alt={item.original_name} loading="lazy" className="h-20 w-28 rounded-md border border-slate-200 object-cover" /></a>;
  if (isVideoAttachment(item)) return <video src={url} controls preload="metadata" className="mt-2 max-h-48 w-full max-w-sm rounded-md border border-slate-200">Seu navegador nao suporta video.</video>;
  const Icon = attachmentIcon(item);
  return <a href={url} className="mt-2 flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"><Icon className="h-3.5 w-3.5" />{item.original_name}</a>;
}

function formatShortDateTime(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function attachmentSourceLabel(source) {
  return ({ geral: 'Geral', backend: 'Backend', frontend: 'Frontend', testes: 'Testes', github: 'GitHub', comentarios: 'Comentários' })[source] || 'Geral';
}

function attachmentExtension(item) {
  return String(item.original_name || '').toLowerCase().match(/\.[^.]+$/u)?.[0] || '';
}

function isImageAttachment(item) {
  return String(item.mime_type || '').startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(attachmentExtension(item));
}

function isVideoAttachment(item) {
  return String(item.mime_type || '').startsWith('video/') || ['.mp4', '.webm'].includes(attachmentExtension(item));
}

function attachmentIcon(item) {
  const extension = attachmentExtension(item);
  if (isVideoAttachment(item)) return FileVideo2;
  if (['.zip', '.7z', '.rar', '.tar', '.gz'].includes(extension)) return FileArchive;
  if (['.xls', '.xlsx'].includes(extension)) return FileSpreadsheet;
  if (['.pdf', '.doc', '.docx', '.txt', '.md'].includes(extension)) return FileText;
  if (['.js', '.jsx', '.ts', '.tsx', '.json', '.sql'].includes(extension)) return FileCode2;
  return File;
}

function AttachmentPreview({ taskId, item }) {
  const url = `${api.defaults.baseURL}/tasks/${taskId}/attachments/${item.id}`;
  if (isImageAttachment(item)) {
    return <a href={url} target="_blank" rel="noreferrer" title="Abrir imagem em tamanho completo" className="block h-full w-36 shrink-0 bg-slate-100"><img src={url} alt={item.original_name} loading="lazy" className="h-full w-full object-cover" /></a>;
  }
  if (isVideoAttachment(item)) {
    return <video src={url} controls preload="metadata" className="h-full w-36 shrink-0 bg-slate-950 object-cover">Seu navegador nao suporta video.</video>;
  }
  const Icon = attachmentIcon(item);
  return <a href={url} target="_blank" rel="noreferrer" className="flex h-full w-36 shrink-0 items-center justify-center bg-slate-50 text-slate-500" title={`Abrir ${item.original_name}`}><Icon className="h-14 w-14" aria-hidden="true" /></a>;
}

function History({ events, timerEvents = [] }) {
  const combined = historyTimelineItems(events, timerEvents);
  return (
    <CentralTimeline items={combined} alternate ariaLabel="Linha do tempo histórica alternada em ordem cronológica" renderItem={(event) => <article className="w-[490px] max-w-[calc(100vw-3rem)] rounded-md border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{event.event_type}</strong><span className="text-xs text-slate-400">{formatDate(event.created_at)}</span></div><p className="mt-1 text-sm text-slate-600">{event.isTimerEvent ? `${event.previous_status || '—'} → ${event.new_status || '—'} · ativo ${formatSignedDuration(event.active_elapsed_seconds)}` : event.description}</p><p className="mt-2 text-xs text-slate-400">por {event.actor_name}</p></article>} />
  );
}

function CheckboxGroup({ legend, options, values, onChange, disabled = false }) {
  return <fieldset><legend className="text-sm font-medium">{legend}</legend><div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">{options.map(([value, text]) => <label key={value} className={`flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm ${disabled ? 'cursor-default text-slate-500' : 'cursor-pointer hover:border-indigo-300'}`}><input type="checkbox" checked={values.includes(value)} disabled={disabled} onChange={(event) => onChange(value, event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />{text}</label>)}</div>{values.length === 0 && !disabled && <p className="mt-1 text-xs text-amber-700">Selecione pelo menos uma opção.</p>}</fieldset>;
}

function qaComponentOptions(currentValue) {
  if (!currentValue || QA_COMPONENT_OPTIONS.some(([value]) => value === currentValue)) return QA_COMPONENT_OPTIONS;
  return [[currentValue, currentValue], ...QA_COMPONENT_OPTIONS];
}

function Select({ value, onChange, options, ...props }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="field" {...props}>{options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}</select>;
}
function MonacoEditor(props) {
  return <Suspense fallback={<div className="flex h-full min-h-40 items-center justify-center bg-slate-950 text-sm text-slate-300"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando editor...</div>}><CodeEditor {...props} /></Suspense>;
}
function Input({ label: inputLabel, value, onChange, className = '', ...props }) {
  return <label className={`text-sm font-medium ${className}`}>{inputLabel}<input value={value} onChange={(e) => onChange(e.target.value)} className="field mt-1" {...props} /></label>;
}
