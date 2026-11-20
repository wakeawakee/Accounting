import mongoose from 'mongoose';
import { env } from './config/env';
import { createApp } from './app';
import { startScheduler } from './jobs/scheduler';
import { logger } from './lib/logger';

async function main() {
  await mongoose.connect(env.MONGO_URL);
  await mongoose.syncIndexes();
  logger.info('MongoDB connected');

  const server = createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT}`));
  const stopScheduler = await startScheduler();

  const shutdown = async () => {
    logger.info('shutting down');
    server.close();
    await stopScheduler();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
