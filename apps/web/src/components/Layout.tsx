import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, CalendarDays, FileText, LayoutDashboard, ListChecks, LogOut, Menu, Settings, Users, X } from 'lucide-react';
import { todayBs } from '@karsathi/shared';
import { api } from '../lib/api';
import type { Me } from '../lib/auth';
import { bsDateTime, bsLong, monthName, num, type Lang } from '../lib/format';
import { setLanguage } from '../i18n';
import { DEMO } from '../lib/demo';

const WEEKDAYS_NE = ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'];

/** Today's date as a Nepali wall calendar (patro) leaf: Saturday's number in red, as on a printed patro. */
function Patro({ lang }: { lang: Lang }) {
  const bs = todayBs();
  const now = new Date();
  // Browsers often lack Nepali weekday names, so they live here.
  const weekday = lang === 'ne' ? WEEKDAYS_NE[now.getDay()] : now.toLocaleDateString('en-GB', { weekday: 'long' });
  return (
    <div className="mx-4 overflow-hidden rounded-lg bg-white text-center">
      <div className="bg-seal-500 py-1 text-xs font-medium text-white">{monthName(bs.month, lang)} {num(bs.year, lang)}</div>
      <div className={`pb-1 pt-2 text-5xl font-semibold leading-none tabular-nums ${now.getDay() === 6 ? 'text-seal-500' : 'text-ink-900'}`}>{num(bs.day, lang)}</div>
      <div className="pb-2 text-xs text-slate-500">{weekday}</div>
    </div>
  );
}

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
    ['/', t('nav.today'), LayoutDashboard],
    ['/clients', t('nav.clients'), Users],
    ['/tasks', t('nav.tasks'), ListChecks],
    ['/calendar', t('nav.calendar'), CalendarDays],
    ['/templates', t('nav.templates'), FileText],
    ['/settings', t('nav.settings'), Settings],
  ] as const;
  const unread = notes.data?.unread ?? 0;

  return (
    <div className="min-h-screen md:pl-60">
      <aside className={`${menu ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-ink-900 text-slate-300 transition-transform motion-reduce:transition-none md:translate-x-0`}>
        <div className="flex items-start justify-between px-5 pb-5 pt-5">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-white">{t('app.name')}</div>
            <div className="truncate text-xs text-slate-400">{me.firm.name}</div>
          </div>
          <button className="rounded-md p-1 hover:bg-white/10 md:hidden" onClick={() => setMenu(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <Patro lang={lang} />
        <nav className="mt-5 flex-1 space-y-0.5 overflow-y-auto px-3">
          {links.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenu(false)}
              className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white'}`}>
              <Icon size={17} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-sm">
          <div className="truncate font-medium text-white">{me.user.name}</div>
          <div className="mt-2 flex items-center justify-between">
            <button className="rounded-md border border-white/20 px-2 py-0.5 text-xs hover:bg-white/10" onClick={() => setLanguage(lang === 'ne' ? 'en' : 'ne')}>{lang === 'ne' ? 'English' : 'नेपाली'}</button>
            <button className="inline-flex items-center gap-1.5 text-xs hover:text-white" onClick={logout}><LogOut size={14} aria-hidden />{t('nav.logout')}</button>
          </div>
        </div>
      </aside>
      {menu && <div className="fixed inset-0 z-40 bg-ink-900/40 md:hidden" onClick={() => setMenu(false)} aria-hidden />}

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-8">
        <button className="rounded-md p-1 hover:bg-slate-100 md:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu size={20} /></button>
        <span className="font-semibold md:hidden">{t('app.name')}</span>
        {/* BS date is on the patro tile; the bar shows AD, since filings and banks use both. */}
        <span className="hidden text-sm text-slate-500 md:inline">{bsLong(today, lang)} <span className="text-slate-400">({new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})</span></span>
        <div className="relative ml-auto">
          <button className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-ink-900" onClick={() => setOpen(!open)} aria-label={t('notifications.title')} aria-expanded={open}>
            <Bell size={19} />
            {unread > 0 && <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-seal-500 px-1 text-center text-[11px] font-semibold leading-[1.1rem] text-white">{num(unread, lang)}</span>}
          </button>
          {open && (
            <div className="card absolute right-0 top-11 w-80 p-2 shadow-xl">
              <div className="flex items-center justify-between px-2 py-1">
                <b className="text-sm">{t('notifications.title')}</b>
                <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => markRead.mutate()}>{t('notifications.markRead')}</button>
              </div>
              <ul className="max-h-96 overflow-y-auto">
                {(notes.data?.items ?? []).length === 0 && <li className="p-2 text-sm text-slate-500">{t('notifications.empty')}</li>}
                {(notes.data?.items ?? []).map((n: any) => (
                  <li key={n._id}>
                    <button className={`w-full rounded-md p-2 text-left text-sm hover:bg-slate-50 ${n.readAt ? 'text-slate-500' : 'font-medium'}`}
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
      </header>
      {DEMO && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Demo with sample data. Everything stays on this device. Try Tasks, then Upload link, to see the client's phone page.{' '}
          <button className="font-semibold underline" onClick={async () => { const m = await import('../demo/backend'); m.resetDemo(); qc.clear(); nav('/'); }}>Reset demo</button>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
