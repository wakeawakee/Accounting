import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import type { Me } from '../lib/auth';
import { ErrorText, PageTitle } from '../components/ui';
import { SUPABASE } from '../lib/demo';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };

function FirmSettings({ firm, canEdit }: { firm: any; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState<any>(null);
  useEffect(() => setF({
    name: firm.name, contactPhone: firm.contactPhone, contactEmail: firm.contactEmail, address: firm.address, messageSenderName: firm.messageSenderName,
    offsets: firm.reminderOffsets.join(', '), sendTime: toHHMM(firm.sendMinute), qStart: toHHMM(firm.quietHours.start), qEnd: toHHMM(firm.quietHours.end),
    provider: firm.messaging.provider, smsApiUrl: firm.messaging.smsApiUrl, smsSenderId: firm.messaging.smsSenderId, smsToken: '',
  }), [firm]);
  const [ok, setOk] = useState(false);
  const save = useMutation({
    mutationFn: () => api('/firm', { method: 'PATCH', body: {
      name: f.name, contactPhone: f.contactPhone, contactEmail: f.contactEmail, address: f.address, messageSenderName: f.messageSenderName,
      reminderOffsets: String(f.offsets).split(',').map((s: string) => Number(s.trim())).filter((n: number) => Number.isFinite(n)),
      sendMinute: fromHHMM(f.sendTime), quietHours: { start: fromHHMM(f.qStart), end: fromHHMM(f.qEnd) },
      messaging: { provider: f.provider, smsApiUrl: f.smsApiUrl, smsSenderId: f.smsSenderId, smsToken: f.smsToken || undefined },
    } }),
    onSuccess: () => { setOk(true); setTimeout(() => setOk(false), 2000); void qc.invalidateQueries({ queryKey: ['firm'] }); void qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  const logo = useMutation({
    mutationFn: (file: File) => { const form = new FormData(); form.append('logo', file); return api('/firm/logo', { form }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['firm'] }),
  });
  if (!f) return null;
  const inp = (k: string, label: string, extra: Record<string, unknown> = {}) => (
    <div><label className="label">{label}</label><input className="input" disabled={!canEdit} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>
  );
  return (
    <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-6">
      <Section title={t('settings.firm')}>
        <div className="grid gap-3 sm:grid-cols-2">
          {inp('name', t('auth.firmName'))}
          {inp('messageSenderName', t('settings.senderName'))}
          {inp('contactPhone', t('settings.contactPhone'))}
          {inp('contactEmail', t('settings.contactEmail'))}
          {inp('address', t('settings.address'))}
          <div>
            <label className="label">{t('settings.logo')} {firm.hasLogo && '✓'}</label>
            <input type="file" accept="image/png,image/jpeg" disabled={!canEdit} onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
            <ErrorText error={logo.error} />
          </div>
        </div>
      </Section>
      <Section title={t('settings.reminders')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>{inp('offsets', t('settings.offsets'))}<p className="mt-1 text-xs text-slate-500">{t('settings.offsetsHint')}</p></div>
          {inp('sendTime', t('settings.sendTime'), { type: 'time' })}
          <div>
            <label className="label">{t('settings.quietHours')}</label>
            <div className="flex items-center gap-2 text-sm">
              {t('settings.from')} <input type="time" className="input" disabled={!canEdit} value={f.qStart} onChange={(e) => setF({ ...f, qStart: e.target.value })} />
              {t('settings.to')} <input type="time" className="input" disabled={!canEdit} value={f.qEnd} onChange={(e) => setF({ ...f, qEnd: e.target.value })} />
            </div>
          </div>
        </div>
      </Section>
      <Section title={t('settings.messaging')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t('settings.provider')}</label>
            <select className="input" disabled={!canEdit} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
              <option value="console">Console (dev / testing)</option>
              <option value="sms">SMS gateway (Sparrow / Aakash)</option>
              <option value="viber" disabled>Viber (coming later)</option>
            </select>
          </div>
          {f.provider === 'sms' && <>
            {inp('smsApiUrl', t('settings.smsUrl'), { placeholder: 'https://api.sparrowsms.com/v2/sms/' })}
            {inp('smsSenderId', t('settings.senderId'))}
            {inp('smsToken', t('settings.smsToken'), { type: 'password', placeholder: firm.messaging.hasSmsToken ? t('settings.smsTokenSet') : '', autoComplete: 'off' })}
          </>}
        </div>
      </Section>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.isPending}>{t('common.save')}</button>
          {ok && <span className="text-sm text-green-700">{t('common.saved')}</span>}
          <ErrorText error={save.error} />
        </div>
      )}
    </form>
  );
}

function StaffSection({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<any[]>('/firm/users') });
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const add = useMutation({ mutationFn: () => api('/firm/users', { body: f }), onSuccess: () => { setF({ name: '', email: '', password: '' }); void qc.invalidateQueries({ queryKey: ['users'] }); } });
  const remove = useMutation({ mutationFn: (id: string) => api(`/firm/users/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });
  return (
    <Section title={t('settings.staff')}>
      <ul className="mb-4 divide-y text-sm">
        {(users.data ?? []).filter((u) => u.active).map((u) => (
          <li key={u._id} className="flex items-center justify-between py-2">
            <span><b>{u.name}</b> · {u.email} · <span className="text-slate-500">{u.role}</span></span>
            {canEdit && u.role === 'staff' && <button className="text-xs text-red-600" onClick={() => remove.mutate(u._id)}>{t('common.delete')}</button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={(e) => (e.preventDefault(), add.mutate())} className="grid gap-2 sm:grid-cols-4">
          <input className="input" placeholder={t('auth.name')} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" placeholder={t('auth.email')} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          {SUPABASE ? <p className="text-xs text-slate-500">They sign up on this site with this email and join your firm automatically.</p> : <input className="input" placeholder={t('auth.password')} type="password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
          <button className="btn-primary">{t('settings.addStaff')}</button>
          <div className="sm:col-span-4"><ErrorText error={add.error} /></div>
        </form>
      )}
    </Section>
  );
}

function dueRuleText(r: any, t: (k: string) => string) {
  if (r.type === 'daysAfterPeriodEnd') return `${r.days} ${t('settings.daysAfter')}`;
  if (r.type === 'monthEndAfterPeriodEnd') return `${t('settings.monthEnd').replace('N', String(r.months))}`;
  if (r.type === 'dayOfMonthAfterPeriodEnd') return `day ${r.day} of month +${r.months}`;
  return `${t('settings.fixed')}: ${r.month}/${r.day}`;
}

function RulesSection({ canEdit }: { canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'en' | 'ne';
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['rules'], queryFn: () => api('/rules') });
  const [f, setF] = useState({ nameEn: '', nameNe: '', frequency: 'annual', type: 'fixedInPeriod', days: 25, months: 3, month: 3, day: 15, applies: 'all' });
  const add = useMutation({
    mutationFn: () => {
      const dueRule = f.type === 'daysAfterPeriodEnd' ? { type: f.type, days: +f.days } : f.type === 'monthEndAfterPeriodEnd' ? { type: f.type, months: +f.months } : { type: f.type, month: +f.month, day: +f.day };
      const appliesTo = f.applies === 'vat' ? { vatRegistered: true } : f.applies === 'tds' ? { deductsTds: true } : {};
      return api('/rules/custom', { body: { nameEn: f.nameEn, nameNe: f.nameNe, frequency: f.frequency, dueRule, appliesTo } });
    },
    onSuccess: () => { setF({ ...f, nameEn: '', nameNe: '' }); for (const k of ['rules', 'tasks', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] }); },
  });
  const toggle = useMutation({ mutationFn: (r: any) => api(`/rules/custom/${r._id}`, { method: 'PATCH', body: { active: !r.active } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }) });
  if (!data) return null;
  return (
    <Section title={`${t('settings.rules')} · FY ${data.ruleSet.fiscalYear}`}>
      <p className="mb-1 text-sm font-medium">{t('settings.verifiedOn', { d: data.ruleSet.verifiedOn })}</p>
      <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">⚠ {t('settings.verifyWarn')}</p>
      <ul className="mb-5 divide-y text-sm">
        {data.ruleSet.rules.map((r: any) => (
          <li key={r.id} className="py-2"><b>{r.name[lang]}</b> — {t(`settings.${r.frequency}`)}, {dueRuleText(r.dueRule, t)}<div className="text-xs text-slate-500">{r.notes}</div></li>
        ))}
      </ul>
      <h3 className="mb-2 font-medium">{t('settings.customRules')}</h3>
      <ul className="mb-3 divide-y text-sm">
        {data.custom.map((r: any) => (
          <li key={r._id} className="flex items-center justify-between py-2">
            <span className={r.active ? '' : 'text-slate-400 line-through'}><b>{lang === 'ne' && r.nameNe ? r.nameNe : r.nameEn}</b> — {t(`settings.${r.frequency}`)}, {dueRuleText(r.dueRule, t)}</span>
            {canEdit && <button className="text-xs text-brand-600" onClick={() => toggle.mutate(r)}>{r.active ? t('clients.deactivate') : t('clients.reactivate')}</button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={(e) => (e.preventDefault(), add.mutate())} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <input className="input" placeholder="Name (English) e.g. Municipal renewal" required value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
          <input className="input" placeholder="नाम (नेपाली)" value={f.nameNe} onChange={(e) => setF({ ...f, nameNe: e.target.value })} />
          <select className="input" value={f.applies} onChange={(e) => setF({ ...f, applies: e.target.value })}>
            <option value="all">{t('settings.allClients')}</option><option value="vat">{t('settings.vatOnly')}</option><option value="tds">{t('settings.tdsOnly')}</option>
          </select>
          <select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            <option value="monthly">{t('settings.monthly')}</option><option value="trimester">{t('settings.trimester')}</option><option value="annual">{t('settings.annual')}</option>
          </select>
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="daysAfterPeriodEnd">{t('settings.daysAfter')}</option>
            <option value="monthEndAfterPeriodEnd">{t('settings.monthEnd')}</option>
            <option value="fixedInPeriod">{t('settings.fixed')}</option>
          </select>
          <div className="flex gap-2">
            {f.type === 'daysAfterPeriodEnd' && <input className="input" type="number" min={0} value={f.days} onChange={(e) => setF({ ...f, days: +e.target.value })} />}
            {f.type === 'monthEndAfterPeriodEnd' && <input className="input" type="number" min={0} max={12} value={f.months} onChange={(e) => setF({ ...f, months: +e.target.value })} />}
            {f.type === 'fixedInPeriod' && <>
              <input className="input" type="number" min={1} max={12} title="BS month (1=Baisakh)" value={f.month} onChange={(e) => setF({ ...f, month: +e.target.value })} />
              <input className="input" type="number" min={1} max={32} title="day" value={f.day} onChange={(e) => setF({ ...f, day: +e.target.value })} />
            </>}
          </div>
          <button className="btn-primary sm:col-span-3">{t('settings.addRule')}</button>
          <div className="sm:col-span-3"><ErrorText error={add.error} /></div>
        </form>
      )}
    </Section>
  );
}

function UsageSection() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['msgstats'], queryFn: () => api('/messages/stats') });
  if (!data) return null;
  return (
    <Section title={t('settings.usage')}>
      <table className="w-full text-sm">
        <thead><tr><th className="th">{t('settings.month')}</th><th className="th">{t('settings.messagesCount')}</th><th className="th">SMS segments</th><th className="th">{t('settings.costEstimate')}</th></tr></thead>
        <tbody className="divide-y">
          {data.months.length === 0 && <tr><td className="td text-slate-500" colSpan={4}>—</td></tr>}
          {data.months.map((m: any) => (
            <tr key={m._id}><td className="td">{m._id}</td><td className="td">{m.messages} ({m.failed} failed)</td><td className="td">{m.segments}</td><td className="td">{m.costNpr.toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Estimate at NPR {data.costPerSegmentNpr}/segment. Plan quota: {data.quota ?? '—'} / month.</p>
    </Section>
  );
}

export default function SettingsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const canEdit = me.user.role === 'owner';
  const firm = useQuery({ queryKey: ['firm'], queryFn: () => api('/firm') });
  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.title')}</PageTitle>
      {!canEdit && <p className="text-sm text-slate-500">{t('settings.ownerOnly')}</p>}
      {firm.data && <FirmSettings firm={firm.data} canEdit={canEdit} />}
      <StaffSection canEdit={canEdit} />
      <RulesSection canEdit={canEdit} />
      <UsageSection />
    </div>
  );
}
