/**
 * Supabase data layer for the static (GitHub Pages) build.
 *
 * The pages call api('/clients') etc. exactly as with the Express API; this
 * module answers those calls using Supabase. Security does NOT rely on this
 * code: Row Level Security in supabase/schema.sql decides what each user can
 * read or write. Reminders are sent by the database (pg_cron), not the browser.
 */
import { createClient } from '@supabase/supabase-js';
import {
  CLIENT_IMPORT_FIELDS,
  DEFAULT_TEMPLATES,
  RULE_SETS,
  SAMPLE_TEMPLATE_VARS,
  TEMPLATE_TYPES,
  addDaysAd,
  clientInputSchema,
  computeReminderTimes,
  customRuleSchema,
  fiscalYearOf,
  formatBsLong,
  generateTasks,
  getRuleSet,
  parseBs,
  renderTemplate,
  smsSegments,
  suggestColumnMapping,
  todayAdInKathmandu,
  todayBs,
  type ComplianceRule,
  type Language,
  type TemplateType,
} from '@karsathi/shared';
import { HttpErr, installBackend, matcher, sniffMime } from '../lib/interceptor';
import { readSpreadsheet } from '../lib/sheet';

type Row = Record<string, any>;

const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
const BUCKET = 'documents';
const appUrl = () => `${location.origin}${location.pathname}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string; code?: string } | null }, status = 400): any {
  if (res.error) {
    const msg = res.error.code === '23505' ? 'Duplicate record (a client with this PAN may already exist)' : res.error.message;
    throw new HttpErr(status, msg);
  }
  return res.data;
}

const camelKey = (k: string) => (k === 'id' || k === 'user_id' ? '_id' : k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
function ui<T extends Row | null>(row: T): any {
  if (!row) return row;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[camelKey(k)] = v && typeof v === 'object' && !Array.isArray(v) && k === 'client' ? ui(v) : v;
  return out;
}
const uiAll = (rows: Row[] | null) => (rows ?? []).map(ui);

/** PostgREST returns max 1000 rows per request; page through. */
async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await build(from, from + 999)) ?? [];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

function clientToDb(c: Row) {
  const map: Record<string, string> = {
    businessName: 'business_name', ownerName: 'owner_name', phone: 'phone', pan: 'pan', vatRegistered: 'vat_registered',
    deductsTds: 'deducts_tds', municipality: 'municipality', preferredLanguage: 'preferred_language', active: 'active', assignedStaffId: 'assigned_staff_id',
  };
  const out: Row = {};
  for (const [k, col] of Object.entries(map)) if (c[k] !== undefined) out[col] = c[k] === '' && k === 'assignedStaffId' ? null : c[k];
  return out;
}

// ---------------------------------------------------------------------------
// Session / membership
// ---------------------------------------------------------------------------
interface Ctx {
  userId: string;
  firmId: string;
  role: 'owner' | 'staff';
  name: string;
  email: string;
}
let ctx: Ctx | null = null;

async function me(): Promise<Ctx> {
  if (ctx) return ctx;
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new HttpErr(401, 'Not signed in');
  let member = must(await sb.from('members').select('*').eq('user_id', user.id).maybeSingle());
  if (!member) {
    const meta = user.user_metadata ?? {};
    must(await sb.rpc('bootstrap', { p_firm_name: meta.firm_name ?? null, p_name: meta.name ?? null }));
    member = must(await sb.from('members').select('*').eq('user_id', user.id).maybeSingle());
  }
  if (!member || !member.active) {
    throw new HttpErr(403, 'This account is not part of a firm yet. Ask your firm owner to invite this email, then log in again.');
  }
  ctx = { userId: user.id, firmId: member.firm_id, role: member.role, name: member.name, email: member.email };
  if (ctx.role === 'owner') {
    // Upload links in SMS point to wherever the app is hosted.
    await sb.from('firms').update({ app_url: appUrl() }).eq('id', ctx.firmId).neq('app_url', appUrl());
    await sb.from('firms').update({ app_url: appUrl() }).eq('id', ctx.firmId).is('app_url', null);
  }
  return ctx;
}
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') ctx = null;
});

async function getFirm(): Promise<Row> {
  const c = await me();
  return must(await sb.from('firms').select('*').eq('id', c.firmId).single());
}

function publicFirm(f: Row) {
  return {
    id: f.id, name: f.name, contactPhone: f.contact_phone ?? '', contactEmail: f.contact_email ?? '', address: f.address ?? '',
    messageSenderName: f.message_sender_name ?? '', hasLogo: false, plan: f.plan, reminderOffsets: f.reminder_offsets, sendMinute: f.send_minute,
    quietHours: { start: f.quiet_start, end: f.quiet_end },
    messaging: { provider: f.messaging_provider, smsApiUrl: f.sms_api_url ?? '', smsSenderId: f.sms_sender_id ?? '', hasSmsToken: f.has_sms_token },
  };
}

// ---------------------------------------------------------------------------
// Tasks + reminders (generated in the browser by the shared rules engine)
// ---------------------------------------------------------------------------
async function loadCustomRules(): Promise<ComplianceRule[]> {
  const rows = must(await sb.from('custom_rules').select('*').eq('active', true));
  return rows.map((r: Row) => ({
    id: `custom_${r.id}`, custom: true, name: { en: r.name_en, ne: r.name_ne || r.name_en }, frequency: r.frequency, dueRule: r.due_rule, appliesTo: r.applies_to ?? {},
  }));
}

function reminderRows(tasks: Row[], firm: Row) {
  const rows: Row[] = [];
  for (const t of tasks) {
    if (t.status !== 'pending') continue;
    for (const r of computeReminderTimes({
      dueDateAd: t.due_date_ad,
      offsets: firm.reminder_offsets,
      sendMinute: firm.send_minute,
      quietHours: { start: firm.quiet_start, end: firm.quiet_end },
    })) {
      rows.push({ firm_id: t.firm_id, task_id: t.id, client_id: t.client_id, offset_days: r.offset, scheduled_for: r.at.toISOString() });
    }
  }
  return rows;
}

async function insertChunks(table: string, rows: Row[], opts: { select?: string; ignoreDuplicates?: boolean; onConflict?: string } = {}) {
  const out: Row[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const q = opts.ignoreDuplicates
      ? sb.from(table).upsert(chunk, { onConflict: opts.onConflict, ignoreDuplicates: true })
      : sb.from(table).insert(chunk);
    out.push(...(must(opts.select ? await q.select(opts.select) : await q) ?? []));
  }
  return out;
}

/** Creates current + next period tasks for clients and schedules their reminders. Idempotent. */
async function ensureTasks(clients?: Row[]): Promise<number> {
  const c = await me();
  const firm = await getFirm();
  clients ??= await fetchAll((a, b) => sb.from('clients').select('*').eq('active', true).range(a, b));
  if (!clients.length) return 0;
  const customRules = await loadCustomRules();
  const today = todayBs();
  const drafts: Row[] = [];
  for (const cl of clients) {
    if (!cl.active) continue;
    for (const d of generateTasks({ client: { vatRegistered: cl.vat_registered, deductsTds: cl.deducts_tds }, today, customRules })) {
      const due = parseBs(d.dueDateBs);
      drafts.push({
        firm_id: c.firmId, client_id: cl.id, rule_id: d.ruleId, rule_name: d.ruleName, period_key: d.periodKey, period_label: d.periodLabel,
        period_label_ne: d.periodLabelNe, fiscal_year: d.fiscalYear, due_date_bs: d.dueDateBs, due_date_ad: d.dueDateAd,
        due_label_en: formatBsLong(due, 'en'), due_label_ne: formatBsLong(due, 'ne'), holiday_flag: d.holidayFlag, status: 'pending',
      });
    }
  }
  const inserted = await insertChunks('tasks', drafts, { select: '*', ignoreDuplicates: true, onConflict: 'firm_id,client_id,rule_id,period_key' });
  await insertChunks('reminders', reminderRows(inserted, firm));
  return inserted.length;
}

let lastMaintenance = 0;
async function maintenance() {
  if (Date.now() - lastMaintenance < 10 * 60_000) return;
  lastMaintenance = Date.now();
  // The database also does this every minute via pg_cron; this covers projects without pg_cron.
  await sb.from('tasks').update({ status: 'missed' }).eq('status', 'pending').lt('due_date_ad', todayAdInKathmandu());
  await ensureTasks();
}

async function rescheduleAll() {
  const firm = await getFirm();
  must(await sb.from('reminders').delete().eq('status', 'scheduled').gte('offset_days', 0));
  const pending = await fetchAll((a, b) => sb.from('tasks').select('*').eq('status', 'pending').range(a, b));
  await insertChunks('reminders', reminderRows(pending, firm));
}

async function setStatus(ids: string[], status: string) {
  const patch: Row = { status };
  if (status === 'filed') patch.filed_at = new Date().toISOString();
  if (status === 'docs_received') patch.docs_received_at = new Date().toISOString();
  const rows = must(await sb.from('tasks').update(patch).in('id', ids).select('id'));
  return rows.length;
}

const TASK_SELECT = '*, client:clients(id, business_name, owner_name, phone, assigned_staff_id)';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handle(method: string, path: string, body: any): Promise<unknown> {
  const { seg, q, is } = matcher(method, path);

  // ---- auth
  if (is('POST', '/auth/login')) {
    const r = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
    if (r.error) throw new HttpErr(401, r.error.message.includes('confirm') ? 'Please confirm your email first (check your inbox).' : 'Wrong email or password');
    ctx = null;
    await me();
    return { ok: true };
  }
  if (is('POST', '/auth/signup')) {
    const r = await sb.auth.signUp({
      email: body.email,
      password: body.password,
      options: { data: { firm_name: body.firmName, name: body.name }, emailRedirectTo: appUrl() },
    });
    if (r.error) throw new HttpErr(400, r.error.message);
    if (!r.data.session) {
      throw new HttpErr(400, `Account created. Open the confirmation email sent to ${body.email}, then come back and log in.`);
    }
    ctx = null;
    await me();
    return { ok: true };
  }
  if (is('POST', '/auth/logout')) {
    await sb.auth.signOut();
    ctx = null;
    return { ok: true };
  }

  // ---- public upload page (client is not signed in)
  if (seg[0] === 'public' && seg[1] === 'u') {
    const token = seg[2];
    const info = await sb.rpc('get_upload_info', { p_token: token });
    if (info.error) throw new HttpErr(info.error.message.includes('expired') ? 410 : 404, info.error.message.includes('expired') ? info.error.message : 'Link not found');
    if (is('GET', '/public/u/:t')) return info.data;
    if (is('POST', '/public/u/:t/files')) {
      const form = body as FormData;
      const files = form.getAll('files') as File[];
      if (!files.length) throw new HttpErr(400, 'No files received');
      const checked = [];
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) throw new HttpErr(400, 'File too large (max 10 MB)');
        const mime = await sniffMime(f);
        if (!mime) throw new HttpErr(415, `"${f.name}" is not a JPG, PNG or PDF`);
        checked.push({ f, mime });
      }
      const uploaded = [];
      for (const { f, mime } of checked) {
        const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
        const filePath = `${info.data.uploadPrefix}${crypto.randomUUID()}.${ext}`;
        must(await sb.storage.from(BUCKET).upload(filePath, f, { contentType: mime, upsert: false }) as any);
        uploaded.push({ path: filePath, name: f.name, mime, size: f.size });
      }
      const note = form.get('note');
      const n = must(await sb.rpc('register_uploads', { p_token: token, p_files: uploaded, p_note: note ? String(note) : null }));
      return { uploaded: n };
    }
  }

  const c = await me();

  if (is('GET', '/auth/me')) {
    const firm = await getFirm();
    return { user: { id: c.userId, name: c.name, email: c.email, role: c.role }, firm: { id: firm.id, name: firm.name, hasLogo: false } };
  }

  // ---- firm & staff
  if (is('GET', '/firm')) return publicFirm(await getFirm());
  if (is('PATCH', '/firm')) {
    if (c.role !== 'owner') throw new HttpErr(403, 'Only the firm owner can change settings');
    const before = await getFirm();
    const patch: Row = {};
    const map: Record<string, string> = { name: 'name', contactPhone: 'contact_phone', contactEmail: 'contact_email', address: 'address', messageSenderName: 'message_sender_name', reminderOffsets: 'reminder_offsets', sendMinute: 'send_minute' };
    for (const [k, col] of Object.entries(map)) if (body[k] !== undefined) patch[col] = body[k];
    if (body.quietHours) Object.assign(patch, { quiet_start: body.quietHours.start, quiet_end: body.quietHours.end });
    if (body.messaging) {
      Object.assign(patch, { messaging_provider: body.messaging.provider, sms_api_url: body.messaging.smsApiUrl ?? '', sms_sender_id: body.messaging.smsSenderId ?? '' });
      if (body.messaging.smsToken) must(await sb.rpc('set_sms_token', { p_token: body.messaging.smsToken }));
    }
    const after = must(await sb.from('firms').update(patch).eq('id', c.firmId).select('*').single());
    if (
      JSON.stringify(before.reminder_offsets) !== JSON.stringify(after.reminder_offsets) ||
      before.send_minute !== after.send_minute || before.quiet_start !== after.quiet_start || before.quiet_end !== after.quiet_end
    ) await rescheduleAll();
    return publicFirm(after);
  }
  if (is('POST', '/firm/logo')) throw new HttpErr(501, 'Logo upload is not available yet in this version.');
  if (is('GET', '/firm/users')) {
    const members = uiAll(must(await sb.from('members').select('*').order('created_at')));
    const invites = c.role === 'owner' ? must(await sb.from('invites').select('*')) : [];
    return [...members, ...invites.map((i: Row) => ({ _id: `invite:${i.id}`, name: `${i.name} (invited)`, email: i.email, role: 'staff', active: true }))];
  }
  if (is('POST', '/firm/users')) {
    const inv = must(await sb.from('invites').insert({ firm_id: c.firmId, email: String(body.email).toLowerCase(), name: body.name }).select('*').single());
    return { _id: `invite:${inv.id}`, name: inv.name, email: inv.email, role: 'staff', active: true };
  }
  if (is('DELETE', '/firm/users/:id')) {
    const target = seg[2];
    if (target.startsWith('invite:')) must(await sb.from('invites').delete().eq('id', target.slice(7)));
    else {
      if (target === c.userId) throw new HttpErr(400, 'You cannot remove yourself');
      must(await sb.from('members').update({ active: false }).eq('user_id', target));
      must(await sb.from('clients').update({ assigned_staff_id: null }).eq('assigned_staff_id', target));
    }
    return { ok: true };
  }

  // ---- clients
  if (is('GET', '/clients')) {
    let query = sb.from('clients').select('*').eq('active', true).order('business_name');
    const s = (q.get('q') ?? '').replace(/[,()%*]/g, ' ').trim();
    if (s) query = query.or(['business_name', 'owner_name', 'phone', 'pan'].map((col) => `${col}.ilike.%${s}%`).join(','));
    return uiAll(must(await query.limit(1000)));
  }
  if (is('POST', '/clients/import/parse')) {
    const file = (body as FormData).get('file') as File;
    if (!file) throw new HttpErr(400, 'No file uploaded');
    const { headers, rows } = await readSpreadsheet(file).catch((e) => {
      throw new HttpErr(400, e.message);
    });
    return { headers, rows, suggestedMapping: suggestColumnMapping(headers), fields: CLIENT_IMPORT_FIELDS };
  }
  if (is('POST', '/clients/import')) {
    const existing = await fetchAll((a, b) => sb.from('clients').select('pan, phone').range(a, b));
    const pans = new Set(existing.map((x) => x.pan));
    const phones = new Set(existing.map((x) => x.phone));
    const seen = new Map<string, number>();
    const report = (body.rows as Row[]).map((raw, i) => {
      const rowNum = i + 2;
      const input: Row = {};
      for (const f of CLIENT_IMPORT_FIELDS) if (body.mapping[f]) input[f] = raw[body.mapping[f]] ?? '';
      const r = clientInputSchema.safeParse(input);
      if (!r.success) {
        return { row: rowNum, status: 'error', errors: Object.entries(r.error.flatten().fieldErrors).map(([field, m]) => ({ field, message: (m ?? []).join(', ') })), warnings: [] as string[] };
      }
      const warnings = phones.has(r.data.phone) ? ['Phone already used by another client'] : [];
      if (pans.has(r.data.pan)) return { row: rowNum, status: 'duplicate', errors: [{ field: 'pan', message: 'A client with this PAN already exists' }], warnings, data: r.data };
      if (seen.has(r.data.pan)) return { row: rowNum, status: 'duplicate', errors: [{ field: 'pan', message: `Same PAN as row ${seen.get(r.data.pan)}` }], warnings, data: r.data };
      seen.set(r.data.pan, rowNum);
      return { row: rowNum, status: 'valid', errors: [], warnings, data: r.data };
    });
    const summary = {
      total: report.length,
      valid: report.filter((r) => r.status === 'valid').length,
      errors: report.filter((r) => r.status === 'error').length,
      duplicates: report.filter((r) => r.status === 'duplicate').length,
      imported: 0,
      tasksCreated: 0,
    };
    if (!body.dryRun) {
      const rows = report
        .filter((r) => r.status === 'valid' && r.data)
        .map((r) => ({ ...clientToDb({ ...r.data, assignedStaffId: undefined }), firm_id: c.firmId, assigned_staff_id: c.role === 'staff' ? c.userId : null }));
      const inserted = await insertChunks('clients', rows, { select: '*' });
      summary.imported = inserted.length;
      summary.tasksCreated = await ensureTasks(inserted);
    }
    return { summary, report: report.map(({ data, ...r }: Row) => ({ ...r, businessName: data?.businessName })) };
  }
  if (is('POST', '/clients')) {
    const r = clientInputSchema.safeParse(body);
    if (!r.success) throw new HttpErr(400, 'Validation failed', r.error.flatten());
    const row = { ...clientToDb(r.data), firm_id: c.firmId, assigned_staff_id: c.role === 'staff' ? c.userId : r.data.assignedStaffId || null };
    const res = await sb.from('clients').insert(row).select('*').single();
    if (res.error?.code === '23505') throw new HttpErr(409, 'A client with this PAN already exists');
    const client = must(res);
    await ensureTasks([client]);
    return ui(client);
  }
  if (is('GET', '/clients/:id')) {
    const client = must(await sb.from('clients').select('*').eq('id', seg[1]).maybeSingle());
    if (!client) throw new HttpErr(404, 'Client not found');
    const [tasks, documents, messages] = await Promise.all([
      sb.from('tasks').select('*').eq('client_id', client.id).order('due_date_ad', { ascending: false }).limit(200),
      sb.from('documents').select('*').eq('client_id', client.id).order('uploaded_at', { ascending: false }).limit(500),
      sb.from('message_log').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(200),
    ]);
    return { client: ui(client), tasks: uiAll(must(tasks)), documents: uiAll(must(documents)), messages: uiAll(must(messages)) };
  }
  if (is('PATCH', '/clients/:id')) {
    const r = clientInputSchema.partial().safeParse(body);
    if (!r.success) throw new HttpErr(400, 'Validation failed', r.error.flatten());
    const patch = clientToDb(r.data);
    if (c.role !== 'owner') delete patch.assigned_staff_id;
    const res = await sb.from('clients').update(patch).eq('id', seg[1]).select('*').maybeSingle();
    if (res.error?.code === '23505') throw new HttpErr(409, 'A client with this PAN already exists');
    const client = must(res);
    if (!client) throw new HttpErr(404, 'Client not found');
    if (client.active) await ensureTasks([client]);
    else must(await sb.from('reminders').update({ status: 'cancelled' }).eq('client_id', client.id).eq('status', 'scheduled'));
    return ui(client);
  }

  // ---- tasks
  if (is('GET', '/tasks/dashboard')) {
    await maintenance();
    const today = todayAdInKathmandu();
    const week = addDaysAd(today, 7);
    const month = addDaysAd(today, 30);
    const ts = uiAll(await fetchAll((a, b) => sb.from('tasks').select(TASK_SELECT).in('status', ['pending', 'docs_received', 'missed']).order('due_date_ad').range(a, b)));
    const rank = (s: string) => (s === 'missed' ? 0 : s === 'pending' ? 1 : 2);
    return {
      today,
      counts: {
        dueThisWeek: ts.filter((t) => ['pending', 'docs_received'].includes(t.status) && t.dueDateAd >= today && t.dueDateAd <= week).length,
        docsPending: ts.filter((t) => t.status === 'pending' && t.dueDateAd >= today).length,
        docsReceived: ts.filter((t) => t.status === 'docs_received').length,
        missed: ts.filter((t) => t.status === 'missed').length,
      },
      tasks: ts.filter((t) => t.dueDateAd <= month).sort((a, b) => rank(a.status) - rank(b.status) || a.dueDateAd.localeCompare(b.dueDateAd)),
    };
  }
  if (is('GET', '/tasks')) {
    await maintenance();
    let staffClients: string[] | null = null;
    if (q.get('staffId')) {
      const sid = q.get('staffId');
      const qb = sb.from('clients').select('id');
      const ids: string[] = must(await (sid === 'none' ? qb.is('assigned_staff_id', null) : qb.eq('assigned_staff_id', sid!))).map((x: Row) => x.id);
      if (!ids.length) return [];
      staffClients = ids;
    }
    const rows = await fetchAll((a, b) => {
      let query = sb.from('tasks').select(TASK_SELECT).order('due_date_ad');
      if (q.get('status')) query = query.in('status', q.get('status')!.split(','));
      if (q.get('ruleId')) query = query.eq('rule_id', q.get('ruleId')!);
      if (q.get('periodKey')) query = query.eq('period_key', q.get('periodKey')!);
      if (q.get('clientId')) query = query.eq('client_id', q.get('clientId')!);
      if (q.get('fromAd')) query = query.gte('due_date_ad', q.get('fromAd')!);
      if (q.get('toAd')) query = query.lte('due_date_ad', q.get('toAd')!);
      if (staffClients) query = query.in('client_id', staffClients);
      return query.range(a, b);
    });
    return uiAll(rows);
  }
  if (is('PATCH', '/tasks/:id')) {
    if (!(await setStatus([seg[1]], body.status))) throw new HttpErr(404, 'Task not found');
    return ui(must(await sb.from('tasks').select('*').eq('id', seg[1]).single()));
  }
  if (is('POST', '/tasks/bulk-status')) return { updated: await setStatus(body.ids, body.status) };
  if (is('POST', '/tasks/generate')) {
    lastMaintenance = 0;
    return { created: await ensureTasks() };
  }
  if (is('POST', '/tasks/:id/upload-link')) {
    const token = must(await sb.rpc('get_upload_token', { p_task: seg[1] }), 404) as string;
    return { url: `${appUrl()}#/u/${token}`, token };
  }
  if (is('POST', '/tasks/:id/remind-now')) {
    const t = must(await sb.from('tasks').select('*').eq('id', seg[1]).maybeSingle());
    if (!t) throw new HttpErr(404, 'Task not found');
    // Queued for the database dispatcher, which sends within a minute (outside quiet hours).
    must(await sb.from('reminders').insert({ firm_id: t.firm_id, task_id: t.id, client_id: t.client_id, offset_days: -1, scheduled_for: new Date().toISOString() }));
    return { ok: true };
  }

  // ---- rules
  if (is('GET', '/rules')) {
    const fy = fiscalYearOf(todayBs());
    return { currentFiscalYear: fy, ruleSet: getRuleSet(fy), availableFiscalYears: RULE_SETS.map((s) => s.fiscalYear), custom: uiAll(must(await sb.from('custom_rules').select('*').order('created_at'))) };
  }
  if (is('POST', '/rules/custom')) {
    const r = customRuleSchema.safeParse(body);
    if (!r.success) throw new HttpErr(400, 'Validation failed', r.error.flatten());
    const rule = must(await sb.from('custom_rules').insert({
      firm_id: c.firmId, name_en: r.data.nameEn, name_ne: r.data.nameNe, frequency: r.data.frequency, due_rule: r.data.dueRule,
      applies_to: r.data.appliesTo, notes: r.data.notes, active: r.data.active,
    }).select('*').single());
    lastMaintenance = 0;
    await ensureTasks();
    return ui(rule);
  }
  if (is('PATCH', '/rules/custom/:id')) {
    const rule = must(await sb.from('custom_rules').update({ active: body.active }).eq('id', seg[2]).select('*').single());
    if (rule.active) await ensureTasks();
    return ui(rule);
  }

  // ---- templates
  if (is('GET', '/templates')) {
    const overrides = must(await sb.from('templates').select('*'));
    const templates = [];
    for (const type of TEMPLATE_TYPES) {
      for (const language of ['ne', 'en'] as Language[]) {
        const o = overrides.find((x: Row) => x.type === type && x.language === language);
        templates.push({ type, language, body: o?.body ?? DEFAULT_TEMPLATES[type][language], isDefault: !o, defaultBody: DEFAULT_TEMPLATES[type][language] });
      }
    }
    return { templates, sampleVars: SAMPLE_TEMPLATE_VARS };
  }
  if (is('PUT', '/templates/:type/:lang')) {
    const [type, language] = [seg[1] as TemplateType, seg[2] as Language];
    if (body.body === DEFAULT_TEMPLATES[type][language]) must(await sb.from('templates').delete().match({ type, language }));
    else must(await sb.from('templates').upsert({ firm_id: c.firmId, type, language, body: body.body }));
    return { ok: true };
  }
  if (is('POST', '/templates/preview')) {
    const text = renderTemplate(String(body.body ?? ''), SAMPLE_TEMPLATE_VARS);
    return { text, ...smsSegments(text) };
  }

  // ---- messages, documents, notifications
  if (is('GET', '/messages/stats')) {
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const msgs = await fetchAll((a, b) => sb.from('message_log').select('created_at, status, segments, cost_estimate_npr').gte('created_at', since).range(a, b));
    const months = new Map<string, Row>();
    for (const m of msgs) {
      const k = new Date(new Date(m.created_at).getTime() + 345 * 60_000).toISOString().slice(0, 7);
      const r = months.get(k) ?? { _id: k, messages: 0, sent: 0, failed: 0, segments: 0, costNpr: 0 };
      r.messages++;
      if (m.status === 'failed') r.failed++;
      else r.sent++;
      r.segments += m.segments ?? 0;
      r.costNpr += Number(m.cost_estimate_npr ?? 0);
      months.set(k, r);
    }
    const firm = await getFirm();
    return { months: [...months.values()].sort((a, b) => b._id.localeCompare(a._id)), costPerSegmentNpr: Number(firm.sms_cost_per_segment), quota: firm.plan?.monthlyMessageQuota ?? null };
  }
  if (is('GET', '/messages')) {
    let query = sb.from('message_log').select('*').order('created_at', { ascending: false }).limit(300);
    if (q.get('clientId')) query = query.eq('client_id', q.get('clientId')!);
    return uiAll(must(await query));
  }
  if (is('GET', '/documents/:id/url')) {
    const doc = must(await sb.from('documents').select('*').eq('id', seg[1]).maybeSingle());
    if (!doc) throw new HttpErr(404, 'Document not found');
    const signed = must(await sb.storage.from(BUCKET).createSignedUrl(doc.file_path, 300) as any) as { signedUrl: string };
    return { url: signed.signedUrl, expiresIn: 300 };
  }
  if (is('GET', '/notifications')) {
    const items = uiAll(must(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)));
    return { unread: items.filter((n) => !n.readAt).length, items };
  }
  if (is('POST', '/notifications/read')) {
    must(await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null));
    return { ok: true };
  }

  throw new HttpErr(404, 'Not found');
}

export function installSupabaseBackend() {
  installBackend(handle);
}
