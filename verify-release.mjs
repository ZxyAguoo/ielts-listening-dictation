import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'));
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

assert.deepEqual(manifest.cleanInitialState, { wrongEntries: 0, customBooks: 0, historyRounds: 0 });
for (const item of manifest.files) {
  const file = path.join(root, item.path);
  assert.ok(fs.existsSync(file), `Missing ${item.path}`);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, item.bytes, `Size mismatch: ${item.path}`);
  assert.equal(digest(bytes), item.sha256, `Hash mismatch: ${item.path}`);
}
assert.ok(fs.existsSync(path.join(root, 'site', '.nojekyll')));
assert.ok(!fs.existsSync(path.join(root, 'functions')));
assert.ok(!fs.existsSync(path.join(root, 'site', 'login.html')));
console.log(JSON.stringify({ ok: true, version: manifest.version, files: manifest.files.length }));
