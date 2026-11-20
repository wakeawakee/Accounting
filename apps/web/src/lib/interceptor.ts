/**
 * For static hosting (GitHub Pages) there is no API server: the pages still call
 * api('/clients') etc., and this interceptor answers those calls in the browser,
 * either from the demo store or from Supabase.
 */
export class HttpErr extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export type Handler = (method: string, path: string, body: any) => Promise<unknown>;

export function installBackend(handle: Handler, afterMutation?: () => void) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const i = url.indexOf('/api/');
    if (i === -1) return realFetch(input, init);
    const path = url.slice(i + 4);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* leave as string */
      }
    }
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data ?? null), { status, headers: { 'content-type': 'application/json' } });
    try {
      const data = await handle(method, path, body);
      if (method !== 'GET') afterMutation?.();
      return json(200, data);
    } catch (e) {
      if (e instanceof HttpErr) return json(e.status, { error: e.message, details: e.details });
      console.error(e);
      return json(500, { error: (e as Error)?.message || 'Something went wrong' });
    }
  };
}

/** Matches "/clients/:id" style patterns against a path split into segments. */
export function matcher(method: string, path: string) {
  const [p, qs] = path.split('?');
  const seg = p.split('/').filter(Boolean);
  const is = (m: string, pattern: string) => {
    if (m !== method) return false;
    const ps = pattern.split('/').filter(Boolean);
    return ps.length === seg.length && ps.every((x, i) => x.startsWith(':') || x === seg[i]);
  };
  return { seg, q: new URLSearchParams(qs ?? ''), is };
}

/** Reads the first bytes to check a file really is JPG / PNG / PDF. */
export async function sniffMime(blob: Blob): Promise<'image/jpeg' | 'image/png' | 'application/pdf' | null> {
  const b = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';
  return null;
}
