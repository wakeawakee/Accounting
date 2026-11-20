import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { TenantScopeError } from '../src/db/tenantPlugin';
import { Client, ComplianceTask, DocumentUpload, Firm } from '../src/models';
import { agent, clientBody, PDF, signup } from './helpers';

describe('tenancy isolation', () => {
  it('the tenant plugin rejects queries without firmId', async () => {
    await expect(Client.find({}).lean()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Client.findById(new Types.ObjectId()).lean()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(ComplianceTask.updateMany({ status: 'pending' }, { $set: { status: 'filed' } })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Client.countDocuments({})).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Client.aggregate([{ $match: {} }])).rejects.toBeInstanceOf(TenantScopeError);
    // Explicit opt-out works (used by background jobs only)
    await expect(Client.find({}).setOptions({ crossTenant: true }).lean()).resolves.toEqual([]);
  });

  it('firm A cannot see, edit or access firm B data through the API', async () => {
    const a = await signup('a@example.com');
    const b = await signup('b@example.com');

    const bClient = (await b.post('/api/clients').send(clientBody())).body;
    expect(bClient._id).toBeTruthy();
    const bTasks = (await b.get('/api/tasks')).body;
    expect(bTasks.length).toBeGreaterThan(0);

    // Lists are scoped
    expect((await a.get('/api/clients')).body).toEqual([]);
    expect((await a.get('/api/tasks')).body).toEqual([]);
    expect((await a.get('/api/tasks/dashboard')).body.counts).toEqual({ dueThisWeek: 0, docsPending: 0, docsReceived: 0, missed: 0 });

    // Direct access by id → 404
    expect((await a.get(`/api/clients/${bClient._id}`)).status).toBe(404);
    expect((await a.patch(`/api/clients/${bClient._id}`).send({ businessName: 'hacked' })).status).toBe(404);
    expect((await a.get(`/api/clients/${bClient._id}/documents.zip`)).status).toBe(404);
    expect((await a.patch(`/api/tasks/${bTasks[0]._id}`).send({ status: 'filed' })).status).toBe(404);
    expect((await a.post(`/api/tasks/${bTasks[0]._id}/upload-link`)).status).toBe(404);
    expect((await a.post('/api/tasks/bulk-status').send({ ids: [bTasks[0]._id], status: 'filed' })).body.updated).toBe(0);
    // Filtering by another firm's client id returns nothing
    expect((await a.get(`/api/tasks?clientId=${bClient._id}`)).body).toEqual([]);

    // B's task untouched
    const after = (await b.get(`/api/clients/${bClient._id}`)).body;
    expect(after.client.businessName).toBe(bClient.businessName);
    expect(after.tasks.every((t: { status: string }) => t.status === 'pending')).toBe(true);

    // Documents of B not reachable by A
    const link = (await b.post(`/api/tasks/${bTasks[0]._id}/upload-link`)).body.url as string;
    const token = link.split('/u/')[1];
    await agent().post(`/api/public/u/${token}/files`).attach('files', PDF, 'bill.pdf').expect(201);
    const firmB = await Firm.findOne({ contactEmail: 'b@example.com' }).lean();
    const doc = await DocumentUpload.findOne({ firmId: firmB!._id }).lean();
    expect((await a.get(`/api/documents/${doc!._id}/url`)).status).toBe(404);
    expect((await b.get(`/api/documents/${doc!._id}/url`)).status).toBe(200);
  });

  it('same PAN is allowed in different firms but not twice in one firm', async () => {
    const a = await signup('a2@example.com');
    const b = await signup('b2@example.com');
    const body = clientBody();
    expect((await a.post('/api/clients').send(body)).status).toBe(201);
    expect((await b.post('/api/clients').send(body)).status).toBe(201);
    expect((await a.post('/api/clients').send(body)).status).toBe(409);
  });

  it('staff only see clients assigned to them', async () => {
    const owner = await signup('owner@example.com');
    const staff = (await owner.post('/api/firm/users').send({ name: 'Sita', email: 'sita@example.com', password: 'password123' })).body;
    const c1 = (await owner.post('/api/clients').send(clientBody({ assignedStaffId: staff._id }))).body;
    await owner.post('/api/clients').send(clientBody());

    const s = agent();
    await s.post('/api/auth/login').send({ email: 'sita@example.com', password: 'password123' }).expect(200);
    const list = (await s.get('/api/clients')).body;
    expect(list.map((c: { _id: string }) => c._id)).toEqual([c1._id]);
    const tasks = (await s.get('/api/tasks')).body;
    expect(tasks.every((t: { clientId: string }) => t.clientId === c1._id)).toBe(true);
    expect((await s.patch('/api/firm').send({ name: 'x' })).status).toBe(403);
  });

  it('requires auth and the CSRF header', async () => {
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers');
    expect((await request(app).get('/api/clients')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'x@y.z', password: 'p' })).status).toBe(403);
  });
});

describe('staff cannot reach unassigned clients via filters', () => {
  it('ignores clientId filter for clients not assigned to the staff member', async () => {
    const owner = await signup('owner3@example.com');
    await owner.post('/api/firm/users').send({ name: 'Gita', email: 'gita@example.com', password: 'password123' });
    const other = (await owner.post('/api/clients').send(clientBody())).body;
    const s = agent();
    await s.post('/api/auth/login').send({ email: 'gita@example.com', password: 'password123' }).expect(200);
    expect((await s.get(`/api/tasks?clientId=${other._id}`)).body).toEqual([]);
    expect((await s.get(`/api/clients/${other._id}`)).status).toBe(404);
  });
});
