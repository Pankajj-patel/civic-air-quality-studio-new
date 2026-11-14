import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.SQLITE_DB_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'civic-aqi-test-'));
  process.env.SQLITE_DB_PATH = path.join(dir, 'test.db');
}
process.env.NODE_ENV = 'test';
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'civic-aqi-test-suite-secret-key-2026';
}
