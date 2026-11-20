export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '';

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'karsathi' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'include' });
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : undefined;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data as T;
}

export const apiBase = BASE;
