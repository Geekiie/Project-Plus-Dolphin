// SPDX-License-Identifier: GPL-2.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchSpec } from '../config.mjs';

test('launcher keeps paths as arguments and removes platform credentials and inherited harness settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pplus launch '));
  try {
    const c = { executable: path.join(dir, 'emulator.exe'), launcher: path.join(dir, 'Project+ Netplay Launcher.dol'), disc: path.join(dir, 'Brawl.iso'), server: 'http://127.0.0.1:4318', name: 'Test', delay: 2, relayKey: '' };
    fs.writeFileSync(c.executable, ''); fs.writeFileSync(c.launcher, ''); fs.writeFileSync(path.join(dir, 'sd.raw'), '');
    const header = Buffer.alloc(32); header.write('RSBE01'); header[7] = 2; fs.writeFileSync(c.disc, header);
    process.env.YOUGAME_TOKEN = 'must-not-inherit'; process.env.YG_SYNCTEST = '99';
    const spec = launchSpec(c, { room: 'abcdef12' });
    assert.equal(spec.env.YOUGAME_TOKEN, undefined); assert.equal(spec.env.YG_SYNCTEST, undefined);
    assert.equal(spec.env.ORCA_SERVER, c.server); assert.equal(spec.args.at(-1), c.launcher);
    assert.ok(spec.args.includes(`Dolphin.Core.DefaultISO=${c.disc}`));
    assert.equal(launchSpec(c, { offline: true }).env.ORCA_SERVER, undefined);
    assert.throws(() => launchSpec({ ...c, server: 'http://untrusted.example' }, { room: 'abcdef12' }), /HTTPS/);
    header[7] = 1; fs.writeFileSync(c.disc, header);
    assert.throws(() => launchSpec(c, { room: 'abcdef12' }), /Rev 2/);
  } finally { delete process.env.YOUGAME_TOKEN; delete process.env.YG_SYNCTEST; fs.rmSync(dir, { recursive: true, force: true }); }
});
