import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const migration = readFileSync(new URL('../migrations/20260828233455_commercial_outreach_copy_versions_v3.sql', import.meta.url), 'utf8').replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
const sql = readFileSync(new URL('./commercial-outreach-copy-v3.sql', import.meta.url), 'utf8').replace('-- APPLY_COPY_MIGRATION', () => migration);
// Explicit local-only connection: never reads a production DATABASE_URL.
const result = spawnSync('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55439', '-U', 'admin', '-d', 'bmb_review_release'], { input: sql, encoding: 'utf8' });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
