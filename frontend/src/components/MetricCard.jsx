export default function MetricCard({ title, value, icon: Icon, tone = 'indigo', subtitle, onClick }) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-100 text-slate-600'
  };
  return (
    <article className={`card p-5 ${onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md' : ''}`} onClick={onClick} onKeyDown={(event) => { if (onClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } }} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} aria-label={onClick ? `${title}: ${value}. Abrir detalhes` : undefined}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {Icon && <span className={`rounded-lg p-2.5 ${tones[tone]}`}><Icon className="h-5 w-5" /></span>}
      </div>
    </article>
  );
}
