import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { num, type Lang } from '../lib/format';
import { DateBs, PageTitle, Stat, StatusBadge, Urgency, urgencyRowClass } from '../components/ui';
import { TaskActions } from './TasksPage';

export default function TodayPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/tasks/dashboard'), refetchInterval: 30_000 });
  if (isLoading || !data) return <p className="text-slate-400">{t('common.loading')}</p>;
  const c = data.counts;
  return (
    <div>
      <PageTitle>{t('today.title')}</PageTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('today.dueThisWeek')} value={num(c.dueThisWeek, lang)} tone="text-orange-700" />
        <Stat label={t('today.docsPending')} value={num(c.docsPending, lang)} tone="text-amber-700" />
        <Stat label={t('today.docsReceived')} value={num(c.docsReceived, lang)} tone="text-blue-700" />
        <Stat label={t('today.missed')} value={num(c.missed, lang)} tone="text-red-700" />
      </div>
      <h2 className="mb-2 mt-8 text-lg font-semibold">{t('today.urgent')}</h2>
      {data.tasks.length === 0 ? (
        <div className="card p-6 text-center text-slate-500">{t('today.empty')} <Link to="/clients" className="text-brand-600 underline">{t('clients.add')}</Link></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-slate-50"><tr>
              <th className="th">{t('fields.client')}</th><th className="th">{t('fields.rule')}</th><th className="th">{t('fields.period')}</th>
              <th className="th">{t('fields.due')}</th><th className="th">{t('fields.status')}</th><th className="th"></th>
            </tr></thead>
            <tbody className="divide-y">
              {data.tasks.map((task: any) => (
                <tr key={task._id} className={urgencyRowClass(task.dueDateAd, task.status)}>
                  <td className="td"><Link to={`/clients/${task.clientId}`} className="font-medium hover:underline">{task.client?.businessName}</Link><div className="text-xs text-slate-500">{task.client?.phone}</div></td>
                  <td className="td">{task.ruleName?.[lang] ?? task.ruleId}</td>
                  <td className="td">{lang === 'ne' ? task.periodLabelNe || task.periodLabel : task.periodLabel}</td>
                  <td className="td"><DateBs bs={task.dueDateBs} ad={task.dueDateAd} /><div><Urgency dueAd={task.dueDateAd} status={task.status} /></div></td>
                  <td className="td"><StatusBadge status={task.status} /></td>
                  <td className="td"><TaskActions task={task} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
