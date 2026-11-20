import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { isQuietTime, todayBs } from '@karsathi/shared';
import { ComplianceTask, MessageLog, Reminder } from '../src/models';
import { setProviderOverride, type MessageProvider, type OutgoingMessage } from '../src/services/messaging';
import { dispatchDueReminders, MAX_ATTEMPTS } from '../src/services/reminders';
import { agent, clientBody, JPEG, PNG, PDF, signup } from './helpers';

class FakeProvider implements MessageProvider {
  name = 'console' as const;
  channel = 'console' as const;
  sent: OutgoingMessage[] = [];
  fail = false;
  async send(m: OutgoingMessage) {
    if (this.fail) return { ok: false, error: 'gateway down' };
    this.sent.push(m);
    return { ok: true };
  }
}

let provider: FakeProvider;
beforeEach(() => {
  provider = new FakeProvider();
  setProviderOverride(provider);
});
afterEach(() => setProviderOverride(null));

async function makeExcel(n: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Clients');
  ws.addRow(['Business Name', 'Owner Name', 'Mobile', 'PAN No', 'VAT', 'TDS', 'Municipality']);
  for (let i = 0; i < n; i++) {
    ws.addRow([`Pasal ${i}`, `Owner ${i}`, `98${String(10000000 + i)}`, String(300000000 + i), i % 2 ? 'Yes' : 'No', i % 3 ? 'No' : 'Yes', 'Kathmandu']);
  }
  ws.addRow(['Bad Row', 'X', '12345', '12', 'Yes', 'No', '']); // invalid
  ws.addRow(['Dup Row', 'Y', '9800000001', String(300000000), 'Yes', 'No', '']); // duplicate PAN
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('end-to-end MVP flow', () => {
  it('imports 50 clients from Excel and generates VAT/TDS tasks for the current BS month', async () => {
    const a = await signup('import@example.com');
    const parsed = (await a.post('/api/clients/import/parse').attach('file', await makeExcel(50), 'clients.xlsx')).body;
    expect(parsed.rows).toHaveLength(52);
    expect(parsed.suggestedMapping.phone).toBe('Mobile');

    const dry = (await a.post('/api/clients/import').send({ rows: parsed.rows, mapping: parsed.suggestedMapping, dryRun: true })).body;
    expect(dry.summary).toMatchObject({ total: 52, valid: 50, errors: 1, duplicates: 1, imported: 0 });
    const bad = dry.report.find((r: { status: string }) => r.status === 'error');
    expect(bad.row).toBe(52);
    expect(bad.errors.map((e: { field: string }) => e.field).sort()).toEqual(['pan', 'phone']);

    const done = (await a.post('/api/clients/import').send({ rows: parsed.rows, mapping: parsed.suggestedMapping, dryRun: false })).body;
    expect(done.summary.imported).toBe(50);
    expect((await a.get('/api/clients')).body).toHaveLength(50);

    const tasks = (await a.get('/api/tasks')).body as { ruleId: string; dueDateBs: string; periodLabel: string }[];
    const vat = tasks.filter((t) => t.ruleId === 'vat_monthly');
    const tds = tasks.filter((t) => t.ruleId === 'tds_monthly');
    expect(vat).toHaveLength(25 * 2); // 25 VAT clients × (current + next)
    expect(tds).toHaveLength(17 * 2);
    // Every VAT due date is day 25 of a BS month, on or after today.
    const t = todayBs();
    const todayStr = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    for (const x of vat) {
      expect(x.dueDateBs.endsWith('-25')).toBe(true);
      expect(x.dueDateBs >= todayStr).toBe(true);
    }
    // Re-import is idempotent: everything is a duplicate now.
    const again = (await a.post('/api/clients/import').send({ rows: parsed.rows, mapping: parsed.suggestedMapping, dryRun: true })).body;
    expect(again.summary.valid).toBe(0);
  });

  it('schedules reminders outside quiet hours, sends via provider, retries, and stops after upload', async () => {
    const a = await signup('remind@example.com');
    const client = (await a.post('/api/clients').send(clientBody({ ownerName: 'Hari', vatRegistered: true }))).body;
    const tasks = (await a.get(`/api/tasks?clientId=${client._id}`)).body;
    const vatTask = tasks.find((t: { ruleId: string }) => t.ruleId === 'vat_monthly');

    const reminders = await Reminder.find({ firmId: vatTask.firmId, taskId: vatTask._id }).sort({ scheduledFor: 1 }).lean();
    expect(reminders.length).toBeGreaterThan(0);
    for (const r of reminders) expect(isQuietTime(r.scheduledFor)).toBe(false);

    // Time-travel to the first reminder → message goes out in Nepali with an upload link.
    const first = reminders[0];
    expect(await dispatchDueReminders(first.scheduledFor)).toBeGreaterThanOrEqual(1);
    const msg = provider.sent.find((m) => m.to === client.phone)!;
    expect(msg.body).toContain('नमस्ते Hari जी');
    expect(msg.body).toMatch(/\/u\/[A-Za-z0-9]{12}/);
    expect((await Reminder.findOne({ firmId: first.firmId, _id: first._id }).lean())!.status).toBe('sent');
    const logs = (await a.get(`/api/messages?clientId=${client._id}`)).body;
    expect(logs[0]).toMatchObject({ status: 'sent', encoding: 'UCS-2' });

    // A failing gateway retries with backoff, then gives up after MAX_ATTEMPTS.
    if (reminders[1]) {
      provider.fail = true;
      let now = reminders[1].scheduledFor;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await dispatchDueReminders(now);
        const r = (await Reminder.findOne({ firmId: first.firmId, _id: reminders[1]._id }).lean())!;
        expect(r.attempt).toBe(i + 1);
        if (i < MAX_ATTEMPTS - 1) {
          expect(r.status).toBe('scheduled');
          now = r.scheduledFor;
        } else expect(r.status).toBe('failed');
      }
      provider.fail = false;
    }

    // Client uploads 3 photos → task docs_received, reminders cancelled, notification created.
    const link = (await a.post(`/api/tasks/${vatTask._id}/upload-link`)).body.url as string;
    const token = link.split('/u/')[1];
    const pub = agent();
    const info = (await pub.get(`/api/public/u/${token}`)).body;
    expect(info.client.businessName).toBe(client.businessName);
    expect(info.task.periodLabel).toBe(vatTask.periodLabel);

    await pub
      .post(`/api/public/u/${token}/files`)
      .attach('files', JPEG, 'bill1.jpg')
      .attach('files', PNG, 'bill2.png')
      .attach('files', PDF, 'bill3.pdf')
      .expect(201);

    const after = await ComplianceTask.findOne({ firmId: vatTask.firmId, _id: vatTask._id }).lean();
    expect(after!.status).toBe('docs_received');
    const pending = await Reminder.countDocuments({ firmId: vatTask.firmId, taskId: vatTask._id, status: 'scheduled' });
    expect(pending).toBe(0);

    const before = provider.sent.length;
    const last = reminders[reminders.length - 1].scheduledFor;
    await dispatchDueReminders(new Date(last.getTime() + 60_000));
    expect(provider.sent.filter((m) => m.to === client.phone).length).toBe(provider.sent.slice(0, before).filter((m) => m.to === client.phone).length);

    const detail = (await a.get(`/api/clients/${client._id}`)).body;
    expect(detail.documents).toHaveLength(3);
    const notes = (await a.get('/api/notifications')).body;
    expect(notes.unread).toBe(1);

    const url = (await a.get(`/api/documents/${detail.documents[0]._id}/url`)).body.url as string;
    const fileRes = await agent().get(url.replace(/^https?:\/\/[^/]+/, ''));
    expect(fileRes.status).toBe(200);

    const zip = await a.get(`/api/clients/${client._id}/documents.zip`).buffer(true);
    expect(zip.status).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(MessageLog).toBeDefined();
  });

  it('rejects files that are not really JPG/PNG/PDF (magic bytes)', async () => {
    const a = await signup('magic@example.com');
    const client = (await a.post('/api/clients').send(clientBody())).body;
    const task = (await a.get(`/api/tasks?clientId=${client._id}`)).body[0];
    const token = ((await a.post(`/api/tasks/${task._id}/upload-link`)).body.url as string).split('/u/')[1];
    const res = await agent().post(`/api/public/u/${token}/files`).attach('files', Buffer.from('MZ fake exe'), 'bill.jpg');
    expect(res.status).toBe(415);
    expect((await agent().get('/api/public/u/doesnotexist123')).status).toBe(404);
  });

  it('marking filed stops reminders; bulk mark works', async () => {
    const a = await signup('bulk@example.com');
    const client = (await a.post('/api/clients').send(clientBody({ deductsTds: true }))).body;
    const tasks = (await a.get(`/api/tasks?clientId=${client._id}`)).body;
    const ids = tasks.map((t: { _id: string }) => t._id);
    expect((await a.post('/api/tasks/bulk-status').send({ ids, status: 'filed' })).body.updated).toBe(ids.length);
    expect(await Reminder.countDocuments({ firmId: tasks[0].firmId, status: 'scheduled' })).toBe(0);
  });

  it('template editing and preview with segment count', async () => {
    const a = await signup('tpl@example.com');
    await a.put('/api/templates/reminder/en').send({ body: 'Hi {clientName}, send {period} bills: {uploadLink}' }).expect(200);
    const list = (await a.get('/api/templates')).body.templates;
    expect(list.find((t: { type: string; language: string }) => t.type === 'reminder' && t.language === 'en').isDefault).toBe(false);
    const prev = (await a.post('/api/templates/preview').send({ body: 'नमस्ते {clientName}' })).body;
    expect(prev).toMatchObject({ encoding: 'UCS-2', segments: 1 });
  });
});
