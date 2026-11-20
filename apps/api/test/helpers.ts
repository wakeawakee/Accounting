import request from 'supertest';
import { createApp } from '../src/app';

export const app = createApp();

/** A supertest agent that keeps cookies and sends the CSRF header. */
export function agent() {
  const a = request.agent(app);
  const wrap = (m: 'get' | 'post' | 'patch' | 'put' | 'delete') => (url: string) => a[m](url).set('X-Requested-With', 'karsathi');
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch'), put: wrap('put'), delete: wrap('delete') };
}

export async function signup(email: string, firmName = 'Firm ' + email) {
  const a = agent();
  const r = await a.post('/api/auth/signup').send({ firmName, name: 'Owner', email, password: 'password123' });
  if (r.status !== 201) throw new Error('signup failed: ' + JSON.stringify(r.body));
  return a;
}

let panSeq = 100000000;
export function clientBody(over: Record<string, unknown> = {}) {
  panSeq++;
  return {
    businessName: 'Shop ' + panSeq,
    ownerName: 'Ram',
    phone: '98' + String(panSeq).slice(-8),
    pan: String(panSeq),
    vatRegistered: true,
    deductsTds: false,
    preferredLanguage: 'ne',
    ...over,
  };
}

// Minimal valid file headers
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
export const PDF = Buffer.from('%PDF-1.4\n% test\n');
