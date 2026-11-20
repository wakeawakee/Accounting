import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { DEMO } from './lib/demo';
import './index.css';

// Code-split: the public upload page never loads the dashboard bundle.
const UploadPage = lazy(() => import('./pages/UploadPage'));
const AppRoot = lazy(() => import('./AppRoot'));
const Router = DEMO ? HashRouter : BrowserRouter;

function start() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Router>
        <Suspense fallback={<div className="p-6 text-center text-slate-400">…</div>}>
          <Routes>
            <Route path="/u/:token" element={<UploadPage />} />
            <Route path="/*" element={<AppRoot />} />
          </Routes>
        </Suspense>
      </Router>
    </StrictMode>,
  );
}

if (DEMO) void import('./demo/backend').then((m) => (m.installDemoBackend(), start()));
else start();
