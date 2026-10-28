import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { API_ROOT, env } from '../../src/config/env.js';
import { ensureDatabase, runMigrations } from '../../src/config/migrator.js';

export const SEED_DIR = path.join(API_ROOT, 'database', 'seed');
export const MIGRATIONS_DIR = path.join(API_ROOT, 'database', 'migrations');
export const DATABASE_SCRIPT = path.join(API_ROOT, 'database', 'miata_live_db.sql');

// Every seeded account signs in with this password once, then must choose a new one.
export const SEED_PASSWORD = 'Miata-6C75DR9';

// Insertion order respects foreign keys. Settings, session tokens and reset tokens are never part of the seed.
export const SEED_TABLES = [
  'users',
  'student_profiles',
  'professor_profiles',
  'agent_profiles',
  'courses',
  'agent_referrals',
  'modules',
  'course_lecturers',
  'lessons',
  'batches',
  'batch_courses',
  'batch_students',
  'batch_professors',
  'module_batches',
  'course_enrolments',
  'professor_course_assignments',
  'professor_module_assignments',
  'module_statuses',
  'files',
  'fee_payments',
  'videos',
  'video_batches',
  'video_progress',
  'assignments',
  'assignment_students',
  'assignment_submissions',
  'assignment_reviews',
  'submission_comments',
  'enquiries',
  'enquiry_notes',
  'notifications',
  'activity_logs',
  'meetings',
  'meeting_participants',
  'email_deliveries',
];

// Tables without an identity `id` column (no sequence to move past the loaded rows).
const NO_IDENTITY = new Set(['student_profiles', 'professor_profiles', 'agent_profiles', 'meeting_participants']);

// Code sequences continue after the highest seeded code (STU1008 → next STU1009).
const CODE_SEQUENCES = [
  ['student_code_seq', 'student_code', 'student_profiles'],
  ['professor_code_seq', 'employee_code', 'professor_profiles'],
];

export async function readSeedTable(table) {
  return JSON.parse(await fs.readFile(path.join(SEED_DIR, 'tables', `${table}.json`), 'utf8'));
}

const sequenceSql = (table) =>
  `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(max(id), 1), max(id) IS NOT NULL) FROM ${table}`;
const codeSequenceSql = ([seq, column, table]) =>
  `SELECT setval('${seq}', COALESCE(max(substring(${column} FROM 4)::int), 1001), max(${column}) IS NOT NULL) FROM ${table}`;

/**
 * Load database/seed into `database` (the live database by default) and its files into `uploadDir`.
 * The database must be new: no data, or only the admin accounts made with `npm run create-admin`. Seed users whose ids
 * those admins already hold get the next free ids (every reference follows), and activity entries get new ids after the
 * existing ones. Existing rows and files are never changed. Returns the row count per table and the user ids moved.
 */
