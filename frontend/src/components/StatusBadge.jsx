import { label } from '../utils/formatters';

const colors = {
  ACTIVE: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  COMPLETED: 'bg-green-50 text-green-700 border-green-200',
  PAUSED: 'bg-amber-50 text-amber-800 border-amber-200',
  CANCELED: 'bg-red-50 text-red-700 border-red-200',
  INACTIVE: 'bg-red-50 text-red-700 border-red-200',
  BUG: 'bg-red-50 text-red-700 border-red-200',
  REQUEST: 'bg-slate-50 text-slate-700 border-slate-200',
  LOW: 'bg-slate-50 text-slate-600 border-slate-200',
  MEDIUM: 'bg-blue-50 text-blue-700 border-blue-200',
  HIGH: 'bg-amber-50 text-amber-800 border-amber-200',
  CRITICAL: 'bg-red-50 text-red-700 border-red-200',
  URGENT_PRODUCTION: 'bg-red-600 text-white border-red-600'
};

export default function StatusBadge({ value }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colors[value] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
      {label(value)}
    </span>
  );
}
