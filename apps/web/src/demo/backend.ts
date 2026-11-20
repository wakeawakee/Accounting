/**
 * In-browser demo backend (VITE_DEMO=1 builds only).
 *
 * Intercepts fetch('/api/...') and answers with the same JSON shapes as the
 * real Express API, using the real rules engine from @karsathi/shared and
 * sample data. State is kept in this browser (localStorage). Uploaded files
 * live in memory until the page reloads. Nothing leaves the device.
 */
import {
  CLIENT_IMPORT_FIELDS,
  DEFAULT_TEMPLATES,
  RULE_SETS,
  SAMPLE_TEMPLATE_VARS,
  TEMPLATE_TYPES,
  addDaysAd,
  clientInputSchema,
  customRuleSchema,
  fakeClients,
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
import { HttpErr, installBackend, matcher, sniffMime as sniff } from '../lib/interceptor';
import { readSpreadsheet } from '../lib/sheet';

const KEY = 'ks_demo_v1';
type Row = Record<string, any>;

interface State {
  session: string | null;
  firm: Row;
  users: Row[];
  clients: Row[];
  tasks: Row[];
  documents: Row[];
  messages: Row[];
  templates: Row[];
  customRules: Row[];
  notifications: Row[];
  links: Row[];
}

const blobs = new Map<string, string>();
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const token = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => a[b % a.length]).join('');
};
const iso = (ad: string) => `${ad}T00:00:00.000Z`;
const nowIso = () => new Date().toISOString();


// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
function customToRule(r: Row): ComplianceRule {
  return { id: `custom_${r._id}`, custom: true, name: { en: r.nameEn, ne: r.nameNe || r.nameEn }, frequency: r.frequency, dueRule: r.dueRule, appliesTo: r.appliesTo ?? {} };
}

function ensureTasks(s: State, client: Row, now?: Date): number {
  if (!client.active) return 0;
  const drafts = generateTasks({
    client: { vatRegistered: client.vatRegistered, deductsTds: client.deductsTds },
    today: todayBs(now),
    customRules: s.customRules.filter((r) => r.active).map(customToRule),
  });
  let n = 0;
  for (const d of drafts) {
    if (s.tasks.some((t) => t.clientId === client._id && t.ruleId === d.ruleId && t.periodKey === d.periodKey)) continue;
    s.tasks.push({
      _id: id(), firmId: s.firm._id, clientId: client._id, ruleId: d.ruleId, ruleName: d.ruleName, periodKey: d.periodKey,
      periodLabel: d.periodLabel, periodLabelNe: d.periodLabelNe, fiscalYear: d.fiscalYear, dueDateBs: d.dueDateBs,
      dueDateAd: iso(d.dueDateAd), holidayFlag: d.holidayFlag, status: 'pending', createdAt: nowIso(),
    });
    n++;
  }
  return n;
}

function markMissed(s: State) {
  const today = iso(todayAdInKathmandu());
  for (const t of s.tasks) if (t.status === 'pending' && t.dueDateAd < today) t.status = 'missed';
}

