import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { DEMO, STATIC_HOST, SUPABASE } from './lib/demo';
import './index.css';

// Code-split: the public upload page never loads the dashboard bundle.
const UploadPage = lazy(() => import('./pages/UploadPage'));
const AppRoot = lazy(() => import('./AppRoot'));
// Static hosts (GitHub Pages) can't serve /clients etc., so use #/clients.
const Router = STATIC_HOST ? HashRouter : BrowserRouter;

function NotConfigured() {
  return (
    <div className="mx-auto max-w-md p-6 text-slate-700">
      <h1 className="mb-2 text-xl font-bold text-brand-600">KarSathi</h1>
      <p>This site is deployed but not connected to a Supabase project yet.</p>
      <p className="mt-2 text-sm">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README → GitHub Pages), then redeploy.</p>
      <a className="btn-primary mt-4" href="./demo/">Open the demo with sample data</a>
    </div>
  );
}

function start() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {STATIC_HOST && !DEMO && !SUPABASE ? (
        <NotConfigured />
      ) : (
        <Router>
          <Suspense fallback={<div className="p-6 text-center text-slate-400">…</div>}>
            <Routes>
              <Route path="/u/:token" element={<UploadPage />} />
              <Route path="/*" element={<AppRoot />} />
            </Routes>
          </Suspense>
        </Router>
      )}
    </StrictMode>,
  );
}

if (DEMO) void import('./demo/backend').then((m) => (m.installDemoBackend(), start()));
else if (SUPABASE) void import('./supabase/backend').then((m) => (m.installSupabaseBackend(), start()));
else start();
