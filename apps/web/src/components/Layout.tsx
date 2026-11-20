import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { todayBs } from '@karsathi/shared';
import { api } from '../lib/api';
import type { Me } from '../lib/auth';
import { bsDateTime, bsLong, type Lang } from '../lib/format';
import { setLanguage } from '../i18n';

export default function Layout({ me, children }: { me: Me; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  // Poll for new uploads so the accountant sees them within seconds.
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api('/notifications'), refetchInterval: 15_000 });
  const latestId = notes.data?.items?.[0]?._id;
  useEffect(() => {
    // A new notification (e.g. client upload) → refresh dashboard data.
    if (!latestId) return;
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['client'] });
  }, [latestId, qc]);
  const markRead = useMutation({ mutationFn: () => api('/notifications/read', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    nav('/login');
  }

  const t0 = todayBs();
  const today = `${t0.year}-${String(t0.month).padStart(2, '0')}-${String(t0.day).padStart(2, '0')}`;
  const links = [
    ['/', t('nav.today')],
    ['/clients', t('nav.clients')],
    ['/tasks', t('nav.tasks')],
    ['/calendar', t('nav.calendar')],
    ['/templates', t('nav.templates')],
    ['/settings', t('nav.settings')],
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
          <button className="md:hidden" onClick={() => setMenu(!menu)} aria-label="menu">☰</button>
          <div className="font-bold text-brand-600">{t('app.name')}</div>
          <nav className={`${menu ? 'flex' : 'hidden'} absolute left-0 top-12 w-full flex-col bg-white p-2 shadow md:static md:flex md:w-auto md:flex-row md:p-0 md:shadow-none`}>
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenu(false)}
                className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 lg:inline">{bsLong(today, lang)}</span>
            <button className="rounded border px-2 py-1 text-xs" onClick={() => setLanguage(lang === 'ne' ? 'en' : 'ne')}>{lang === 'ne' ? 'EN' : 'ने'}</button>
            <div className="relative">
              <button className="relative text-xl" onClick={() => setOpen(!open)} aria-label={t('notifications.title')}>
                🔔
                {notes.data?.unread > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{notes.data.unread}</span>}
              </button>
              {open && (
                <div className="card absolute right-0 top-9 w-80 p-2">
                  <div className="flex items-center justify-between px-2 py-1">
                    <b className="text-sm">{t('notifications.title')}</b>
                    <button className="text-xs text-brand-600" onClick={() => markRead.mutate()}>{t('notifications.markRead')}</button>
                  </div>
                  <ul className="max-h-96 overflow-y-auto">
                    {(notes.data?.items ?? []).length === 0 && <li className="p-2 text-sm text-slate-500">{t('notifications.empty')}</li>}
                    {(notes.data?.items ?? []).map((n: any) => (
                      <li key={n._id}>
                        <button className={`w-full rounded p-2 text-left text-sm hover:bg-slate-50 ${n.readAt ? 'text-slate-500' : 'font-medium'}`}
                          onClick={() => { setOpen(false); if (n.link) nav(n.link); }}>
                          {n.title}
                          <div className="text-xs font-normal text-slate-400">{n.body} · {bsDateTime(n.createdAt, lang)}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="hidden text-right text-xs sm:block">
              <div className="font-medium">{me.user.name}</div>
              <div className="text-slate-500">{me.firm.name}</div>
            </div>
            <button className="text-xs text-slate-500 hover:text-slate-800" onClick={logout}>{t('nav.logout')}</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
