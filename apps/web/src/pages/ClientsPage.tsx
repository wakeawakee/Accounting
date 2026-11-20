import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CLIENT_IMPORT_FIELDS } from '@karsathi/shared';
import { api } from '../lib/api';
import { DEMO } from '../lib/demo';
import { ErrorText, Modal, PageTitle } from '../components/ui';

const EMPTY = { businessName: '', ownerName: '', phone: '', pan: '', vatRegistered: false, deductsTds: false, municipality: '', preferredLanguage: 'ne', assignedStaffId: '' };

export function ClientForm({ initial, onDone }: { initial?: any; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ ...EMPTY, ...(initial ?? {}), assignedStaffId: initial?.assignedStaffId ?? '' });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<any[]>('/firm/users') });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        businessName: f.businessName, ownerName: f.ownerName, phone: f.phone, pan: f.pan, vatRegistered: f.vatRegistered,
        deductsTds: f.deductsTds, municipality: f.municipality, preferredLanguage: f.preferredLanguage, assignedStaffId: f.assignedStaffId || null,
      };
      return initial ? api(`/clients/${initial._id}`, { method: 'PATCH', body }) : api('/clients', { body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['client'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onDone();
    },
  });
  const details = (save.error as any)?.details?.fieldErrors ?? {};
  const text = (k: string, label: string, extra: Record<string, unknown> = {}) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={(f as any)[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} />
      {details[k] && <p className="text-xs text-red-600">{details[k].join(', ')}</p>}
    </div>
  );
  return (
    <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="grid gap-3 sm:grid-cols-2">
      {text('businessName', t('fields.businessName'), { required: true })}
      {text('ownerName', t('fields.ownerName'), { required: true })}
      {text('phone', t('fields.phone'), { required: true, inputMode: 'numeric', placeholder: '98XXXXXXXX' })}
      {text('pan', t('fields.pan'), { required: true, inputMode: 'numeric', maxLength: 9 })}
      {text('municipality', t('fields.municipality'))}
      <div>
        <label className="label">{t('fields.preferredLanguage')}</label>
        <select className="input" value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value })}>
          <option value="ne">नेपाली</option><option value="en">English</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.vatRegistered} onChange={(e) => setF({ ...f, vatRegistered: e.target.checked })} />{t('fields.vatRegistered')}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.deductsTds} onChange={(e) => setF({ ...f, deductsTds: e.target.checked })} />{t('fields.deductsTds')}</label>
      <div className="sm:col-span-2">
        <label className="label">{t('fields.assignedStaff')}</label>
        <select className="input" value={f.assignedStaffId} onChange={(e) => setF({ ...f, assignedStaffId: e.target.value })}>
          <option value="">{t('fields.unassigned')}</option>
          {(users.data ?? []).filter((u) => u.active).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" className="btn-secondary" onClick={onDone}>{t('common.cancel')}</button>
        <button className="btn-primary" disabled={save.isPending}>{t('common.save')}</button>
      </div>
    </form>
  );
}

