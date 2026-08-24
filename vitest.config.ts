import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@jilibdt/config': fromRoot('./packages/config/src/index.ts'),
      '@jilibdt/db': fromRoot('./packages/db/src/index.ts'),
      '@jilibdt/domain': fromRoot('./packages/domain/src/index.ts'),
      '@jilibdt/google-sheet': fromRoot('./packages/google-sheet/src/index.ts'),
      '@jilibdt/renderer': fromRoot('./packages/renderer/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
  },
});
