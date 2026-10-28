// Writes database/miata_live_db.sql: one SQL script that builds the whole database (every migration) and loads the seed
// data, in a single transaction. Run it on a new, empty database in pgAdmin or psql (instructions are in its header).
//   npm run db:script
// Regenerate it after adding a migration or changing database/seed (`npm test` fails while it is out of date).
import fs from 'node:fs/promises';
import path from 'node:path';
import { API_ROOT } from '../src/config/env.js';
import { buildDatabaseScript, DATABASE_SCRIPT } from './lib/seed.js';

try {
  const sql = await buildDatabaseScript();
  await fs.writeFile(DATABASE_SCRIPT, sql);
  console.log(`Wrote ${path.relative(API_ROOT, DATABASE_SCRIPT)} (${Math.round(sql.length / 1024)} KB).`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