function ImportWizard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [done, setDone] = useState<any>(null);

  const parse = useMutation({
    mutationFn: (file: File) => { const form = new FormData(); form.append('file', file); return api('/clients/import/parse', { form }); },
    onSuccess: (d) => { setParsed(d); setMapping(d.suggestedMapping); setResult(null); },
  });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api('/clients/import', { body: { rows: parsed!.rows, mapping, dryRun } }),
    onSuccess: (d, dryRun) => {
      if (dryRun) setResult(d);
      else {
        setDone(d.summary);
        for (const k of ['clients', 'tasks', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] });
      }
    },
  });

  if (done) {
    return (
      <div className="text-center">
        <p className="text-lg text-green-700">✓ {t('import.done', { n: done.imported, t: done.tasksCreated })}</p>
        <button className="btn-primary mt-4" onClick={onDone}>{t('common.close')}</button>
      </div>
    );
  }
  const required = ['businessName', 'ownerName', 'phone', 'pan'];
  const missingRequired = required.some((k) => !mapping[k]);

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 font-medium">{t('import.step1')}</h3>
        <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && parse.mutate(e.target.files[0])} />
        {DEMO && (
          <button type="button" className="btn-secondary ml-2" onClick={async () => { const m = await import('../demo/backend'); const d = m.sampleImportRows(); setParsed(d); setMapping(d.suggestedMapping as Record<string, string>); setResult(null); }}>
            Use sample file (50 clients)
          </button>
        )}
        <p className="mt-1 text-xs text-slate-500">{t('import.tip')}</p>
        <ErrorText error={parse.error} />
        {parsed && <p className="mt-1 text-sm">{t('import.rows', { n: parsed.rows.length })}</p>}
      </section>

      {parsed && (
        <section>
          <h3 className="mb-2 font-medium">{t('import.step2')}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLIENT_IMPORT_FIELDS.map((field) => (
              <div key={field} className="flex items-center gap-2">
                <span className="w-40 text-sm">{t(`fields.${field}`)}{required.includes(field) && <span className="text-red-500"> *</span>}</span>
                <select className="input" value={mapping[field] ?? ''} onChange={(e) => { setMapping({ ...mapping, [field]: e.target.value }); setResult(null); }}>
                  <option value="">{t('import.notMapped')}</option>
                  {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button className="btn-primary mt-3" disabled={missingRequired || run.isPending} onClick={() => run.mutate(true)}>{t('import.validate')}</button>
        </section>
      )}

      {result && (
        <section>
          <h3 className="mb-2 font-medium">{t('import.step3')}</h3>
          <div className="mb-3 flex flex-wrap gap-3 text-sm">
            <span className="rounded bg-green-50 px-2 py-1 text-green-800">{t('import.valid')}: <b>{result.summary.valid}</b></span>
            <span className="rounded bg-red-50 px-2 py-1 text-red-800">{t('import.errors')}: <b>{result.summary.errors}</b></span>
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">{t('import.duplicates')}: <b>{result.summary.duplicates}</b></span>
          </div>
          {result.report.some((r: any) => r.status !== 'valid' || r.warnings.length) && (
            <div className="max-h-64 overflow-y-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr><th className="th">{t('import.row')}</th><th className="th">{t('fields.businessName')}</th><th className="th">{t('import.problem')}</th></tr></thead>
                <tbody className="divide-y">
                  {result.report.filter((r: any) => r.status !== 'valid' || r.warnings.length).map((r: any) => (
                    <tr key={r.row} className={r.status === 'error' ? 'bg-red-50/40' : r.status === 'duplicate' ? 'bg-amber-50/40' : ''}>
                      <td className="td">{r.row}</td>
                      <td className="td">{r.businessName ?? parsed?.rows[r.row - 2]?.[mapping.businessName] ?? ''}</td>
                      <td className="td">
                        {r.errors.map((e: any) => <div key={e.field}><b>{t(`fields.${e.field}`)}</b>: {e.message}</div>)}
                        {r.warnings.map((w: string) => <div key={w} className="text-amber-700">{w}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="btn-primary mt-3" disabled={!result.summary.valid || run.isPending} onClick={() => run.mutate(false)}>
            {t('import.importN', { n: result.summary.valid })}
          </button>
          <ErrorText error={run.error} />
        </section>
      )}
    </div>
  );
}

export default function ClientsPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<'add' | 'import' | null>(null);
  const clients = useQuery({ queryKey: ['clients', q], queryFn: () => api<any[]>(`/clients?q=${encodeURIComponent(q)}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<any[]>('/firm/users') });
  const staffName = (id: string) => users.data?.find((u) => u._id === id)?.name ?? '—';

  return (
    <div>
      <PageTitle actions={<>
        <button className="btn-secondary" onClick={() => setModal('import')}>⬆ {t('clients.import')}</button>
        <button className="btn-primary" onClick={() => setModal('add')}>+ {t('clients.add')}</button>
      </>}>{t('clients.title')}</PageTitle>
      <input className="input mb-3 max-w-sm" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="mb-2 text-sm text-slate-500">{t('clients.count', { n: clients.data?.length ?? 0 })}</p>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b bg-slate-50"><tr>
            <th className="th">{t('fields.businessName')}</th><th className="th">{t('fields.ownerName')}</th><th className="th">{t('fields.phone')}</th>
            <th className="th">{t('fields.pan')}</th><th className="th">VAT</th><th className="th">TDS</th><th className="th">{t('fields.assignedStaff')}</th>
          </tr></thead>
          <tbody className="divide-y">
            {clients.data?.length === 0 && <tr><td className="td text-slate-500" colSpan={7}>{t('clients.empty')}</td></tr>}
            {clients.data?.map((c) => (
              <tr key={c._id} className="hover:bg-slate-50">
                <td className="td"><Link to={`/clients/${c._id}`} className="font-medium text-brand-700 hover:underline">{c.businessName}</Link></td>
                <td className="td">{c.ownerName}</td><td className="td">{c.phone}</td><td className="td">{c.pan}</td>
                <td className="td">{c.vatRegistered ? '✓' : ''}</td><td className="td">{c.deductsTds ? '✓' : ''}</td>
                <td className="td">{c.assignedStaffId ? staffName(c.assignedStaffId) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal === 'add' && <Modal title={t('clients.add')} onClose={() => setModal(null)}><ClientForm onDone={() => setModal(null)} /></Modal>}
      {modal === 'import' && <Modal wide title={t('import.title')} onClose={() => setModal(null)}><ImportWizard onDone={() => setModal(null)} /></Modal>}
    </div>
  );
}
