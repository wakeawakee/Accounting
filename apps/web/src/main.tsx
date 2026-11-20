import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';

// Code-split: the public upload page never loads the dashboard bundle.
const UploadPage = lazy(() => import('./pages/UploadPage'));
const AppRoot = lazy(() => import('./AppRoot'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="p-6 text-center text-slate-400">…</div>}>
        <Routes>
          <Route path="/u/:token" element={<UploadPage />} />
          <Route path="/*" element={<AppRoot />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
