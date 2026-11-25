import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { api } from '../lib/api';
import { setLanguage } from '../i18n';
import type { Lang } from '../lib/format';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  return (
    <div className="grid min-h-screen md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-ink-900 p-10 text-slate-300 md:flex">
        <div className="text-xl font-semibold text-white">{t('app.name')}</div>
        <div>
          <p className="max-w-sm text-3xl font-semibold leading-snug text-white">{t('auth.pitch')}</p>
          <ul className="mt-6 space-y-2.5">
            {(['point1', 'point2', 'point3'] as const).map((k) => (
              <li key={k} className="flex gap-2.5"><Check size={18} className="mt-0.5 shrink-0 text-brand-200" aria-hidden />{t(`auth.${k}`)}</li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-slate-500">{t('app.tagline')}</div>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between">
            <span className="text-xl font-semibold md:invisible">{t('app.name')}</span>
            <button className="rounded-md border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50" onClick={() => setLanguage(lang === 'ne' ? 'en' : 'ne')}>{lang === 'ne' ? 'English' : 'नेपाली'}</button>
          </div>
          <h1 className="mb-5 text-2xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

function useAuthSubmit(path: string) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(body: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(path, { body });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { submit, error, busy };
}

export function LoginPage() {
  const { t } = useTranslation();
  const { submit, error, busy } = useAuthSubmit('/auth/login');
  const [f, setF] = useState({ email: '', password: '' });
  const onSubmit = (e: FormEvent) => (e.preventDefault(), submit(f));
  return (
    <Shell title={t('auth.login')}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div><label className="label">{t('auth.email')}</label><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label">{t('auth.password')}</label><input className="input" type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        {error && <p className="rounded-md bg-seal-50 p-2 text-sm text-seal-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{t('auth.login')}</button>
      </form>
      <Link to="/signup" className="mt-5 block text-center text-sm font-medium text-brand-600 hover:underline">{t('auth.noAccount')}</Link>
    </Shell>
  );
}

export function SignupPage() {
  const { t } = useTranslation();
  const { submit, error, busy } = useAuthSubmit('/auth/signup');
  const [f, setF] = useState({ firmName: '', name: '', email: '', password: '' });
  const onSubmit = (e: FormEvent) => (e.preventDefault(), submit(f));
  const field = (k: keyof typeof f, label: string, type = 'text', extra = {}) => (
    <div><label className="label">{label}</label><input className="input" type={type} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>
  );
  return (
    <Shell title={t('auth.signup')}>
      <form onSubmit={onSubmit} className="space-y-4">
        {field('firmName', t('auth.firmName'))}
        {field('name', t('auth.name'))}
        {field('email', t('auth.email'), 'email')}
        {field('password', t('auth.password'), 'password', { minLength: 8, placeholder: t('auth.passwordHint') })}
        {error && <p className="rounded-md bg-seal-50 p-2 text-sm text-seal-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{t('auth.signup')}</button>
      </form>
      <Link to="/login" className="mt-5 block text-center text-sm font-medium text-brand-600 hover:underline">{t('auth.haveAccount')}</Link>
    </Shell>
  );
}
