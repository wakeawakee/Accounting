import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? './storage-test';

beforeAll(async () => {
  const url = process.env.MONGO_URL_TEST!;
  // Separate DB per test file so files can't interfere.
  const dbName = `karsathi_test_${Math.random().toString(36).slice(2, 8)}`;
  await mongoose.connect(url, { dbName });
  await mongoose.syncIndexes();
});

beforeEach(async () => {
  const cols = await mongoose.connection.db!.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
});
