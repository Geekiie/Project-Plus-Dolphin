// SPDX-License-Identifier: GPL-2.0-or-later
// Run explicitly with npm's dependencies installed and local.json pointing at your own game.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { loadConfig, launchSpec, root } from '../config.mjs';

const config = loadConfig(), peers = [], dir = path.join(root, 'test-output');
const matchmaking = process.env.STANDALONE_MATCH_TEST === '1';
fs.mkdirSync(dir, { recursive: true });
const started = Date.now(), room = 'smoke' + Math.random().toString(36).slice(2, 8);
function start(name, joining) {
  const spec = launchSpec({ ...config, name }, { room, joining, matchmaking, user: path.join(dir, 'user-' + name), headless: true });
  Object.assign(spec.env, { YG_INPUT: path.resolve(root, 'test/network-inputs.txt'), YG_SCENES: '1', YG_THROTTLE: '1', ORCA_DIRECT: '0', ORCA_TEST_NET_DELAY_MS: '55' });
  spec.args.push('-C', 'Logger.Logs.ROLLBACK=True', '-C', 'Logger.Logs.NETPLAY=True', '-C', 'Logger.Options.Verbosity=3');
  const child = spawn(spec.executable, spec.args, { env: spec.env, cwd: spec.cwd, windowsHide: true });
  const out = fs.createWriteStream(path.join(dir, name + '.stdout.log'));
  const err = fs.createWriteStream(path.join(dir, name + '.stderr.log'));
  child.stderr.pipe(err);
  const peer = { child, lines: [], stats: [], exit: null }; peers.push(peer);
  let pending = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', data => {
    out.write(data); pending += data; const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) {
      peer.lines.push(line);
      if (line.startsWith('orca stats ')) peer.stats.push(JSON.parse(line.slice(11)));
      else console.log(`${((Date.now() - started)/1000).toFixed(1)} ${name}: ${line}`);
      if (line.startsWith('orca caps ')) child.stdin.write('caps join leave stats delay direct\ndelay 2\n');
      if (line.startsWith('ready')) child.stdin.write('delay 2\n');
    }
  });
  child.on('error', e => { peer.exit = e.message; });
  child.on('exit', code => { peer.exit = code; out.end(); });
  return peer;
}
async function until(check, timeout, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const peer of peers) {
      assert.equal(peer.exit, null, 'Emulator exited before ' + label);
      assert.ok(!peer.lines.some(line => line.startsWith('orca error ')), 'Emulator reported error before ' + label + ': ' + peer.lines.filter(l => l.startsWith('orca error ')).join('; '));
    }
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('Timeout: ' + label);
}
try {
  const host = start('Host', false);
  await until(() => host.stats.some(s => s.f >= 900), 90000, 'host boot');
  const guest = start('Guest', true);
  await until(() => guest.lines.includes('orca state playing') && host.stats.some(s => s.peers > 0), 120000, 'HTTP state transfer and join');
  await until(() => host.stats.some(s => s.rb > 0) && guest.stats.some(s => s.rb > 0) && host.stats.filter(s => s.peers > 0).length >= 35 && guest.stats.filter(s => s.peers > 0).length >= 35, 120000, '35 seconds of synchronized rollback play');
  for (const [name, peer] of [['Host',host],['Guest',guest]]) {
    const together = peer.stats.filter(s => s.peers > 0);
    const summary = { seconds: together.length, rollbacks: together.reduce((n,s)=>n+s.rb,0), resimulated: together.reduce((n,s)=>n+s.rbf,0), latest: together.at(-1) };
    assert.ok(summary.rollbacks > 0, 'Late inputs should exercise rollback');
    assert.equal(summary.latest.delay, 2, 'Explicit input delay must remain fixed');
    fs.writeFileSync(path.join(dir, name + '.summary.json'), JSON.stringify(summary, null, 2));
    console.log(name, JSON.stringify(summary));
  }
  guest.child.stdin.write('leave\n');
  await until(() => guest.lines.includes('orca state left') && host.lines.some(l=>l.startsWith('orca state friend-left')), 30000, 'guest leave');
  console.log('PASS: independent relay, HTTP encrypted state transfer, rollback play, guest leave');
} finally {
  for (const peer of peers) if (peer.exit === null) peer.child.stdin.write('quit\n');
  await new Promise(resolve => setTimeout(resolve, 3000));
  for (const peer of peers) if (peer.exit === null) peer.child.kill();
}
