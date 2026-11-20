/** True only in the browser-only demo build (VITE_DEMO=1). */
export const DEMO = import.meta.env.VITE_DEMO === '1';
/** Supabase-backed build (GitHub Pages). */
export const SUPABASE = !DEMO && !!import.meta.env.VITE_SUPABASE_URL;
/** Static hosting: no API server, hash URLs (#/clients). */
export const STATIC_HOST = DEMO || SUPABASE || import.meta.env.VITE_STATIC === '1';