export async function loadSeed({ database = env.db.database, uploadDir = env.uploads.dir, log = () => {} } = {}) {
  await ensureDatabase(database);
  await runMigrations({ database, log });
  const client = new pg.Client({ ...env.db, database });
  await client.connect();
  try {
    const refuse = (what) => new Error(`"${database}" already has ${what}. The seed only loads into a new database.`);
    for (const table of SEED_TABLES) {
      if (table === 'users' || table === 'activity_logs') continue;
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      if (rows[0].n) throw refuse(`data in ${table}`);
    }
    const { rows: existing } = await client.query('SELECT id::int, lower(email) AS email, role FROM users');
    if (existing.some((u) => u.role !== 'admin')) throw refuse('non-admin accounts');
    const seedUsers = await readSeedTable('users');
    const clash = seedUsers.find((u) => existing.some((x) => x.email === u.email.toLowerCase()));
    if (clash) throw refuse(`an account ${clash.email}`);

    let nextId = Math.max(0, ...existing.map((u) => u.id), ...seedUsers.map((u) => u.id));
    const userIds = new Map(seedUsers.filter((u) => existing.some((x) => x.id === u.id)).map((u) => [u.id, ++nextId]));
    const remap = (id) => userIds.get(id) ?? id;
    const { rows: userColumns } = await client.query(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema)
         JOIN information_schema.constraint_column_usage ccu USING (constraint_name, table_schema)
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.table_name = 'users'`,
    );
    const { rows: logs } = await client.query('SELECT count(*)::int AS n FROM activity_logs');

    const counts = {};
    await client.query('BEGIN');
    for (const table of SEED_TABLES) {
      const columns = userColumns.filter((c) => c.table_name === table).map((c) => c.column_name);
      const data = (await readSeedTable(table)).map((row) => {
        const out = { ...row };
        for (const c of columns) out[c] = remap(out[c]);
        if (table === 'users') out.id = remap(out.id);
        if (table === 'activity_logs' && out.entity_type === 'user') out.entity_id = remap(out.entity_id);
        return out;
      });
      counts[table] = data.length;
      if (!data.length) continue;
      if (table === 'activity_logs' && logs[0].n) {
        // Nothing references activity entries, so they take the next ids after the existing ones, in seed order.
        const cols = Object.keys(data[0]).filter((c) => c !== 'id');
        await client.query(
          `INSERT INTO activity_logs (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::activity_logs, $1::json) ORDER BY id`,
          [JSON.stringify(data)],
        );
        continue;
      }
      // Ids are kept as in the seed files so every relationship stays intact.
      await client.query(`INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`, [
        JSON.stringify(data),
      ]);
    }
    // Continue identity and code sequences after the loaded rows.
    for (const table of SEED_TABLES) if (!NO_IDENTITY.has(table)) await client.query(sequenceSql(table));
    for (const seq of CODE_SEQUENCES) await client.query(codeSequenceSql(seq));
    await client.query('COMMIT');

    // Existing files are kept (force: false); the seed's file names are unique UUIDs.
    await fs.cp(path.join(SEED_DIR, 'uploads'), uploadDir, { recursive: true, force: false });
    return { counts, userIds };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * The text of database/miata_live_db.sql: every migration, then the seed data, in one transaction, for a new, empty
 * database. Rows are inserted exactly as `loadSeed` inserts them into an empty database, so both give the same data.
 */
export async function buildDatabaseScript() {
  const migrations = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const out = [
    '-- MIATA: the complete database (schema + seed data) in one script.',
    '-- Generated by `npm run db:script` from database/migrations and database/seed. Do not edit by hand.',
    '--',
    '-- Run it on a new, empty database (miata_live_db):',
    '--   pgAdmin: create the database, open its Query Tool, open this file, Execute.',
    '--   psql:    psql -h localhost -U postgres -d miata_live_db -f database/miata_live_db.sql',
    '-- It is one transaction: if anything fails (for example the database is not empty), nothing is created.',
    '-- Afterwards copy database/seed/uploads/* into UPLOAD_DIR (the seeded videos and payment proofs), then run',
    '-- `npm run create-admin` for your own admin login.',
    `-- Every seeded account signs in once with ${SEED_PASSWORD} and must then choose a new password.`,
    '',
    "SET client_encoding = 'UTF8';",
    'SET standard_conforming_strings = on;',
    'BEGIN;',
    '',
    'CREATE TABLE IF NOT EXISTS schema_migrations (',
    '  name TEXT PRIMARY KEY,',
    '  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()',
    ');',
  ];
  for (const file of migrations) {
    const sql = (await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8')).replace(/\r\n/g, '\n').trimEnd();
    out.push('', `-- ═══ Migration ${file} ═══`, '', sql, '', `INSERT INTO schema_migrations (name) VALUES ('${file}');`);
  }
  out.push('', '-- ═══ Seed data (database/seed/tables) ═══');
  for (const table of SEED_TABLES) {
    const data = await readSeedTable(table);
    if (!data.length) continue;
    const json = data.map((row) => JSON.stringify(row)).join(',\n');
    if (json.includes('$seed$')) throw new Error(`${table}.json contains "$seed$", which this script uses as its quote`);
    out.push(
      '',
      `-- ${table}: ${data.length} row(s)`,
      `INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_recordset(NULL::${table}, $seed$[`,
      json,
      ']$seed$);',
    );
  }
  out.push('', '-- Continue identity and code sequences after the loaded rows.');
  for (const table of SEED_TABLES) if (!NO_IDENTITY.has(table)) out.push(`${sequenceSql(table)};`);
  for (const seq of CODE_SEQUENCES) out.push(`${codeSequenceSql(seq)};`);
  out.push('', 'COMMIT;', '');
  return out.join('\n');
}
