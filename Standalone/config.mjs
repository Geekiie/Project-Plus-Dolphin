// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(root, 'local.json');

export function defaults() {
  const install = path.resolve(root, '../..');
  const cache = path.join(process.env.APPDATA || '', 'yougame-desktop/orca');
  const pick = (...paths) => paths.find(p => fs.existsSync(p)) || '';
  return {
    executable: pick(path.resolve(root, '../Binary/x64/Release/ProjectPlusRollback.exe'), path.resolve(root, '../Binary/x64/ProjectPlusRollback.exe'), path.join(cache, 'current/Orca/Orca.exe')),
    disc: pick(path.join(install, 'Super Smash Bros. Brawl (USA) (Rev 2).iso')),
    launcher: pick(path.join(cache, 'run/project-rollback/Project+ Netplay Launcher.dol')),
    server: 'http://127.0.0.1:4318', name: 'Player', relayKey: '', delay: 2, adapter: false
  };
}
export function loadConfig() { return { ...defaults(), ...(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}) }; }
export function validateConfig(c) {
  for (const k of ['executable', 'disc', 'launcher']) {
    if (typeof c[k] !== 'string' || !fs.statSync(c[k]).isFile()) throw new Error(`Choose an existing ${k} file`);
  }
  if (!/\.(iso|wbfs|rvz|ciso|gcz|wia)$/i.test(c.disc)) throw new Error('Choose a supported Brawl disc image');
  if (!/\.dol$/i.test(c.launcher) || !fs.existsSync(path.join(path.dirname(c.launcher), 'sd.raw'))) throw new Error('The Project+ launcher needs sd.raw beside it');
  if (/\.iso$/i.test(c.disc)) {
    const fd = fs.openSync(c.disc, 'r'); const header = Buffer.alloc(32);
    try { fs.readSync(fd, header, 0, 32, 0); } finally { fs.closeSync(fd); }
    if (header.subarray(0, 6).toString() !== 'RSBE01' || header[7] !== 2) throw new Error('This profile requires Brawl USA, Rev 2');
  }
  const url = new URL(c.server);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Use HTTPS, or HTTP on this computer');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Relay server must be an origin, such as https://relay.example.com');
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 32 || /[\r\n]/.test(c.name)) throw new Error('Choose a player name of 1–32 characters');
  if (!Number.isInteger(c.delay) || c.delay < 1 || c.delay > 6) throw new Error('Input delay must be 1–6 frames');
  return c;
}
export function saveConfig(c) {
  validateConfig(c);
  const clean = Object.fromEntries(['executable', 'disc', 'launcher', 'server', 'name', 'relayKey', 'delay', 'adapter'].map(k => [k, c[k]]));
  fs.writeFileSync(file, JSON.stringify(clean, null, 2) + '\n'); return clean;
}

export function launchSpec(c, { room = '', joining = false, offline = false, matchmaking = false, user = path.join(root, 'user'), headless = false } = {}) {
  validateConfig(c);
  if (!offline && !/^[a-z0-9]{6,12}$/.test(room)) throw new Error('Room codes use 6–12 lowercase letters and digits');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(YOUGAME_|ORCA_|YG_)/.test(key)) delete env[key];
  Object.assign(env, { ORCA_SESSION: '1', ORCA_PROFILE: 'PPLUS32', ORCA_NAME: c.name, ORCA_TEST_COMMANDS: '1', ORCA_SHADER_WAIT_S: '300' });
  if (c.adapter === true) env.ORCA_ADAPTER = '1';
  if (!offline) {
    // ORCA_SITE/dev support also lets the unchanged installed Orca verify this server before
    // the fork is compiled. ORCA_SERVER is the fork's production setting.
    Object.assign(env, { ORCA_SERVER: c.server, ORCA_SITE: c.server, ORCA_RELAY_KEY: c.relayKey || '', ORCA_TEST_DEV_GAME: c.relayKey || 'standalone', ORCA_ROOM: room, ORCA_JOIN: joining ? '1' : '0' });
    if (matchmaking) env.ORCA_QUEUE = 'casual';
  }
  const args = ['-u', user, '-p', headless ? 'headless' : process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'macos' : 'x11',
    '-C', `Dolphin.Core.DefaultISO=${c.disc}`, '-C', 'Graphics.Settings.ShowFPS=False', '-e', c.launcher];
  if (headless) args.push('-v', 'Null', '-C', 'Dolphin.DSP.Backend=No Audio Output');
  return { executable: c.executable, args, env, cwd: path.dirname(c.launcher) };
}
