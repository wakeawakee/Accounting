import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { setLanguage } from '../i18n';
import type { Lang } from '../lib/format';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xl font-bold text-brand-600">{t('app.name')}</span>
          <button className="rounded border px-2 py-0.5 text-xs" onClick={() => setLanguage(lang === 'ne' ? 'en' : 'ne')}>{lang === 'ne' ? 'English' : 'नेपाली'}</button>
        </div>
        <p className="mb-5 text-sm text-slate-500">{t('app.tagline')}</p>
        <h1 className="mb-4 text-lg font-semibold">{title}</h1>
        {children}
      </div>
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
      <form onSubmit={onSubmit} className="space-y-3">
        <div><label className="label">{t('auth.email')}</label><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label">{t('auth.password')}</label><input className="input" type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{t('auth.login')}</button>
      </form>
      <Link to="/signup" className="mt-4 block text-center text-sm text-brand-600">{t('auth.noAccount')}</Link>
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
      <form onSubmit={onSubmit} className="space-y-3">
        {field('firmName', t('auth.firmName'))}
        {field('name', t('auth.name'))}
        {field('email', t('auth.email'), 'email')}
        {field('password', t('auth.password'), 'password', { minLength: 8, placeholder: t('auth.passwordHint') })}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{t('auth.signup')}</button>
      </form>
      <Link to="/login" className="mt-4 block text-center text-sm text-brand-600">{t('auth.haveAccount')}</Link>
    </Shell>
  );
}
