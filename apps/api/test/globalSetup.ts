import type { MongoMemoryServer } from 'mongodb-memory-server-core';

/**
 * Uses MONGO_URL_TEST if set (e.g. docker-compose Mongo), otherwise starts an
 * in-memory MongoDB (downloads a mongod binary on first run).
 */
let mem: MongoMemoryServer | undefined;

export async function setup() {
  if (!process.env.MONGO_URL_TEST) {
    const { MongoMemoryServer } = await import('mongodb-memory-server-core');
    mem = await MongoMemoryServer.create();
    process.env.MONGO_URL_TEST = mem.getUri('karsathi_test');
  }
}

export async function teardown() {
  await mem?.stop();
}
