import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, apiBase } from '../lib/api';
import { bsDateTime, type Lang } from '../lib/format';
import { DateBs, Modal, PageTitle, StatusBadge, Urgency } from '../components/ui';
import { ClientForm } from './ClientsPage';
import { TaskActions } from './TasksPage';

function DocThumb({ doc, onOpen }: { doc: any; onOpen: (url: string, mime: string) => void }) {
  const { t, i18n } = useTranslation();
  async function open() {
    const { url } = await api(`/documents/${doc._id}/url`);
    onOpen(url, doc.mimeType);
  }
  return (
    <button onClick={open} className="card flex flex-col items-center p-2 text-left text-xs hover:border-brand-500">
      <span className="text-3xl">{doc.mimeType === 'application/pdf' ? '📄' : '🖼️'}</span>
      <span className="w-full truncate">{doc.originalName}</span>
      <span className="text-slate-400">{Math.round(doc.size / 1024)} KB · {bsDateTime(doc.uploadedAt, i18n.language as Lang)}</span>
      {doc.note && <span className="w-full truncate italic text-slate-500">“{doc.note}”</span>}
      <span className="text-brand-600">{t('common.view')}</span>
    </button>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['client', id], queryFn: () => api(`/clients/${id}`) });
  const toggleActive = useMutation({
    mutationFn: () => api(`/clients/${id}`, { method: 'PATCH', body: { active: !data.client.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client', id] }),
  });
  if (isLoading || !data) return <p className="text-slate-400">{t('common.loading')}</p>;
  const { client, tasks, documents, messages } = data;
  const docsByTask = new Map<string, any[]>();
  for (const d of documents) docsByTask.set(d.taskId, [...(docsByTask.get(d.taskId) ?? []), d]);

  return (
    <div className="space-y-6">
      <PageTitle actions={<>
        <button className="btn-secondary" onClick={() => setEditing(true)}>{t('common.edit')}</button>
        <button className="btn-secondary" onClick={() => toggleActive.mutate()}>{client.active ? t('clients.deactivate') : t('clients.reactivate')}</button>
      </>}>
        {client.businessName} {!client.active && <span className="text-sm text-slate-400">(inactive)</span>}
      </PageTitle>

      <div className="card grid gap-3 p-4 text-sm sm:grid-cols-4">
        <div><div className="label">{t('fields.ownerName')}</div>{client.ownerName}</div>
        <div><div className="label">{t('fields.phone')}</div><a href={`tel:${client.phone}`} className="text-brand-700">{client.phone}</a></div>
        <div><div className="label">{t('fields.pan')}</div>{client.pan}</div>
        <div><div className="label">{t('fields.municipality')}</div>{client.municipality || '—'}</div>
        <div><div className="label">{t('fields.vatRegistered')}</div>{client.vatRegistered ? t('common.yes') : t('common.no')}</div>
        <div><div className="label">{t('fields.deductsTds')}</div>{client.deductsTds ? t('common.yes') : t('common.no')}</div>
        <div><div className="label">{t('fields.preferredLanguage')}</div>{client.preferredLanguage === 'en' ? 'English' : 'नेपाली'}</div>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('clients.tasks')}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-slate-50"><tr><th className="th">{t('fields.rule')}</th><th className="th">{t('fields.period')}</th><th className="th">{t('fields.due')}</th><th className="th">{t('fields.status')}</th><th className="th">{t('clients.documents')}</th><th className="th"></th></tr></thead>
            <tbody className="divide-y">
              {tasks.map((task: any) => (
                <tr key={task._id}>
                  <td className="td">{task.ruleName?.[lang] ?? task.ruleId}</td>
                  <td className="td">{lang === 'ne' ? task.periodLabelNe || task.periodLabel : task.periodLabel}</td>
                  <td className="td"><DateBs bs={task.dueDateBs} ad={task.dueDateAd} /><div><Urgency dueAd={task.dueDateAd} status={task.status} /></div></td>
                  <td className="td"><StatusBadge status={task.status} /></td>
                  <td className="td">{docsByTask.get(task._id)?.length ? <a className="text-brand-700 underline" href={`${apiBase}/api/clients/${id}/documents.zip?taskId=${task._id}`}>{docsByTask.get(task._id)!.length} ⬇</a> : '—'}</td>
                  <td className="td"><TaskActions task={task} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('clients.documents')} ({documents.length})</h2>
          {documents.length > 0 && <a className="btn-secondary" href={`${apiBase}/api/clients/${id}/documents.zip`}>⬇ {t('clients.downloadAll')}</a>}
        </div>
        {documents.length === 0 ? <p className="text-sm text-slate-500">{t('clients.noDocs')}</p> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {documents.map((d: any) => <DocThumb key={d._id} doc={d} onOpen={(url, mime) => setPreview({ url, mime })} />)}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('clients.messages')}</h2>
        {messages.length === 0 ? <p className="text-sm text-slate-500">{t('clients.noMessages')}</p> : (
          <ul className="card divide-y">
            {messages.map((m: any) => (
              <li key={m._id} className="p-3 text-sm">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{bsDateTime(m.createdAt, lang)} · {m.provider} · {m.segments} SMS</span>
                  <span className={m.status === 'sent' ? 'text-green-700' : 'text-red-600'}>{m.status}{m.error ? `: ${m.error}` : ''}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <Modal title={t('common.edit')} onClose={() => setEditing(false)}><ClientForm initial={client} onDone={() => setEditing(false)} /></Modal>}
      {preview && (
        <Modal wide title={t('common.view')} onClose={() => setPreview(null)}>
          {preview.mime === 'application/pdf'
            ? <iframe src={preview.url} className="h-[75vh] w-full" title="pdf" />
            : <img src={preview.url} alt="" className="mx-auto max-h-[75vh]" />}
          <a href={preview.url} target="_blank" rel="noreferrer" className="btn-secondary mt-3">{t('common.download')}</a>
        </Modal>
      )}
    </div>
  );
}
