import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    env: { DATABASE_URL: 'file:./test.db', NODE_ENV: 'test', PENNEO_MODE: 'mock' },
    globalSetup: ['tests/integration/global-setup.ts'],
    // Integrationstests deler én SQLite-fil og kører derfor sekventielt.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
