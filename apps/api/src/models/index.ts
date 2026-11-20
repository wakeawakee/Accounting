import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { DEFAULT_QUIET_HOURS, DEFAULT_REMINDER_OFFSETS, DEFAULT_SEND_MINUTE } from '@karsathi/shared';
import { tenantPlugin } from '../db/tenantPlugin';

const { ObjectId } = Schema.Types;
const firmRef = { type: ObjectId, ref: 'Firm', required: true, index: true } as const;

// ---------------------------------------------------------------------------
// Firm (the tenant itself — not tenant-scoped)
// ---------------------------------------------------------------------------
const firmSchema = new Schema(
  {
    name: { type: String, required: true },
    contactPhone: String,
    contactEmail: String,
    address: String,
    logoKey: String,
    messageSenderName: String,
    // Designed so Khalti/eSewa subscription billing can be added later.
    plan: {
      tier: { type: String, enum: ['trial', 'basic', 'pro'], default: 'trial' },
      status: { type: String, enum: ['active', 'past_due', 'cancelled'], default: 'active' },
      monthlyMessageQuota: { type: Number, default: 1000 },
      currentPeriodEnd: Date,
      paymentProvider: { type: String, enum: ['none', 'khalti', 'esewa'], default: 'none' },
      externalCustomerId: String,
    },
    reminderOffsets: { type: [Number], default: DEFAULT_REMINDER_OFFSETS },
    sendMinute: { type: Number, default: DEFAULT_SEND_MINUTE },
    quietHours: {
      start: { type: Number, default: DEFAULT_QUIET_HOURS.start },
      end: { type: Number, default: DEFAULT_QUIET_HOURS.end },
    },
    messaging: {
      provider: { type: String, enum: ['console', 'sms', 'viber'], default: 'console' },
      smsApiUrl: String,
      smsTokenEnc: String,
      smsSenderId: String,
    },
  },
  { timestamps: true },
);
export const Firm = mongoose.model('Firm', firmSchema);
export type FirmDoc = InferSchemaType<typeof firmSchema> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
const userSchema = new Schema(
  {
    firmId: firmRef,
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['owner', 'staff'], required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
userSchema.plugin(tenantPlugin);
export const User = mongoose.model('User', userSchema);

// ---------------------------------------------------------------------------
const clientSchema = new Schema(
  {
    firmId: firmRef,
    businessName: { type: String, required: true },
    ownerName: { type: String, required: true },
    phone: { type: String, required: true },
    pan: { type: String, required: true },
    vatRegistered: { type: Boolean, default: false },
    deductsTds: { type: Boolean, default: false },
    municipality: String,
    assignedStaffId: { type: ObjectId, ref: 'User', default: null },
    preferredLanguage: { type: String, enum: ['ne', 'en'], default: 'ne' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
clientSchema.index({ firmId: 1, pan: 1 }, { unique: true });
clientSchema.index({ firmId: 1, businessName: 1 });
clientSchema.plugin(tenantPlugin);
export const Client = mongoose.model('Client', clientSchema);
export type ClientDoc = InferSchemaType<typeof clientSchema> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
const customRuleSchema = new Schema(
  {
    firmId: firmRef,
    nameEn: { type: String, required: true },
    nameNe: String,
    frequency: { type: String, enum: ['monthly', 'trimester', 'annual'], required: true },
    dueRule: { type: Schema.Types.Mixed, required: true },
    appliesTo: { type: Schema.Types.Mixed, default: {} },
    notes: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
customRuleSchema.plugin(tenantPlugin);
export const CustomRule = mongoose.model('CustomRule', customRuleSchema);

// ---------------------------------------------------------------------------
const taskSchema = new Schema(
  {
    firmId: firmRef,
    clientId: { type: ObjectId, ref: 'Client', required: true, index: true },
    ruleId: { type: String, required: true },
    ruleName: { en: String, ne: String },
    periodKey: { type: String, required: true },
    periodLabel: { type: String, required: true },
    periodLabelNe: String,
    fiscalYear: String,
    dueDateBs: { type: String, required: true },
    dueDateAd: { type: Date, required: true },
    holidayFlag: { type: String, default: null },
    status: { type: String, enum: ['pending', 'docs_received', 'filed', 'missed'], default: 'pending', index: true },
    docsReceivedAt: Date,
    filedAt: Date,
  },
  { timestamps: true },
);
taskSchema.index({ firmId: 1, clientId: 1, ruleId: 1, periodKey: 1 }, { unique: true });
taskSchema.index({ firmId: 1, dueDateAd: 1 });
taskSchema.plugin(tenantPlugin);
export const ComplianceTask = mongoose.model('ComplianceTask', taskSchema);
export type TaskDoc = InferSchemaType<typeof taskSchema> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
const documentSchema = new Schema(
  {
    firmId: firmRef,
    clientId: { type: ObjectId, ref: 'Client', required: true, index: true },
    taskId: { type: ObjectId, ref: 'ComplianceTask', required: true, index: true },
    fileKey: { type: String, required: true },
    originalName: String,
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    note: String,
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
documentSchema.plugin(tenantPlugin);
export const DocumentUpload = mongoose.model('DocumentUpload', documentSchema);

// ---------------------------------------------------------------------------
// Magic upload links. A short random token (stored server-side, expiring)
// instead of a JWT: JWTs are ~200 chars, which would cost several SMS segments.
const uploadLinkSchema = new Schema({
  firmId: firmRef,
  token: { type: String, required: true, unique: true },
  clientId: { type: ObjectId, ref: 'Client', required: true },
  taskId: { type: ObjectId, ref: 'ComplianceTask', required: true, index: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});
uploadLinkSchema.plugin(tenantPlugin);
export const UploadLink = mongoose.model('UploadLink', uploadLinkSchema);

// ---------------------------------------------------------------------------
const reminderSchema = new Schema(
  {
    firmId: firmRef,
    taskId: { type: ObjectId, ref: 'ComplianceTask', required: true, index: true },
    clientId: { type: ObjectId, ref: 'Client', required: true },
    offsetDays: Number,
    scheduledFor: { type: Date, required: true },
    channel: { type: String, enum: ['sms', 'viber', 'console'], default: 'sms' },
    // "sending" is a short-lived internal claim state used by the dispatcher.
    status: { type: String, enum: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'], default: 'scheduled' },
    attempt: { type: Number, default: 0 },
    providerResponse: Schema.Types.Mixed,
    sentAt: Date,
    lastError: String,
  },
  { timestamps: true },
);
reminderSchema.index({ status: 1, scheduledFor: 1 });
reminderSchema.plugin(tenantPlugin);
export const Reminder = mongoose.model('Reminder', reminderSchema);

// ---------------------------------------------------------------------------
const messageLogSchema = new Schema({
  firmId: firmRef,
  clientId: { type: ObjectId, ref: 'Client', index: true },
  taskId: { type: ObjectId, ref: 'ComplianceTask' },
  reminderId: { type: ObjectId, ref: 'Reminder' },
  channel: String,
  provider: String,
  to: String,
  body: String,
  segments: Number,
  encoding: String,
  costEstimateNpr: Number,
  status: { type: String, enum: ['sent', 'failed'] },
  error: String,
  createdAt: { type: Date, default: Date.now, index: true },
});
messageLogSchema.plugin(tenantPlugin);
export const MessageLog = mongoose.model('MessageLog', messageLogSchema);

// ---------------------------------------------------------------------------
// Firm overrides only; defaults live in @karsathi/shared (firmId = null in spec).
const templateSchema = new Schema(
  {
    firmId: firmRef,
    type: { type: String, enum: ['reminder', 'due_today'], required: true },
    language: { type: String, enum: ['ne', 'en'], required: true },
    body: { type: String, required: true },
  },
  { timestamps: true },
);
templateSchema.index({ firmId: 1, type: 1, language: 1 }, { unique: true });
templateSchema.plugin(tenantPlugin);
export const MessageTemplate = mongoose.model('MessageTemplate', templateSchema);

// ---------------------------------------------------------------------------
const notificationSchema = new Schema({
  firmId: firmRef,
  type: String,
  title: String,
  body: String,
  link: String,
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});
notificationSchema.plugin(tenantPlugin);
export const Notification = mongoose.model('Notification', notificationSchema);

// ---------------------------------------------------------------------------
const auditSchema = new Schema({
  firmId: firmRef,
  userId: { type: ObjectId, ref: 'User', default: null },
  actor: String, // 'user' | 'client' | 'system'
  action: { type: String, required: true },
  entity: String,
  entityId: String,
  meta: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});
auditSchema.plugin(tenantPlugin);
export const AuditLog = mongoose.model('AuditLog', auditSchema);
