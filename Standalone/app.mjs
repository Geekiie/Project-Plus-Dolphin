// SPDX-License-Identifier: GPL-2.0-or-later
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createRelay, readBody, json } from './relay.mjs';
import { loadConfig, saveConfig, launchSpec, root } from './config.mjs';
import { fingerprint } from './fingerprint.mjs';

const relay = createRelay();
relay.server.listen(4318, '127.0.0.1');
relay.server.on('error', e => console.error('Local relay unavailable:', e.message));
const token = randomBytes(24).toString('hex');
let child = null, lines = [], lastExit = null;
let starting = false;
let gameState = '';
let generation = 0;
const push = line => { lines.push(line); if (lines.length > 300) lines.shift(); };
const ui = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('__TOKEN__', token);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.headers.host !== '127.0.0.1:4317' && req.headers.host !== 'localhost:4317') return json(res, 403, { error: 'Invalid host' });
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" }); return res.end(ui);
    }
    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'Launcher token required' });
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { config: loadConfig(), running: !!child || starting, lines, lastExit, gameState });
    if (req.method !== 'POST') return json(res, 404, { error: 'Unknown action' });
    const body = JSON.parse(await readBody(req));
    if (url.pathname === '/api/pick') {
      if (process.platform !== 'win32') throw new Error('Enter the full file path on this operating system');
      const filters = { disc: 'Brawl disc image|*.iso;*.wbfs;*.rvz;*.ciso;*.gcz;*.wia', launcher: 'Project+ launcher|*.dol', executable: 'Emulator|*.exe' };
      if (!filters[body.kind]) throw new Error('Unknown file type');
      const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $picker=New-Object System.Windows.Forms.OpenFileDialog; $picker.Filter='${filters[body.kind]}'; $picker.CheckFileExists=$true; if($picker.ShowDialog() -eq 'OK'){[Console]::WriteLine($picker.FileName)}; $picker.Dispose()`;
      const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true });
      return json(res, 200, { path: result.stdout.trim() });
    }
    if (url.pathname === '/api/config') return json(res, 200, { config: saveConfig(body) });
    if (url.pathname === '/api/start') {
      if (child || starting) throw new Error('Stop the running game first');
      if (!['offline', 'host', 'join', 'match'].includes(body.mode)) throw new Error('Choose Offline, Host, Join or Find match');
      const c = saveConfig(body.config), room = (body.mode === 'host' && !body.room) || body.mode === 'match' ? randomBytes(4).toString('hex') : body.room;
      if (body.mode === 'match' && path.basename(c.executable).toLowerCase() !== 'projectplusrollback.exe') throw new Error('Find match requires this fork\'s compiled executable');
      const spec = launchSpec(c, { room, joining: body.mode === 'join', offline: body.mode === 'offline', matchmaking: body.mode === 'match' });
      starting = true;
      const launchGeneration = ++generation;
      try { spec.env.ORCA_DISC_SHA1 = await fingerprint(c); } finally { starting = false; }
      if (launchGeneration !== generation) throw new Error('Launch cancelled');
      fs.mkdirSync(path.join(root, 'user/Config'), { recursive: true });
      // Existing local controller mappings can be imported without any account data.
      const pad = path.join(process.env.APPDATA || '', 'yougame-desktop/orca/user/Config/GCPadNew.ini');
      const ownPad = path.join(root, 'user/Config/GCPadNew.ini');
      if (!fs.existsSync(ownPad) && fs.existsSync(pad)) fs.copyFileSync(pad, ownPad);
      lines = []; lastExit = null; gameState = 'booting';
      const current = spawn(spec.executable, spec.args, { env: spec.env, cwd: spec.cwd, windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] });
      child = current;
      current.stdin.on('error', e => push('Game input closed: ' + e.message));
      for (const stream of [current.stdout, current.stderr]) {
        let pending = '';
        stream.setEncoding('utf8'); stream.on('data', data => {
          pending += data; const parts = pending.split(/\r?\n/); pending = parts.pop();
          for (const line of parts) {
            push(line);
            if (line.startsWith('orca state ')) gameState = line.slice(11);
            if (line.startsWith('orca error ')) gameState = 'error: ' + line.slice(11);
            if (line.startsWith('orca caps ')) current.stdin.write('caps join leave host pause delay perf direct\n');
            if (line.startsWith('ready')) current.stdin.write(`delay ${c.delay}\nping on\nperf fps\n`);
          }
        });
      }
      current.on('error', e => { push(e.message); if (child === current) child = null; });
      current.on('exit', code => { lastExit = code; if (child === current) child = null; push(`Game exited (${code})`); });
      return json(res, 200, { room: body.mode === 'offline' || body.mode === 'match' ? '' : room });
    }
    if (url.pathname === '/api/stop') {
      generation++; const current = child; current?.stdin.write('quit\n');
      if (current) setTimeout(() => { if (child === current) current.kill(); }, 8000).unref();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/command') {
      if (!/^(leave|pause|resume|ping (on|off)|perf (off|fps|detailed)|delay (auto|[1-6]))$/.test(body.command)) throw new Error('Unsupported command');
      child?.stdin.write(body.command + '\n'); return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'Unknown action' });
  } catch (e) { json(res, 400, { error: e.message }); }
});
server.listen(4317, '127.0.0.1', () => console.log('Project+ Standalone: http://127.0.0.1:4317'));
process.on('SIGINT', () => { child?.stdin.write('quit\n'); server.close(); relay.close().then(() => process.exit()); });
