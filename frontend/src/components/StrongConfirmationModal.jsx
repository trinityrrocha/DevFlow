import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function StrongConfirmationModal({ title, message, confirmationText, actionLabel, busy = false, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('');
  useEffect(() => { setTyped(''); }, [confirmationText]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-labelledby="strong-confirmation-title">
    <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900">
      <h2 id="strong-confirmation-title" className="flex items-center gap-2 text-lg font-bold text-red-700 dark:text-red-400"><AlertTriangle className="h-5 w-5" />{title}</h2>
      <p className="mt-3 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{message}</p>
      <label className="mt-4 block text-sm font-medium">Digite <strong>{confirmationText}</strong> para continuar.<input autoFocus className="field mt-2" value={typed} onChange={(event) => setTyped(event.target.value)} /></label>
      <div className="mt-5 flex justify-end gap-3"><button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancelar</button><button type="button" className="btn-danger" disabled={busy || typed !== confirmationText} onClick={() => onConfirm(typed)}>{actionLabel}</button></div>
    </div>
  </div>;
}
