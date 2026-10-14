// Opsætning, der virker ens i Windows (cmd/PowerShell), macOS og Linux:
// opretter .env, opretter SQLite-databasen og indlæser syntetiske demodata.
// Brug: npm run setup            (starttilstand, demodato 12.11.2026)
//       npm run setup -- --brief (brief-tilstand, demodato 15.01.2027)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 12)) {
  console.error(`Node.js ${process.versions.node} er for gammel. Installér Node.js 20.12 eller nyere (LTS) fra https://nodejs.org.`);
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Oprettede .env ud fra .env.example');
}
// Prisma-klienten genereres under npm install, før .env findes – giv derfor DATABASE_URL videre selv.
process.loadEnvFile('.env');
run('npx prisma db push --skip-generate');
run(process.argv.includes('--brief') ? 'npm run seed:brief' : 'npm run seed');
console.log('\nKlar. Start appen med:  npm run dev   og åbn http://localhost:3000');
