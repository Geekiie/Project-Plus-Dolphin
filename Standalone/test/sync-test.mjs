// SPDX-License-Identifier: GPL-2.0-or-later
// Explicit test: requires your local game and compiled emulator.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { loadConfig, launchSpec, root } from '../config.mjs';

const dir = path.join(root, 'test-output'); fs.mkdirSync(dir, { recursive: true });
const spec = launchSpec(loadConfig(), { offline: true, headless: true, user: path.join(dir, 'user-sync') });
Object.assign(spec.env, { YG_INPUT: path.resolve(root, '../Tools/orca/inputs/pplus-1v1.txt'),
  YG_SYNCTEST: '5', YG_EXIT_AFTER: '2400', YG_SCENES: '1', ORCA_JITWARM: '0', ORCA_THREAD_QOS: '0' });
spec.args.push('-C', 'Logger.Logs.ROLLBACK=True', '-C', 'Logger.Options.Verbosity=3');
const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, windowsHide: true });
let output = '';
for (const stream of [child.stdout, child.stderr]) { stream.setEncoding('utf8'); stream.on('data', data => { output += data; }); }
const timeout = setTimeout(() => child.kill(), 180000);
const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
clearTimeout(timeout);
fs.writeFileSync(path.join(dir, 'sync.log'), output);
assert.equal(exit, 0, 'Sync test must finish normally');
assert.ok(output.includes('-> scMelee'), 'Sync test must reach an actual match');
assert.match(output, /0 RAM mismatches/, 'Every restored/replayed frame must match RAM exactly');
assert.ok(!output.includes('orca error '), 'No terminal emulation error');
console.log(output.split(/\r?\n/).filter(line => /mismatches|Sync test|Harness ended|synctest/.test(line)).join('\n'));
console.log('PASS: 2400-frame Project+ run, repeated five-frame rewind, exact RAM comparison');
