// Loads the seed data (database/seed) into the live database (LIVE_DB_NAME): the sample accounts, courses with their
// modules, lessons and timetable, batches, enrolments, fees and payments, videos, notifications and activity history,
// and their files (copied to UPLOAD_DIR). Pending migrations are applied first.
//   npm run db:seed
// Only loads into a new database: one with no data, or only the admin accounts made with `npm run create-admin`.
// Existing data is never changed or deleted.
import { env } from '../src/config/env.js';
import { loadSeed, SEED_PASSWORD } from './lib/seed.js';

try {
  console.log(`Loading the seed data into "${env.db.database}" …`);
  const { counts, userIds } = await loadSeed({ log: console.log });
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(30)} ${n}`);
  for (const [from, to] of userIds) console.log(`  seed user ${from} was added as user ${to} (id ${from} was already taken)`);
  console.log(`Done. Each seeded account signs in once with ${SEED_PASSWORD} and must then choose a new password.`);
  console.log('That password is in the repository: before going public, sign in to (or deactivate) every seeded account.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
