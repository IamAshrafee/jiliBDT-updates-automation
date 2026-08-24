import { resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import { buildApp } from './app.js';

const projectRoot = resolve(import.meta.dirname, '../../..');
const config = loadConfig({ cwd: projectRoot });
const runtime = await buildApp(config);
const { app } = runtime;
let closing = false;

async function shutdown(signal: string, exitCode: number): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Graceful shutdown started');
  try {
    await runtime.close();
  } catch (error) {
    app.log.error(
      { errType: error instanceof Error ? error.name : typeof error },
      'Graceful shutdown encountered an error',
    );
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
process.once('SIGINT', () => void shutdown('SIGINT', 0));

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(
    { errType: error instanceof Error ? error.name : typeof error },
    'Server startup failed',
  );
  process.exitCode = 1;
  await runtime.close();
}
