// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root } from './config.mjs';
const run = promisify(execFile);
const cacheFile = path.join(root, 'user/disc-hashes.json');

export async function fingerprint(c) {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const stat = fs.statSync(c.disc), identity = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  if (cache[c.disc]?.identity === identity) return cache[c.disc].sha1;
  let sha1;
  if (/\.iso$/i.test(c.disc)) {
    const hash = createHash('sha1');
    for await (const chunk of fs.createReadStream(c.disc, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
    sha1 = hash.digest('hex');
  } else {
    const tool = path.join(path.dirname(c.executable), process.platform === 'win32' ? 'dolphin-tool.exe' : 'dolphin-tool');
    if (!fs.existsSync(tool)) throw new Error('Compressed discs require dolphin-tool beside the emulator. Use your ISO or build the dolphin-tool target.');
    const result = await run(tool, ['verify', '-i', c.disc, '-a', 'sha1'], { windowsHide: true, timeout: 15 * 60 * 1000 });
    sha1 = result.stdout.trim().split(/\r?\n/).find(line => /^[a-f0-9]{40}$/i.test(line));
    if (!sha1) throw new Error('Dolphin could not fingerprint the disc image');
  }
  cache[c.disc] = { identity, sha1 };
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + '\n'); return sha1;
}