function seed(): State {
  const firmId = id();
  const owner = { _id: id(), firmId, name: 'Ramesh Sharma', email: 'demo@karsathi.test', role: 'owner', active: true };
  const staff = { _id: id(), firmId, name: 'Sita Karki', email: 'staff@karsathi.test', role: 'staff', active: true };
  const s: State = {
    session: owner._id,
    firm: {
      _id: firmId, name: 'Sharma & Associates', contactPhone: '01-4412345', contactEmail: 'demo@karsathi.test', address: 'New Baneshwor, Kathmandu',
      messageSenderName: 'Sharma Accounts', logoKey: null, reminderOffsets: [10, 5, 2, 0], sendMinute: 600, quietHours: { start: 1200, end: 480 },
      plan: { tier: 'trial', status: 'active', monthlyMessageQuota: 1000 }, messaging: { provider: 'console', smsApiUrl: '', smsSenderId: '', hasSmsToken: false },
    },
    users: [owner, staff],
    clients: fakeClients(20, 500000000).map((c, i) => ({ _id: id(), firmId, ...c, assignedStaffId: i % 2 ? staff._id : owner._id, active: true, createdAt: nowIso() })),
    tasks: [], documents: [], messages: [], templates: [], customRules: [], notifications: [], links: [],
  };
  // History: tasks from ~2 months ago (mostly filed, a few missed), then current ones.
  const past = new Date(Date.now() - 62 * 86_400_000);
  for (const c of s.clients) ensureTasks(s, c, past);
  const today = iso(todayAdInKathmandu());
  s.tasks.forEach((t, i) => {
    if (t.dueDateAd < today) {
      t.status = i % 7 === 0 ? 'missed' : 'filed';
      if (t.status === 'filed') t.filedAt = t.dueDateAd;
    }
  });
  for (const c of s.clients) ensureTasks(s, c);
  const current = s.tasks.filter((t) => t.status === 'pending').sort((a, b) => a.dueDateAd.localeCompare(b.dueDateAd));
  current.slice(0, 6).forEach((t) => ((t.status = 'docs_received'), (t.docsReceivedAt = nowIso())));
  current.slice(6, 9).forEach((t) => ((t.status = 'filed'), (t.filedAt = nowIso())));
  // A few example reminder messages in the log.
  for (const t of current.slice(9, 15)) {
    const c = s.clients.find((x) => x._id === t.clientId)!;
    logMessage(s, t, c, 'reminder', new Date(Date.now() - 2 * 86_400_000).toISOString());
  }
  return s;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      markMissed(s);
      for (const c of s.clients) ensureTasks(s, c);
      return s;
    }
  } catch {
    /* fall through */
  }
  return seed();
}

let state: State = load();
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: demo still works for this visit */
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  state = seed();
  save();
}

// ---------------------------------------------------------------------------
// Helpers mirroring the API
// ---------------------------------------------------------------------------
function uploadUrl(task: Row, s: State = state): string {
  let link = s.links.find((l) => l.taskId === task._id);
  if (!link) {
    link = { token: token(), taskId: task._id, clientId: task.clientId, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() };
    s.links.push(link);
  }
  return `${location.origin}${location.pathname}#/u/${link.token}`;
}

function templateBody(s: State, type: TemplateType, lang: Language) {
  return s.templates.find((t) => t.type === type && t.language === lang)?.body ?? DEFAULT_TEMPLATES[type][lang];
}

function logMessage(s: State, task: Row, client: Row, type: TemplateType, at = nowIso()) {
  const lang = (client.preferredLanguage ?? 'ne') as Language;
  const body = renderTemplate(templateBody(s, type, lang), {
    clientName: client.ownerName,
    firmName: s.firm.messageSenderName || s.firm.name,
    period: lang === 'ne' ? task.periodLabelNe || task.periodLabel : task.periodLabel,
    dueDateBs: formatBsLong(parseBs(task.dueDateBs), lang),
    uploadLink: uploadUrl(task, s),
  });
  const seg = smsSegments(body);
  s.messages.push({
    _id: id(), firmId: s.firm._id, clientId: client._id, taskId: task._id, channel: 'console', provider: 'console (demo)', to: client.phone,
    body, segments: seg.segments, encoding: seg.encoding, costEstimateNpr: 0, status: 'sent', createdAt: at,
  });
}

function withClient(tasks: Row[]) {
  return tasks.map((t) => {
    const c = state.clients.find((x) => x._id === t.clientId);
    return { ...t, client: c ? { _id: c._id, businessName: c.businessName, ownerName: c.ownerName, phone: c.phone, assignedStaffId: c.assignedStaffId } : null };
  });
}

function me() {
  const u = state.users.find((x) => x._id === state.session && x.active);
  if (!u) throw new HttpErr(401, 'Not signed in');
  return u;
}

function publicFirm() {
  const f = state.firm;
  return { id: f._id, ...f, hasLogo: false };
}

