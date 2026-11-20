import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEMO } from '../lib/demo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import type { Lang } from '../lib/format';
import { DateBs, ErrorText, PageTitle, StatusBadge, Urgency, urgencyRowClass } from '../components/ui';

function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['client'] });
  };
}

/** Per-task quick actions: status change, copy upload link, remind now. */
export function TaskActions({ task }: { task: any }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTasks();
  const [msg, setMsg] = useState('');
  const navigate = useNavigate();
  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/tasks/${task._id}`, { method: 'PATCH', body: { status } }),
    onSuccess: invalidate,
  });
  const flash = (m: string) => (setMsg(m), setTimeout(() => setMsg(''), 2500));
  async function copyLink() {
    const { url, token } = await api(`/tasks/${task._id}/upload-link`, { method: 'POST' });
    if (DEMO) return navigate(`/u/${token}`);
    try {
      await navigator.clipboard.writeText(url);
      flash(t('tasks.linkCopied'));
    } catch {
      flash(url);
    }
  }
  const remind = useMutation({ mutationFn: () => api(`/tasks/${task._id}/remind-now`, { method: 'POST' }), onSuccess: () => (flash(t('tasks.sent')), invalidate()), onError: (e) => flash((e as Error).message) });
  return (
    <div className="flex flex-wrap items-center gap-1">
      {task.status !== 'filed' && <button className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700" onClick={() => setStatus.mutate('filed')}>{t('tasks.markFiled')}</button>}
      {task.status === 'pending' || task.status === 'missed' ? (
        <>
          <button className="rounded border px-2 py-1 text-xs" onClick={() => setStatus.mutate('docs_received')}>{t('tasks.markReceived')}</button>
          <button className="rounded border px-2 py-1 text-xs" onClick={() => remind.mutate()} disabled={remind.isPending}>📩 {t('tasks.remindNow')}</button>
        </>
      ) : (
        <button className="rounded border px-2 py-1 text-xs" onClick={() => setStatus.mutate('pending')}>{t('tasks.markPending')}</button>
      )}
      <button className="rounded border px-2 py-1 text-xs" onClick={copyLink}>🔗 {t('tasks.uploadLink')}</button>
      {msg && <span className="text-xs text-brand-600">{msg}</span>}
    </div>
  );
}

export default function TasksPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const invalidate = useInvalidateTasks();
  const [f, setF] = useState({ status: 'pending,docs_received,missed', ruleId: '', periodKey: '', staffId: '', q: '' });
  const [sel, setSel] = useState<Set<string>>(new Set());

  const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== 'q') as [string, string][]).toString();
  const tasks = useQuery({ queryKey: ['tasks', qs], queryFn: () => api<any[]>(`/tasks?${qs}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<any[]>('/firm/users') });
  const all = useQuery({ queryKey: ['tasks', 'all-periods'], queryFn: () => api<any[]>('/tasks'), staleTime: 60_000 });

  const periods = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of all.data ?? []) m.set(x.periodKey, lang === 'ne' ? x.periodLabelNe || x.periodLabel : x.periodLabel);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [all.data, lang]);
  const rules = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of all.data ?? []) m.set(x.ruleId, x.ruleName?.[lang] ?? x.ruleId);
    return [...m.entries()];
  }, [all.data, lang]);

  const rows = (tasks.data ?? []).filter((x) => !f.q || x.client?.businessName?.toLowerCase().includes(f.q.toLowerCase()));
  const bulk = useMutation({
    mutationFn: (status: string) => api('/tasks/bulk-status', { body: { ids: [...sel], status } }),
    onSuccess: () => (setSel(new Set()), invalidate()),
  });
  const generate = useMutation({ mutationFn: () => api('/tasks/generate', { method: 'POST' }), onSuccess: invalidate });
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r._id));

  return (
    <div>
      <PageTitle actions={<button className="btn-secondary" onClick={() => generate.mutate()} disabled={generate.isPending}>{t('tasks.regenerate')}</button>}>{t('tasks.title')}</PageTitle>
      <div className="card mb-4 grid gap-2 p-3 md:grid-cols-5">
        <input className="input" placeholder={t('common.search')} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="pending,docs_received,missed">{t('status.pending')} + {t('status.docs_received')} + {t('status.missed')}</option>
          <option value="">{t('tasks.allStatus')}</option>
          {['pending', 'docs_received', 'filed', 'missed'].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
        <select className="input" value={f.periodKey} onChange={(e) => setF({ ...f, periodKey: e.target.value })}>
          <option value="">{t('tasks.allPeriods')}</option>
          {periods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input" value={f.ruleId} onChange={(e) => setF({ ...f, ruleId: e.target.value })}>
          <option value="">{t('tasks.allRules')}</option>
          {rules.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input" value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
          <option value="">{t('tasks.allStaff')}</option>
          <option value="none">{t('fields.unassigned')}</option>
          {(users.data ?? []).filter((u) => u.active).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
        </select>
      </div>

      {sel.size > 0 && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 bg-brand-50 p-3">
          <span className="text-sm font-medium">{t('tasks.selected', { n: sel.size })}</span>
          <button className="btn-primary" onClick={() => bulk.mutate('filed')}>{t('tasks.markFiled')}</button>
          <button className="btn-secondary" onClick={() => bulk.mutate('docs_received')}>{t('tasks.markReceived')}</button>
          <button className="btn-secondary" onClick={() => setSel(new Set())}>{t('common.cancel')}</button>
          <ErrorText error={bulk.error} />
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b bg-slate-50"><tr>
            <th className="th w-8"><input type="checkbox" checked={allSelected} onChange={() => setSel(allSelected ? new Set() : new Set(rows.map((r) => r._id)))} /></th>
            <th className="th">{t('fields.client')}</th><th className="th">{t('fields.rule')}</th><th className="th">{t('fields.period')}</th>
            <th className="th">{t('fields.due')}</th><th className="th">{t('fields.status')}</th><th className="th">{t('common.actions')}</th>
          </tr></thead>
          <tbody className="divide-y">
            {tasks.isLoading && <tr><td className="td text-slate-400" colSpan={7}>{t('common.loading')}</td></tr>}
            {rows.map((task) => (
              <tr key={task._id} className={urgencyRowClass(task.dueDateAd, task.status)}>
                <td className="td"><input type="checkbox" checked={sel.has(task._id)} onChange={() => toggle(task._id)} /></td>
                <td className="td"><Link to={`/clients/${task.clientId}`} className="font-medium hover:underline">{task.client?.businessName}</Link></td>
                <td className="td">{task.ruleName?.[lang] ?? task.ruleId}</td>
                <td className="td">{lang === 'ne' ? task.periodLabelNe || task.periodLabel : task.periodLabel}</td>
                <td className="td">
                  <DateBs bs={task.dueDateBs} ad={task.dueDateAd} />
                  <div><Urgency dueAd={task.dueDateAd} status={task.status} /></div>
                  {task.holidayFlag && <div className="text-xs text-purple-600">⚠ {t('tasks.holiday', { h: task.holidayFlag })}</div>}
                </td>
                <td className="td"><StatusBadge status={task.status} /></td>
                <td className="td"><TaskActions task={task} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
