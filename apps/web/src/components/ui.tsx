import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { bsLong, adShort, daysUntil, type Lang } from '../lib/format';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    docs_received: 'bg-blue-100 text-blue-800',
    filed: 'bg-green-100 text-green-800',
    missed: 'bg-red-100 text-red-800',
  };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls[status] ?? 'bg-slate-100'}`}>{t(`status.${status}`)}</span>;
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
  const cls = d < 0 ? 'text-red-600' : d <= 2 ? 'text-orange-600' : d <= 7 ? 'text-amber-600' : 'text-slate-500';
  const label = d < 0 ? t('today.overdue', { n: -d }) : d === 0 ? t('today.dueToday') : t('today.daysLeft', { n: d });
  return <span className={`text-xs font-medium ${cls}`}>{label}</span>;
}

export function urgencyRowClass(dueAd: string, status: string) {
  if (status === 'missed') return 'border-l-4 border-l-red-500';
  if (status === 'filed') return 'border-l-4 border-l-green-500';
  if (status === 'docs_received') return 'border-l-4 border-l-blue-500';
  const d = daysUntil(dueAd);
  return d <= 2 ? 'border-l-4 border-l-orange-500' : d <= 7 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-slate-200';
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className={`card mt-10 w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className={`card p-4 ${tone}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="mt-1 text-sm">{label}</div>
    </div>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{children}</h1>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded bg-red-50 p-2 text-sm text-red-700">{(error as Error).message}</p>;
}
