import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const port = 19334;
const label = 'ai.autojack.browserhand.safari.standalone';
const resources = path.resolve(process.argv[2] || '');
const app = path.resolve(resources, '../..');
const home = homedir();
const userApps = path.join(home, 'Applications') + path.sep;
const cli = path.join(home, '.local/bin/browser-hand-safari');
const target = path.join(resources, 'bin/browser-hand-safari');
const plist = path.join(home, 'Library/LaunchAgents', label + '.plist');
const logs = path.join(home, 'Library/Logs/Browser Hand');
const node = path.join(resources, 'runtime/node');
const relay = path.join(resources, 'runtime/relay.mjs');
const uid = userInfo().uid;
const domain = `gui/${uid}`;
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const str = s => `<string>${escape(s)}</string>`;
const makeConfig = resourceDir => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key>${str(label)}
<key>ProgramArguments</key><array>${str(path.join(resourceDir, 'runtime/node'))}${str(path.join(resourceDir, 'runtime/relay.mjs'))}</array>
<key>EnvironmentVariables</key><dict><key>HOST</key>${str('127.0.0.1')}<key>PORT</key>${str(String(port))}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key>${str(path.join(logs, 'relay.out'))}
<key>StandardErrorPath</key>${str(path.join(logs, 'relay.err'))}
</dict></plist>\n`;
const config = makeConfig(resources);

function present(p) { try { lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function launchctl(...args) { return spawnSync('/bin/launchctl', args, { encoding: 'utf8' }); }
async function freePort() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function install() {
  if (!(app.startsWith(userApps) || app.startsWith('/Applications/')) || !app.endsWith('.app')) {
    throw new Error('Move Browser Hand to Applications before setting it up, then open it again.');
  }
  for (const file of [node, relay, target]) if (!existsSync(file)) throw new Error('The app is missing a required component. Download it again.');
  const hasPlist = present(plist);
  const currentPlist = hasPlist ? readFileSync(plist, 'utf8') : null;
  const existingLink = present(cli) && lstatSync(cli).isSymbolicLink() ? readlinkSync(cli) : null;
  // Recognize only the exact configuration written by the earlier Safari app.
  const legacyResources = [path.join(home, 'Applications/Browser Hand Safari.app/Contents/Resources'),
    '/Applications/Browser Hand Safari.app/Contents/Resources']
    .find(dir => currentPlist === makeConfig(dir) && (!present(cli) || existingLink === path.join(dir, 'bin/browser-hand-safari')));
  if (present(cli) && existingLink !== target && !legacyResources) {
    throw new Error(`The command ${cli} already exists. Move it aside before setting up Browser Hand.`);
  }
  if (hasPlist && currentPlist !== config && !legacyResources) {
    throw new Error(`A different Browser Hand login item already exists at ${plist}. It was left unchanged.`);
  }
  let running = launchctl('print', `${domain}/${label}`).status === 0;
  if (running && !hasPlist) throw new Error('A different Browser Hand login item is already running. It was left unchanged.');
  if (!running && !(await freePort())) throw new Error(`Local port ${port} is already in use. Stop the other service and try again.`);
  mkdirSync(path.dirname(cli), { recursive: true });
  mkdirSync(path.dirname(plist), { recursive: true });
  mkdirSync(logs, { recursive: true });
  let createdCli = false, createdPlist = false, started = false;
  let backedUpCli = false, backedUpPlist = false, stoppedLegacy = false;
  const cliBackup = `${cli}.previous-${process.pid}`;
  const plistBackup = `${plist}.previous-${process.pid}`;
  try {
    if (legacyResources) {
      if (present(cliBackup) || present(plistBackup)) throw new Error('Cannot safely back up the previous setup.');
      if (running) {
        const result = launchctl('bootout', domain, plist);
        if (result.status !== 0) throw new Error(`Could not stop the previous relay: ${(result.stderr || '').trim()}`);
        stoppedLegacy = true;
        running = false;
      }
      if (present(cli)) { renameSync(cli, cliBackup); backedUpCli = true; }
      renameSync(plist, plistBackup); backedUpPlist = true;
      let available = false;
      for (let i = 0; i < 25; i++) {
        if (await freePort()) { available = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!available) throw new Error(`Local port ${port} is already in use. Stop the other service and try again.`);
    }
    if (!present(cli)) { symlinkSync(target, cli); createdCli = true; }
    if (!present(plist)) { writeFileSync(plist, config, { flag: 'wx', mode: 0o600 }); createdPlist = true; }
    if (!running) {
      const result = launchctl('bootstrap', domain, plist);
      if (result.status !== 0) throw new Error(`Could not start the login item: ${(result.stderr || '').trim()}`);
      started = true;
    }
    let ok = false;
    for (let i = 0; i < 30; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) });
        if (response.ok) { ok = true; break; }
      } catch { /* relay is starting */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ok) throw new Error(`The relay did not start. Check ${path.join(logs, 'relay.err')}.`);
    if (backedUpCli) unlinkSync(cliBackup);
    if (backedUpPlist) unlinkSync(plistBackup);
    console.log(`Ready. Enable Browser Hand in Safari Settings → Extensions, then run ~/.local/bin/browser-hand-safari doctor.`);
  } catch (error) {
    if (started) launchctl('bootout', domain, plist);
    if (createdPlist) unlinkSync(plist);
    if (createdCli) unlinkSync(cli);
    if (backedUpPlist) renameSync(plistBackup, plist);
    if (backedUpCli) renameSync(cliBackup, cli);
    if (stoppedLegacy) launchctl('bootstrap', domain, plist);
    throw error;
  }
}

install().catch(error => { console.error(error.message); process.exitCode = 1; });
