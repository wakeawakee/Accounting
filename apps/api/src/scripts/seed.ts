/**
 * Seeds a demo firm with 20 fake clients.
 *   Login: demo@karsathi.test / demo12345
 * Re-running deletes and recreates the demo firm.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { AuditLog, Client, ComplianceTask, DocumentUpload, Firm, MessageLog, Notification, Reminder, UploadLink, User } from '../models';
import { ensureTasksForFirm } from '../services/tasks';
import { fakeClients } from './fakeData';

const EMAIL = 'demo@karsathi.test';

await mongoose.connect(env.MONGO_URL);
await mongoose.syncIndexes();

const old = await User.findOne({ email: EMAIL }).setOptions({ crossTenant: true }).lean();
if (old) {
  const firmId = old.firmId;
  for (const M of [User, Client, ComplianceTask, DocumentUpload, Reminder, MessageLog, Notification, UploadLink, AuditLog] as const) {
    await (M as typeof Client).deleteMany({ firmId });
  }
  await Firm.deleteOne({ _id: firmId });
}

const firm = await Firm.create({
  name: 'Sharma & Associates',
  messageSenderName: 'Sharma Accounts',
  contactPhone: '01-4412345',
  contactEmail: EMAIL,
  address: 'New Baneshwor, Kathmandu',
});
const owner = await User.create({ firmId: firm._id, name: 'Ramesh Sharma', email: EMAIL, passwordHash: await bcrypt.hash('demo12345', 12), role: 'owner' });
const staff = await User.create({ firmId: firm._id, name: 'Sita Karki', email: 'staff@karsathi.test', passwordHash: await bcrypt.hash('demo12345', 12), role: 'staff' });

const clients = fakeClients(20, 500000000).map((c, i) => ({ ...c, firmId: firm._id, assignedStaffId: i % 2 ? staff._id : owner._id }));
await Client.insertMany(clients);
const created = await ensureTasksForFirm(firm._id);

// Make the dashboard interesting: some docs received, some filed.
const tasks = await ComplianceTask.find({ firmId: firm._id }).sort({ dueDateAd: 1 }).lean();
const ids = (n: number, from: number) => tasks.slice(from, from + n).map((t) => t._id);
await ComplianceTask.updateMany({ firmId: firm._id, _id: { $in: ids(5, 0) } }, { $set: { status: 'docs_received', docsReceivedAt: new Date() } });
await ComplianceTask.updateMany({ firmId: firm._id, _id: { $in: ids(3, 5) } }, { $set: { status: 'filed', filedAt: new Date() } });
await Reminder.updateMany({ firmId: firm._id, taskId: { $in: [...ids(5, 0), ...ids(3, 5)] } }, { $set: { status: 'cancelled' } });

console.log(`Seeded firm "${firm.name}" with ${clients.length} clients and ${created} tasks.`);
console.log(`Login: ${EMAIL} / demo12345  (staff: staff@karsathi.test / demo12345)`);
await mongoose.disconnect();
