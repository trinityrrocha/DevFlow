export default function CentralTimeline({ items, ariaLabel, renderItem, alternate = false }) {
  return (
    <ol className="relative mx-auto max-w-[1040px] space-y-5 md:space-y-0 md:before:absolute md:before:bottom-0 md:before:left-1/2 md:before:top-0 md:before:w-px md:before:-translate-x-1/2 md:before:bg-slate-200 dark:md:before:bg-slate-700" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const side = alternate ? (index % 2 === 0 ? 'left' : 'right') : item.side;
        const isBackend = side === 'backend';
        const isFrontend = side === 'frontend';
        const isLeft = isBackend || side === 'left' || (side === 'neutral' && index % 2 === 0);
        const sideLabel = alternate ? '' : isBackend ? 'Backend' : isFrontend ? 'Frontend' : 'Geral';
        return (
          <li key={item.timelineId || item.id} data-timeline-side={side} className="relative grid min-w-0 md:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] md:items-start md:pb-6 md:last:pb-0">
            {!alternate ? <span className={`mb-2 inline-flex w-fit items-center rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide md:hidden ${isBackend ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' : isFrontend ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{sideLabel}</span> : null}
            <div className={`${isLeft ? 'md:col-start-1 md:justify-self-end' : 'md:col-start-3 md:justify-self-start'} min-w-0 max-w-full`}>
              {renderItem(item, { side, sideLabel, index })}
            </div>
            <div className="absolute left-1/2 top-5 hidden -translate-x-1/2 md:block" aria-hidden="true">
              <span className={`block h-4 w-4 rounded-full border-2 border-white shadow-sm dark:border-slate-900 ${item.markerClass || (isBackend ? 'bg-blue-500' : isFrontend ? 'bg-violet-500' : 'bg-slate-500')}`} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
