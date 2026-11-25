import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { bsLong, adShort, daysUntil, type Lang } from '../lib/format';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls: Record<string, [string, string]> = {
    pending: ['bg-amber-50 text-amber-800', 'bg-amber-500'],
    docs_received: ['bg-brand-50 text-brand-700', 'bg-brand-500'],
    filed: ['bg-emerald-50 text-emerald-800', 'bg-emerald-500'],
    missed: ['bg-seal-50 text-seal-600', 'bg-seal-500'],
  };
  const [pill, dot] = cls[status] ?? ['bg-slate-100 text-slate-700', 'bg-slate-400'];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {t(`status.${status}`)}
    </span>
  );
}

/** BS primary, AD secondary. */
export function DateBs({ bs, ad }: { bs: string; ad?: string | Date }) {
  const { i18n } = useTranslation();
  return (
    <span className="whitespace-nowrap">
      {bsLong(bs, i18n.language as Lang)}
      {ad && <span className="ml-1 text-xs text-slate-400">({adShort(ad)})</span>}
    </span>
  );
}

export function Urgency({ dueAd, status }: { dueAd: string; status: string }) {
  const { t } = useTranslation();
  if (status === 'filed') return null;
  const d = daysUntil(dueAd);
  const cls = d < 0 ? 'text-seal-500' : d <= 2 ? 'text-orange-600' : d <= 7 ? 'text-amber-700' : 'text-slate-500';
  const label = d < 0 ? t('today.overdue', { n: -d }) : d === 0 ? t('today.dueToday') : t('today.daysLeft', { n: d });
  return <span className={`text-xs font-medium ${cls}`}>{label}</span>;
}

export function urgencyRowClass(dueAd: string, status: string) {
  if (status === 'missed') return 'border-l-4 border-l-seal-500';
  if (status === 'filed') return 'border-l-4 border-l-emerald-500';
  if (status === 'docs_received') return 'border-l-4 border-l-brand-500';
  const d = daysUntil(dueAd);
  return d <= 2 ? 'border-l-4 border-l-orange-500' : d <= 7 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-transparent';
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card mt-10 w-full shadow-xl ${wide ? 'max-w-4xl' : 'max-w-lg'} p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink-900"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** One ledger-style totals row instead of a grid of identical stat cards. */
export function Tally({ items }: { items: { label: string; value: string; alert?: boolean }[] }) {
  return (
    <dl className="card grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-slate-200">
      {items.map((i) => (
        <div key={i.label} className="px-5 py-4">
          <dt className="text-sm text-slate-500">{i.label}</dt>
          <dd className={`mt-0.5 text-3xl font-semibold tabular-nums ${i.alert ? 'text-seal-500' : 'text-ink-900'}`}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{children}</h1>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-md bg-seal-50 p-2 text-sm text-seal-600">{(error as Error).message}</p>;
}
