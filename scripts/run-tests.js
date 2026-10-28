// Runs the test suite against its own throwaway database (TEST_DB_NAME, default miata_test_db) and upload folder
// (TEST_UPLOAD_DIR, default ./uploads-test). Each test file wipes and rebuilds them; the live database is never touched.
//   npm test
import { spawnSync } from 'node:child_process';
import { API_ROOT } from '../src/config/env.js';

const { status } = spawnSync(
  process.execPath,
  ['--import', './tests/setup-env.js', '--test', '--test-reporter=spec', '--test-concurrency=1', 'tests/**/*.test.js'],
  { cwd: API_ROOT, stdio: 'inherit' },
);
process.exitCode = status ?? 1;
