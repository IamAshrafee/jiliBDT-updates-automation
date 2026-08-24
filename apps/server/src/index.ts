import { resolve } from 'node:path';
import { loadConfig } from '@jilibdt/config';
import { buildApp } from './app.js';

const projectRoot = resolve(import.meta.dirname, '../../..');
const config = loadConfig({ cwd: projectRoot });
const { app } = await buildApp(config);

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(
    { errType: error instanceof Error ? error.name : typeof error },
    'Server startup failed',
  );
  process.exitCode = 1;
}
