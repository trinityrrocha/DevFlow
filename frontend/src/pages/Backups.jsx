import { useCallback, useEffect, useState } from 'react';
import { Archive, CheckCircle2, Download, Loader2, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import api, { errorMessage } from '../services/api';

const terminal = new Set(['completed', 'failed']);
const size = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const date = (value) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function Backups() {
  const [catalog, setCatalog] = useState(null);
  const [operation, setOperation] = useState(null);
  const [message, setMessage] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const load = useCallback(async () => {
    try { setCatalog((await api.get('/operations/backups')).data); }
    catch (error) { setMessage({ type: 'error', text: errorMessage(error) }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!operation?.id || terminal.has(operation.state)) return undefined;
    let disposed = false;
    const poll = async () => {
      try {
        const { data } = await api.get(`/operations/backups/requests/${operation.id}`, { timeout: 5000 });
        if (disposed) return;
        setOperation(data);
        if (data.status === 'completed') {
          setMessage({ type: 'success', text: data.message });
          await load();
        } else if (data.status === 'failed') setMessage({ type: 'error', text: data.error || 'A operacao falhou. Consulte os logs.' });
      } catch {
        if (operation.operation === 'restore-backup') {
          try {
            const response = await api.get('/health', { timeout: 3000 });
            if (response.status === 200) window.location.reload();
          } catch { /* restore keeps the application in maintenance */ }
        }
      }
    };
    const interval = window.setInterval(poll, 4000);
    poll();
    return () => { disposed = true; window.clearInterval(interval); };
  }, [operation?.id, operation?.state, operation?.operation, load]);

  const queue = async (method, url, data) => {
    setMessage(null);
    try {
      const response = await api({ method, url, data });
      setOperation({ ...response.data, state: 'pending' });
      setConfirmation(null);
    } catch (error) { setMessage({ type: 'error', text: errorMessage(error) }); }
  };
  const busy = operation?.id && !terminal.has(operation.state);
  const operationLabel = { 'create-backup': 'Criando backup...', 'verify-backup': 'Verificando...', 'restore-backup': 'Restaurando...', 'delete-backup': 'Excluindo...' }[operation?.operation];

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Backups do DevFlow</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Retencao automatica: {catalog?.retentionDays ?? 30} dias</p></div><button type="button" className="btn-primary" disabled={busy} onClick={() => queue('post', '/operations/backups')}><Plus className="mr-2 h-4 w-4" />Criar backup</button></header>
    {message && <div role="alert" className={`rounded-lg border p-3 text-sm ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>{message.text}</div>}
    {busy && <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"><Loader2 className="h-4 w-4 animate-spin" />{operationLabel || operation.message}</div>}
    <section className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Versao</th><th className="px-4 py-3">Migration</th><th className="px-4 py-3">Tamanho</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Acoes</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{catalog?.backups?.map((backup) => <BackupRow key={backup.id} backup={backup} busy={busy} queue={queue} setConfirmation={setConfirmation} />)}</tbody></table>{catalog && catalog.backups.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Nenhum backup encontrado.</p>}{!catalog && <p className="p-8 text-center text-sm text-slate-500">Carregando backups...</p>}</div></section>
    {confirmation && <ConfirmationModal value={confirmation} close={() => setConfirmation(null)} confirm={(typed) => confirmation.type === 'restore' ? queue('post', `/operations/backups/${confirmation.backup.id}/restore`, { confirmation: typed }) : queue('delete', `/operations/backups/${confirmation.backup.id}`, { confirmation: typed })} />}
  </div>;
}

function BackupRow({ backup, busy, queue, setConfirmation }) {
  return <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50"><td className="px-4 py-4"><div className="flex items-center gap-2"><Archive className="h-4 w-4 text-indigo-500" />{date(backup.createdAt)}</div><p className="mt-1 max-w-52 truncate text-xs text-slate-400" title={backup.filename}>{backup.filename}</p></td><td className="px-4 py-4">{backup.applicationVersion || '—'}</td><td className="px-4 py-4">{backup.databaseMigration || '—'}</td><td className="px-4 py-4">{size(backup.sizeBytes)}</td><td className="px-4 py-4"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${backup.status === 'verified' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{backup.status === 'verified' && <CheckCircle2 className="h-3 w-3" />}{backup.status === 'verified' ? 'Verificado' : 'Disponivel'}</span></td><td className="px-4 py-4"><div className="flex justify-end gap-2"><a className="btn-secondary px-3" href={`${api.defaults.baseURL}/operations/backups/${backup.id}/download`} download={backup.filename}><Download className="mr-1 h-4 w-4" />Download</a><button type="button" className="btn-secondary px-3" disabled={busy} onClick={() => queue('post', `/operations/backups/${backup.id}/verify`)}><RefreshCw className="mr-1 h-4 w-4" />Verificar</button><button type="button" className="btn-secondary px-3" disabled={busy} onClick={() => setConfirmation({ type: 'restore', backup })}><RotateCcw className="mr-1 h-4 w-4" />Restaurar</button><button type="button" className="rounded-md p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" aria-label={`Excluir ${backup.filename}`} disabled={busy} onClick={() => setConfirmation({ type: 'delete', backup })}><Trash2 className="h-4 w-4" /></button></div></td></tr>;
}

function ConfirmationModal({ value, close, confirm }) {
  const [typed, setTyped] = useState('');
  const restore = value.type === 'restore';
  const required = restore ? 'RESTAURAR' : 'EXCLUIR';
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900"><h2 className="text-lg font-bold text-red-700 dark:text-red-400">ATENCAO</h2><p className="mt-3 text-sm text-slate-700 dark:text-slate-300">{restore ? 'A restauracao substituira os dados atuais do DevFlow pelos dados presentes no backup selecionado. A aplicacao ficara temporariamente indisponivel.' : 'Este backup sera excluido permanentemente.'}</p><p className="mt-4 text-sm">Digite <strong>{required}</strong> para continuar.</p><input autoFocus className="field mt-2" value={typed} onChange={(event) => setTyped(event.target.value)} /><div className="mt-5 flex justify-end gap-3"><button type="button" className="btn-secondary" onClick={close}>Cancelar</button><button type="button" className="btn-primary bg-red-600 hover:bg-red-700" disabled={typed !== required} onClick={() => confirm(typed)}>{restore ? 'Restaurar backup' : 'Excluir backup'}</button></div></div></div>;
}
