import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Testdatabasen er en lokal, disponibel SQLite-fil, som testopsætningen selv ejer. */
export default function setup() {
  for (const f of ['prisma/test.db', 'prisma/test.db-journal']) rmSync(f, { force: true });
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: 'file:./test.db', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