export function sampleImportRows() {
  const headers = ['Business Name', 'Owner Name', 'Mobile No', 'PAN', 'VAT Registered', 'TDS', 'Municipality', 'Language'];
  const rows: Row[] = fakeClients(50, 600000000).map((c) => ({
    'Business Name': c.businessName, 'Owner Name': c.ownerName, 'Mobile No': c.phone, PAN: c.pan, 'VAT Registered': c.vatRegistered ? 'Yes' : 'No',
    TDS: c.deductsTds ? 'Yes' : 'No', Municipality: c.municipality, Language: c.preferredLanguage,
  }));
  rows.push({ 'Business Name': 'Bad Row Traders', 'Owner Name': 'X', 'Mobile No': '12345', PAN: '12', 'VAT Registered': 'Yes', TDS: 'No', Municipality: '', Language: '' });
  return { headers, rows, suggestedMapping: suggestColumnMapping(headers), fields: CLIENT_IMPORT_FIELDS };
}

function validateRows(rows: Row[], mapping: Record<string, string>) {
  const pans = new Set(state.clients.map((c) => c.pan));
  const phones = new Set(state.clients.map((c) => c.phone));
  const seen = new Map<string, number>();
  return rows.map((raw, i) => {
    const rowNum = i + 2;
    const input: Row = {};
    for (const f of CLIENT_IMPORT_FIELDS) if (mapping[f]) input[f] = raw[mapping[f]] ?? '';
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
}

function setStatus(ids: string[], status: string) {
  let n = 0;
  for (const t of state.tasks) {
    if (!ids.includes(t._id)) continue;
    t.status = status;
    if (status === 'filed') t.filedAt = nowIso();
    if (status === 'docs_received') t.docsReceivedAt = nowIso();
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function handle(method: string, path: string, body: any): Promise<unknown> {
  const { seg, q, is } = matcher(method, path);

  // ---- auth
  if (is('GET', '/auth/me')) {
    const u = me();
    return { user: { id: u._id, name: u.name, email: u.email, role: u.role }, firm: { id: state.firm._id, name: state.firm.name, hasLogo: false } };
  }
  if (is('POST', '/auth/login')) {
    const u = state.users.find((x) => x.email === String(body?.email ?? '').toLowerCase() && x.active);
    if (!u) throw new HttpErr(401, 'Wrong email or password (demo: demo@karsathi.test, any password)');
    state.session = u._id;
    return { user: u };
  }
  if (is('POST', '/auth/signup')) {
    const fresh = seed();
    state = { ...fresh, clients: [], tasks: [], messages: [], firm: { ...fresh.firm, name: body.firmName, messageSenderName: body.firmName } };
    state.users = [{ _id: id(), firmId: state.firm._id, name: body.name, email: String(body.email).toLowerCase(), role: 'owner', active: true }];
    state.session = state.users[0]._id;
    return { ok: true };
  }
  if (is('POST', '/auth/logout')) {
    state.session = null;
    return { ok: true };
  }

  // ---- public upload page
  if (seg[0] === 'public' && seg[1] === 'u') {
    const link = state.links.find((l) => l.token === seg[2]);
    if (!link) throw new HttpErr(404, 'Link not found');
    const task = state.tasks.find((t) => t._id === link.taskId)!;
    const client = state.clients.find((c) => c._id === link.clientId)!;
    if (is('GET', '/public/u/:t')) {
      return {
        firm: { name: state.firm.name, phone: state.firm.contactPhone, hasLogo: false },
        client: { businessName: client.businessName, ownerName: client.ownerName, preferredLanguage: client.preferredLanguage },
        task: { ruleName: task.ruleName, periodLabel: task.periodLabel, periodLabelNe: task.periodLabelNe, dueDateBs: task.dueDateBs, status: task.status },
        uploadedCount: state.documents.filter((d) => d.taskId === task._id).length,
        expiresAt: link.expiresAt,
      };
    }
    if (is('POST', '/public/u/:t/files')) {
      const files = (body as FormData).getAll('files') as File[];
      if (!files.length) throw new HttpErr(400, 'No files received');
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) throw new HttpErr(400, 'File too large (max 10 MB)');
        if (!(await sniff(f))) throw new HttpErr(415, `"${f.name}" is not a JPG, PNG or PDF`);
      }
      const note = (body as FormData).get('note');
      for (const f of files) {
        const docId = id();
        blobs.set(docId, URL.createObjectURL(f));
        state.documents.push({ _id: docId, clientId: client._id, taskId: task._id, originalName: f.name, mimeType: await sniff(f), size: f.size, note: note ? String(note) : undefined, uploadedAt: nowIso() });
      }
      if (task.status === 'pending' || task.status === 'missed') setStatus([task._id], 'docs_received');
      state.notifications.unshift({ _id: id(), type: 'docs_received', title: `${client.businessName} uploaded ${files.length} file(s)`, body: `${task.periodLabel} · ${task.ruleName?.en}`, link: `/clients/${client._id}`, readAt: null, createdAt: nowIso() });
      return { uploaded: files.length };
    }
  }

  me();

  // ---- firm & users
  if (is('GET', '/firm')) return publicFirm();
  if (is('PATCH', '/firm')) {
    const { messaging, ...rest } = body;
    Object.assign(state.firm, rest);
    if (messaging) state.firm.messaging = { ...state.firm.messaging, ...messaging, smsToken: undefined, hasSmsToken: state.firm.messaging.hasSmsToken || !!messaging.smsToken };
    return publicFirm();
  }
  if (is('POST', '/firm/logo')) return { ok: true };
  if (is('GET', '/firm/users')) return state.users;
  if (is('POST', '/firm/users')) {
    if (state.users.some((u) => u.email === body.email)) throw new HttpErr(409, 'Email already in use');
    const u = { _id: id(), firmId: state.firm._id, name: body.name, email: String(body.email).toLowerCase(), role: 'staff', active: true };
    state.users.push(u);
    return u;
  }
  if (is('DELETE', '/firm/users/:id')) {
    const u = state.users.find((x) => x._id === seg[2] && x.role === 'staff');
    if (!u) throw new HttpErr(404, 'User not found');
    u.active = false;
    state.clients.forEach((c) => c.assignedStaffId === u._id && (c.assignedStaffId = null));
    return { ok: true };
  }

  // ---- clients
  if (is('GET', '/clients')) {
    const s = (q.get('q') ?? '').toLowerCase();
    return state.clients
      .filter((c) => c.active && (!s || [c.businessName, c.ownerName, c.phone, c.pan].some((v) => String(v).toLowerCase().includes(s))))
      .sort((a, b) => a.businessName.localeCompare(b.businessName));
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
    const report = validateRows(body.rows, body.mapping);
    const summary = {
      total: report.length,
      valid: report.filter((r) => r.status === 'valid').length,
      errors: report.filter((r) => r.status === 'error').length,
      duplicates: report.filter((r) => r.status === 'duplicate').length,
      imported: 0,
      tasksCreated: 0,
    };
    if (!body.dryRun) {
      for (const r of report) {
        if (r.status !== 'valid' || !r.data) continue;
        const c = { _id: id(), firmId: state.firm._id, ...r.data, assignedStaffId: null, active: true, createdAt: nowIso() };
        state.clients.push(c);
        summary.imported++;
        summary.tasksCreated += ensureTasks(state, c);
      }
    }
    return { summary, report: report.map(({ data, ...r }) => ({ ...r, businessName: data?.businessName })) };
  }
  if (is('POST', '/clients')) {
    const r = clientInputSchema.safeParse(body);
    if (!r.success) throw new HttpErr(400, 'Validation failed', r.error.flatten());
    if (state.clients.some((c) => c.pan === r.data.pan)) throw new HttpErr(409, 'A client with this PAN already exists');
    const c = { _id: id(), firmId: state.firm._id, ...r.data, assignedStaffId: r.data.assignedStaffId || null, createdAt: nowIso() };
    state.clients.push(c);
    ensureTasks(state, c);
    return c;
  }
  if (is('GET', '/clients/:id')) {
    const c = state.clients.find((x) => x._id === seg[1]);
    if (!c) throw new HttpErr(404, 'Client not found');
    return {
      client: c,
      tasks: state.tasks.filter((t) => t.clientId === c._id).sort((a, b) => b.dueDateAd.localeCompare(a.dueDateAd)),
      documents: state.documents.filter((d) => d.clientId === c._id).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
      messages: state.messages.filter((m) => m.clientId === c._id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }
  if (is('PATCH', '/clients/:id')) {
    const c = state.clients.find((x) => x._id === seg[1]);
    if (!c) throw new HttpErr(404, 'Client not found');
    const r = clientInputSchema.partial().safeParse(body);
    if (!r.success) throw new HttpErr(400, 'Validation failed', r.error.flatten());
    if (r.data.pan && r.data.pan !== c.pan && state.clients.some((x) => x.pan === r.data.pan)) throw new HttpErr(409, 'A client with this PAN already exists');
    Object.assign(c, r.data);
    if (c.active) ensureTasks(state, c);
    return c;
  }

  // ---- tasks
  if (is('GET', '/tasks/dashboard')) {
    const today = todayAdInKathmandu();
    const t0 = iso(today);
    const week = iso(addDaysAd(today, 7));
    const month = iso(addDaysAd(today, 30));
    const ts = state.tasks;
    const rank = (s: string) => (s === 'missed' ? 0 : s === 'pending' ? 1 : 2);
    return {
      today,
      counts: {
        dueThisWeek: ts.filter((t) => ['pending', 'docs_received'].includes(t.status) && t.dueDateAd >= t0 && t.dueDateAd <= week).length,
        docsPending: ts.filter((t) => t.status === 'pending' && t.dueDateAd >= t0).length,
        docsReceived: ts.filter((t) => t.status === 'docs_received').length,
        missed: ts.filter((t) => t.status === 'missed').length,
      },
      tasks: withClient(
        ts.filter((t) => ['pending', 'docs_received', 'missed'].includes(t.status) && t.dueDateAd <= month)
          .sort((a, b) => rank(a.status) - rank(b.status) || a.dueDateAd.localeCompare(b.dueDateAd)),
      ),
    };
  }
  if (is('GET', '/tasks')) {
    let ts = [...state.tasks];
    if (q.get('status')) ts = ts.filter((t) => q.get('status')!.split(',').includes(t.status));
    if (q.get('ruleId')) ts = ts.filter((t) => t.ruleId === q.get('ruleId'));
    if (q.get('periodKey')) ts = ts.filter((t) => t.periodKey === q.get('periodKey'));
    if (q.get('clientId')) ts = ts.filter((t) => t.clientId === q.get('clientId'));
    if (q.get('fromAd')) ts = ts.filter((t) => t.dueDateAd >= iso(q.get('fromAd')!));
    if (q.get('toAd')) ts = ts.filter((t) => t.dueDateAd <= iso(q.get('toAd')!));
    if (q.get('staffId')) {
      const sid = q.get('staffId') === 'none' ? null : q.get('staffId');
      const ids = new Set(state.clients.filter((c) => (c.assignedStaffId ?? null) === sid).map((c) => c._id));
      ts = ts.filter((t) => ids.has(t.clientId));
    }
    return withClient(ts.sort((a, b) => a.dueDateAd.localeCompare(b.dueDateAd)));
  }
  if (is('PATCH', '/tasks/:id')) {
    if (!setStatus([seg[1]], body.status)) throw new HttpErr(404, 'Task not found');
    return state.tasks.find((t) => t._id === seg[1]);
  }
  if (is('POST', '/tasks/bulk-status')) return { updated: setStatus(body.ids, body.status) };
  if (is('POST', '/tasks/generate')) {
    markMissed(state);
    return { created: state.clients.reduce((n, c) => n + ensureTasks(state, c), 0) };
  }
  if (is('POST', '/tasks/:id/upload-link')) {
    const t = state.tasks.find((x) => x._id === seg[1]);
    if (!t) throw new HttpErr(404, 'Task not found');
    return { url: uploadUrl(t), token: state.links.find((l) => l.taskId === t._id)!.token };
  }
  if (is('POST', '/tasks/:id/remind-now')) {
    const t = state.tasks.find((x) => x._id === seg[1]);
    if (!t) throw new HttpErr(404, 'Task not found');
    logMessage(state, t, state.clients.find((c) => c._id === t.clientId)!, 'reminder');
    return { ok: true };
  }

  // ---- rules
  if (is('GET', '/rules')) {
    const fy = fiscalYearOf(todayBs());
    return { currentFiscalYear: fy, ruleSet: getRuleSet(fy), availableFiscalYears: RULE_SETS.map((s) => s.fiscalYear), custom: state.customRules };
  }
  if (is('POST', '/rules/custom')) {
    const r = customRuleSchema.safeParse(body);
    if (!r.success) throw new HttpErr(400, 'Validation failed', r.error.flatten());
    const rule = { _id: id(), ...r.data };
    state.customRules.push(rule);
    for (const c of state.clients) ensureTasks(state, c);
    return rule;
  }
  if (is('PATCH', '/rules/custom/:id')) {
    const rule = state.customRules.find((r) => r._id === seg[2]);
    if (!rule) throw new HttpErr(404, 'Rule not found');
    Object.assign(rule, body);
    if (rule.active) for (const c of state.clients) ensureTasks(state, c);
    return rule;
  }

  // ---- templates
  if (is('GET', '/templates')) {
    const templates = [];
    for (const type of TEMPLATE_TYPES) {
      for (const language of ['ne', 'en'] as Language[]) {
        const o = state.templates.find((x) => x.type === type && x.language === language);
        templates.push({ type, language, body: o?.body ?? DEFAULT_TEMPLATES[type][language], isDefault: !o, defaultBody: DEFAULT_TEMPLATES[type][language] });
      }
    }
    return { templates, sampleVars: SAMPLE_TEMPLATE_VARS };
  }
  if (is('PUT', '/templates/:type/:lang')) {
    const [type, language] = [seg[1] as TemplateType, seg[2] as Language];
    state.templates = state.templates.filter((x) => !(x.type === type && x.language === language));
    if (body.body !== DEFAULT_TEMPLATES[type][language]) state.templates.push({ type, language, body: body.body });
    return { ok: true };
  }
  if (is('POST', '/templates/preview')) {
    const text = renderTemplate(String(body.body ?? ''), SAMPLE_TEMPLATE_VARS);
    return { text, ...smsSegments(text) };
  }

  // ---- messages, documents, notifications
  if (is('GET', '/messages/stats')) {
    const months = new Map<string, Row>();
    for (const m of state.messages) {
      const k = new Date(new Date(m.createdAt).getTime() + 345 * 60_000).toISOString().slice(0, 7);
      const r = months.get(k) ?? { _id: k, messages: 0, sent: 0, failed: 0, segments: 0, costNpr: 0 };
      r.messages++;
      r[m.status === 'sent' ? 'sent' : 'failed']++;
      r.segments += m.segments;
      r.costNpr += m.costEstimateNpr;
      months.set(k, r);
    }
    return { months: [...months.values()].sort((a, b) => b._id.localeCompare(a._id)), costPerSegmentNpr: 1, quota: 1000 };
  }
  if (is('GET', '/messages')) {
    return state.messages.filter((m) => !q.get('clientId') || m.clientId === q.get('clientId')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (is('GET', '/documents/:id/url')) {
    const url = blobs.get(seg[1]);
    if (!url) throw new HttpErr(404, 'In this demo, files are kept only until the page is reloaded.');
    return { url, expiresIn: 300 };
  }
  if (is('GET', '/notifications')) {
    return { unread: state.notifications.filter((n) => !n.readAt).length, items: state.notifications.slice(0, 50) };
  }
  if (is('POST', '/notifications/read')) {
    state.notifications.forEach((n) => (n.readAt ??= nowIso()));
    return { ok: true };
  }

  throw new HttpErr(404, 'Not found');
}

export function installDemoBackend() {
  installBackend(handle, save);
}
