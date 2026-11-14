import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const setup = fileURLToPath(new URL('./setup.mjs', import.meta.url));
function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), 'browser-hand-setup-test-'));
  const resources = path.join(home, 'Applications/Browser Hand.app/Contents/Resources');
  mkdirSync(path.join(resources, 'runtime'), { recursive: true });
  mkdirSync(path.join(resources, 'bin'), { recursive: true });
  for (const file of ['runtime/node', 'runtime/relay.mjs', 'bin/browser-hand-safari']) writeFileSync(path.join(resources, file), 'fixture');
  return { home, resources, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}
const run = f => spawnSync(process.execPath, [setup, f.resources], { env: { ...process.env, HOME: f.home }, encoding: 'utf8' });

test('does not replace an existing command', () => {
  const f = fixture();
  try {
    const command = path.join(f.home, '.local/bin/browser-hand-safari');
    mkdirSync(path.dirname(command), { recursive: true });
    writeFileSync(command, 'keep');
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/);
    assert.equal(readFileSync(command, 'utf8'), 'keep');
    assert.equal(existsSync(path.join(f.home, 'Library/LaunchAgents')), false);
  } finally { f.cleanup(); }
});

test('does not replace a different login item', () => {
  const f = fixture();
  try {
    const plist = path.join(f.home, 'Library/LaunchAgents/ai.autojack.browserhand.safari.standalone.plist');
    mkdirSync(path.dirname(plist), { recursive: true });
    writeFileSync(plist, 'keep');
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /login item already exists/);
    assert.equal(readFileSync(plist, 'utf8'), 'keep');
    assert.equal(existsSync(path.join(f.home, '.local/bin/browser-hand-safari')), false);
  } finally { f.cleanup(); }
});

test('refuses an occupied port without changing the account', async t => {
  const f = fixture();
  const server = net.createServer();
  try {
    try {
      await new Promise((resolve, reject) => server.once('error', reject).listen(19334, '127.0.0.1', resolve));
    } catch (error) {
      if (error.code === 'EADDRINUSE') { t.skip('port is already occupied by the installed relay'); return; }
      throw error;
    }
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [setup, f.resources], { env: { ...process.env, HOME: f.home } });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', code => resolve({ code, stderr }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /port 19334 is already in use/);
    assert.equal(existsSync(path.join(f.home, '.local/bin/browser-hand-safari')), false);
  } finally { server.close(); f.cleanup(); }
});
