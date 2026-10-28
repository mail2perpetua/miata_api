import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../src/config/env.js';
import { pool } from '../src/config/db.js';
import { buildDatabaseScript, DATABASE_SCRIPT, loadSeed, readSeedTable, SEED_PASSWORD, SEED_TABLES } from '../scripts/lib/seed.js';
import { api, closeDatabase, createUser, resetDatabase } from './helpers.js';

/** Sign in as a seeded account, skipping the new-password step every seeded account must take first. */
async function signIn(email, role) {
  await pool.query('UPDATE users SET must_reset_password = FALSE, password_reset_reason = NULL WHERE email = $1', [email]);
  const res = await api().post('/api/auth/login').send({ email, password: SEED_PASSWORD, role });
  assert.equal(res.status, 200, `${email} can sign in`);
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
}

/** Every table's rows and every sequence's position, to compare two ways of building the database. */
async function fingerprint() {
  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY 1`,
  );
  const result = {};
  for (const { table_name: t } of tables) {
    // The default settings come from the migrations, stamped with the time they ran.
    const row = t === 'app_settings' ? `(to_jsonb(x) - 'updated_at')` : 'to_jsonb(x)';
    const { rows } = await pool.query(`SELECT md5(COALESCE(string_agg(${row}::text, '|' ORDER BY ${row}::text), '')) AS sum FROM ${t} x`);
    result[t] = rows[0].sum;
  }
  const { rows: seqs } = await pool.query(`SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1`);
  for (const s of seqs) result[`sequence ${s.sequencename}`] = s.last_value;
  return result;
}

before(async () => {
  await resetDatabase();
  await loadSeed();
});
after(closeDatabase);

describe('seed data', () => {
  it('loads every seed table completely, with no duplicates', async () => {
    for (const table of SEED_TABLES) {
      const expected = (await readSeedTable(table)).length;
      const { rows } = await pool.query(`SELECT count(*)::int AS n, count(DISTINCT to_jsonb(t)::text)::int AS d FROM ${table} t`);
      assert.equal(rows[0].n, expected, `${table} row count`);
      assert.equal(rows[0].d, rows[0].n, `${table} has duplicate rows`);
    }
  });

  it('makes every seeded account choose a new password at first sign-in', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM users WHERE must_reset_password AND password_reset_reason = 'admin_request'`,
    );
    assert.equal(rows[0].n, 13);
    const res = await api().post('/api/auth/login').send({ email: 'admin@miata.local', password: SEED_PASSWORD, role: 'admin' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.passwordResetRequired, true);
    assert.equal(res.body.data.accessToken, undefined, 'no session until a new password is set');
  });

  it('keeps relationships intact and continues id sequences after the loaded rows', async () => {
    const { rows } = await pool.query(`INSERT INTO courses (code, title) VALUES ('SEQCHECK', 'Sequence check') RETURNING id`);
    const maxSeedId = Math.max(...(await readSeedTable('courses')).map((c) => c.id));
    assert.ok(rows[0].id > maxSeedId, 'new ids continue after the seed ids');
    await pool.query(`DELETE FROM courses WHERE code = 'SEQCHECK'`);
  });

  it('copies every referenced upload file', async () => {
    for (const f of await readSeedTable('files')) {
      const file = path.join(env.uploads.dir, f.storage_key);
      assert.ok(fs.existsSync(file), `${f.storage_key} exists`);
      assert.equal(fs.statSync(file).size, Number(f.size_bytes), `${f.storage_key} size`);
    }
  });

  it('serves the seed data through the API for every role', async () => {
    const expectations = {
      'admin@miata.local': ['admin', '/api/admin/dashboard', (d) => d.stats.totalStudents === 5],
      'ramesh.agent@miata.local': ['agent', '/api/agent/dashboard', (d) => d.counts.total === 2],
      'niveditha@miata.local': ['professor', '/api/professor/modules', (d) => d.length === 4],
      'arun.kumar@miata.local': ['student', '/api/student/dashboard', (d) => d.stats.totalCourses === 1],
    };
    for (const [email, [role, path, check]] of Object.entries(expectations)) {
      const res = await api()
        .get(path)
        .set(await signIn(email, role));
      assert.equal(res.status, 200, path);
      assert.ok(check(res.body.data), `${path} returns the seed records`);
    }
  });

  it('holds only the required accounts: one admin, the five lecturers as professors, five students and two agents', async () => {
    const { rows } = await pool.query(
      `SELECT role, array_agg(full_name ORDER BY id) AS names FROM users WHERE is_active GROUP BY role ORDER BY role`,
    );
    assert.deepEqual(rows, [
      { role: 'admin', names: ['MIATA Administrator'] },
      { role: 'agent', names: ['Ramesh Kumar', 'Priya Nair'] },
      { role: 'professor', names: ['Dr. Niveditha', 'Jai', 'Dr. Saranya', 'Dr. Suzmitha', 'Dr. Bagyavasan'] },
      { role: 'student', names: ['Arun Kumar', 'Priya Sharma', 'Sneha Reddy', 'Meera Iyer', 'Divya Pillai'] },
    ]);
    const { rows: inactive } = await pool.query('SELECT count(*)::int AS n FROM users WHERE NOT is_active');
    assert.equal(inactive[0].n, 0);
  });

  it('includes fees, payment proofs, batches and agent referrals for the students', async () => {
    const fees = await api()
      .get('/api/student/fees')
      .set(await signIn('arun.kumar@miata.local', 'student'));
    assert.deepEqual(fees.body.data.totals, { payable: 26000, paid: 10000, pending: 6000, balance: 16000 });
    assert.equal(fees.body.data.payments.length, 2);

    const { rows } = await pool.query(
      `SELECT u.full_name, b.name AS batch, a.full_name AS agent FROM users u
       JOIN batch_students bs ON bs.student_id = u.id JOIN batches b ON b.id = bs.batch_id
       LEFT JOIN agent_referrals r ON r.student_id = u.id LEFT JOIN users a ON a.id = r.agent_id
       WHERE u.role = 'student' ORDER BY u.id`,
    );
    assert.deepEqual(
      rows.map((r) => [r.full_name, r.batch, r.agent]),
      [
        ['Arun Kumar', 'PGDU Batch 2026-A', 'Ramesh Kumar'],
        ['Priya Sharma', 'PGDU Batch 2026-A', 'Ramesh Kumar'],
        ['Sneha Reddy', 'PGDU Batch 2026-A', 'Priya Nair'],
        ['Meera Iyer', 'Clinical Training 2026', null],
        ['Divya Pillai', 'PGDU Batch 2026-B', null],
      ],
    );
  });

  it('includes the 2026–2027 MIATA Postgraduate Sonography course with its weekly timetable', async () => {
    const res = await api()
      .get('/api/admin/courses/6')
      .set(await signIn('admin@miata.local', 'admin'));
    const course = res.body.data;
    assert.equal(course.title, 'MIATA Postgraduate Sonography');
    assert.deepEqual([course.academicYear, course.startDate, course.endDate], ['2026–2027', '2026-10-19', '2027-04-18']);
    assert.equal(course.modules.length, 15);
    const lessons = course.modules.flatMap((m) => m.lessons);
    assert.equal(lessons.filter((l) => !l.weekNumber).length, 212, 'curriculum topics');
    assert.equal(lessons.filter((l) => l.weekNumber).length, 96, 'weekly sessions');
    assert.deepEqual(
      course.lecturers.map((l) => [l.lecturerName, l.sessionCount, l.professorName]),
      [
        ['Dr. Niveditha', 26, 'Dr. Niveditha'],
        ['Jai', 24, 'Jai'],
        ['Dr. Saranya', 8, 'Dr. Saranya'],
        ['Dr. Suzmitha', 12, 'Dr. Suzmitha'],
        ['Dr. Bagyavasan', 26, 'Dr. Bagyavasan'],
      ],
      'each lecturer linked to their professor account',
    );
    // Module professors are the lecturers of each module's sessions; nobody teaches the excluded cardiac module.
    assert.deepEqual(
      course.modules.map((m) => m.professors.map((p) => p.fullName).join(', ')),
      [
        'Dr. Niveditha',
        'Dr. Bagyavasan, Dr. Niveditha',
        'Dr. Niveditha',
        'Dr. Bagyavasan, Dr. Saranya',
        'Dr. Niveditha',
        'Dr. Bagyavasan, Dr. Saranya',
        'Jai',
        '',
        'Dr. Bagyavasan',
        'Dr. Bagyavasan',
        'Dr. Bagyavasan',
        'Dr. Bagyavasan',
        'Dr. Bagyavasan',
        'Dr. Bagyavasan',
        'Dr. Suzmitha',
      ],
    );

    const timetable = await api()
      .get('/api/professor/timetable')
      .set(await signIn('niveditha@miata.local', 'professor'));
    assert.equal(timetable.body.data.length, 1);
    assert.equal(timetable.body.data[0].myLecturerIds.length, 1);
  });

  it('includes module statuses set by the professors who teach them', async () => {
    const res = await api()
      .get('/api/professor/modules')
      .set(await signIn('niveditha@miata.local', 'professor'));
    assert.deepEqual(
      res.body.data.map((m) => m.teachingStatus),
      ['in_progress', 'not_started', 'not_started', 'not_started'],
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM module_statuses WHERE status = 'in_progress'`);
    assert.equal(rows[0].n, 7);
  });

  it('refuses to load the seed into a database that already has data', async () => {
    await assert.rejects(loadSeed(), /already has data in .*only loads into a new database/);
  });

  it('keeps database/miata_live_db.sql up to date (regenerate with npm run db:script)', async () => {
    const onDisk = fs.readFileSync(DATABASE_SCRIPT, 'utf8').replace(/\r\n/g, '\n');
    assert.ok(onDisk === (await buildDatabaseScript()), 'database/miata_live_db.sql is out of date: run npm run db:script');
  });

  it('builds the same database from database/miata_live_db.sql as npm run db:seed does', async () => {
    await resetDatabase();
    await loadSeed();
    const seeded = await fingerprint();

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pool.query(fs.readFileSync(DATABASE_SCRIPT, 'utf8'));
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    assert.equal(
      rows[0].n,
      fs.readdirSync(path.join(path.dirname(DATABASE_SCRIPT), 'migrations')).filter((f) => f.endsWith('.sql')).length,
    );
    assert.deepEqual(await fingerprint(), seeded);
  });

  it('loads next to an admin made first with npm run create-admin, without changing it', async () => {
    await resetDatabase();
    const owner = await createUser('admin', { email: 'owner@test.local' });
    const { rows: before } = await pool.query('SELECT count(*)::int AS n FROM activity_logs');

    const { userIds } = await loadSeed();
    assert.deepEqual([...userIds], [[Number(owner.id), 20]], 'the seed admin moves past the existing ids');
    const { rows } = await pool.query(
      `SELECT (SELECT id::int FROM users WHERE email = 'admin@miata.local') AS seed_admin,
              (SELECT email FROM users WHERE id = $1) AS owner_email,
              (SELECT count(*)::int FROM courses WHERE created_by = $1) AS owner_courses,
              (SELECT count(*)::int FROM courses WHERE created_by = 20) AS seed_admin_courses,
              (SELECT count(*)::int FROM activity_logs) AS logs`,
      [owner.id],
    );
    assert.deepEqual(rows[0], {
      seed_admin: 20,
      owner_email: 'owner@test.local',
      owner_courses: 0,
      seed_admin_courses: 6,
      logs: before[0].n + (await readSeedTable('activity_logs')).length,
    });
  });
});
