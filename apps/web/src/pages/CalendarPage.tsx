import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addMonthsBs, bsToAd, daysInBsMonth, todayBs, weekdayOfAd } from '@karsathi/shared';
import { api } from '../lib/api';
import { monthName, num, type Lang } from '../lib/format';
import { PageTitle } from '../components/ui';

const WEEKDAYS = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ne: ['आइत', 'सोम', 'मङ्गल', 'बुध', 'बिहि', 'शुक्र', 'शनि'] };
const DOT: Record<string, string> = { pending: 'bg-amber-500', docs_received: 'bg-blue-500', filed: 'bg-green-500', missed: 'bg-red-500' };

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const now = todayBs();
  const [ym, setYm] = useState({ year: now.year, month: now.month });
  const days = daysInBsMonth(ym.year, ym.month);
  const fromAd = bsToAd({ ...ym, day: 1 });
  const toAd = bsToAd({ ...ym, day: days });
  const tasks = useQuery({ queryKey: ['tasks', 'cal', fromAd], queryFn: () => api<any[]>(`/tasks?fromAd=${fromAd}&toAd=${toAd}`) });

  const byDay = new Map<string, any[]>();
  for (const x of tasks.data ?? []) byDay.set(x.dueDateBs, [...(byDay.get(x.dueDateBs) ?? []), x]);
  const lead = weekdayOfAd(fromAd);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  return (
    <div>
      <PageTitle actions={<>
        <button className="btn-secondary" onClick={() => setYm(addMonthsBs(ym.year, ym.month, -1))}>{t('calendar.prev')}</button>
        <button className="btn-secondary" onClick={() => setYm({ year: now.year, month: now.month })}>{t('calendar.today')}</button>
        <button className="btn-secondary" onClick={() => setYm(addMonthsBs(ym.year, ym.month, 1))}>{t('calendar.next')}</button>
      </>}>
        {monthName(ym.month, lang)} {num(ym.year, lang)}
        <span className="ml-2 text-sm font-normal text-slate-400">{new Date(fromAd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })} – {new Date(toAd).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>
      </PageTitle>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-slate-50">
          {WEEKDAYS[lang].map((d, i) => <div key={d} className={`p-2 text-center text-xs font-semibold ${i === 6 ? 'text-red-600' : 'text-slate-500'}`}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (!day) return <div key={i} className="min-h-24 border-b border-r bg-slate-50/50" />;
            const bs = `${ym.year}-${String(ym.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const ad = bsToAd({ ...ym, day });
            const list = byDay.get(bs) ?? [];
            const isToday = ym.year === now.year && ym.month === now.month && day === now.day;
            return (
              <div key={i} className={`min-h-24 border-b border-r p-1 ${isToday ? 'bg-brand-50' : ''}`}>
                <div className="flex items-baseline justify-between">
                  <span className={`text-sm font-semibold ${i % 7 === 6 ? 'text-red-600' : ''}`}>{num(day, lang)}</span>
                  <span className="text-[10px] text-slate-400">{Number(ad.slice(8))}/{Number(ad.slice(5, 7))}</span>
                </div>
                {list.length > 0 && (
                  <Link to={`/tasks`} className="mt-1 block space-y-0.5">
                    {Object.entries(groupByRule(list, lang)).slice(0, 3).map(([rule, items]) => (
                      <div key={rule} className="flex items-center gap-1 truncate text-[11px]">
                        <span className={`inline-block h-2 w-2 rounded-full ${DOT[worst(items)]}`} />
                        <span className="truncate">{rule}</span>
                        <span className="text-slate-500">×{items.length}</span>
                      </div>
                    ))}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        {Object.entries(DOT).map(([s, c]) => <span key={s} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${c}`} />{t(`status.${s}`)}</span>)}
      </div>
    </div>
  );
}

function groupByRule(list: any[], lang: Lang) {
  const out: Record<string, any[]> = {};
  for (const x of list) (out[x.ruleName?.[lang] ?? x.ruleId] ??= []).push(x);
  return out;
}

function worst(items: any[]) {
  for (const s of ['missed', 'pending', 'docs_received', 'filed']) if (items.some((x) => x.status === s)) return s;
  return 'pending';
}
