// SPDX-License-Identifier: GPL-2.0-or-later
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const codeRE = /^[a-z0-9]{6,12}$/;
const keyRE = /^[a-zA-Z0-9._:-]{1,64}$/;
const idRE = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_BLOB = 128 * 1024 * 1024;

export async function readBody(req, limit = 16384) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

// Independent implementation of the room protocol consumed by Orca. No upstream server,
// account, cookie or credential is used. Room codes are invitations: share them privately.
export function createRelay({ publicUrl = '', accessKey = '', ice = [], direct = true } = {}) {
  const tickets = new Map(), rooms = new Map(), blobs = new Map();
  let blobBytes = 0;
  const send = (ws, data) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) return ws.close(4001, 'Slow consumer');
    ws.send(JSON.stringify(data));
  };
  function roster(room) {
    const participants = [...room.peers.values()].map(p => ({ id: p.player, connectionId: p.id, slot: p.slot, name: p.name }));
    return { lifecycle: 'game', host: room.host, revision: room.revision, participants,
      players: participants.map(p => ({ ...p, id: p.connectionId, away: false })), matchId: null };
  }
  function broadcast(room, data, except) {
    for (const p of room.peers.values()) if (p.ws !== except) send(p.ws, data);
  }
  function remove(peer) {
    const room = peer.room;
    if (room.peers.get(peer.id) !== peer) return;
    room.peers.delete(peer.id); room.revision++;
    broadcast(room, { t: 'leave', player: { id: peer.id }, ...roster(room) });
    if (peer.id === room.host) for (const p of room.peers.values()) p.ws.close(4001, 'Host left');
    if (!room.peers.size) {
      rooms.delete(room.key);
      for (const [key, blob] of blobs) if (blob.room === room.key) { blobBytes -= blob.data.length; blobs.delete(key); }
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size });
      if (req.method === 'POST' && url.pathname === '/api/multiplayer/ticket') {
        const body = JSON.parse(await readBody(req));
        if (accessKey && body.dev !== accessKey) return json(res, 403, { error: 'Relay access key required' });
        if (!codeRE.test(body.room) || !idRE.test(body.player_id) || !keyRE.test(body.mode) || !keyRE.test(body.lobby?.compatibility))
          return json(res, 400, { error: 'Invalid room, player, mode or compatibility key' });
        if (tickets.size >= 4096) return json(res, 429, { error: 'Too many tickets' });
        let assignedRoom = body.room, joining = false, searchFirst = false;
        if (body.queue === 'casual') {
          const waiting = [...rooms.values()].find(r => r.queueOpen && r.peers.size === 1 && r.mode === body.mode && r.compatibility === body.lobby.compatibility);
          if (waiting) { assignedRoom = waiting.code; joining = true; waiting.queueOpen = false; }
          else { assignedRoom = randomBytes(4).toString('hex'); searchFirst = true; }
        }
        const token = randomBytes(32).toString('hex');
        tickets.set(token, { room: assignedRoom, player: body.player_id, name: String(body.name || 'Player').slice(0, 32), searchFirst,
          mode: body.mode, compatibility: body.lobby.compatibility, expires: Date.now() + 5 * 60 * 1000 });
        const base = publicUrl || `http://127.0.0.1:${server.address().port}`;
        return json(res, 200, { url: base, ticket: token, keyframes: base + '/api/orca/keyframes', direct, ice, room: assignedRoom, joining });
      }
      const match = /^\/api\/orca\/keyframes\/([a-z0-9]{6,12})\/([a-zA-Z0-9_-]{1,128})$/.exec(url.pathname);
      if (match) {
        const token = String(req.headers.authorization || '').replace(/^Ticket /, '');
        const ticket = tickets.get(token);
        if (!ticket || ticket.expires < Date.now() || ticket.room !== match[1]) return json(res, 401, { code: 'ticket', error: 'Invalid ticket' });
        const roomKey = `${ticket.mode}:${ticket.room}`, room = rooms.get(roomKey);
        if (!room || room.compatibility !== ticket.compatibility || ![...room.peers.values()].some(p => p.player === ticket.player))
          return json(res, 403, { error: 'Join the room before accessing states' });
        const key = `${roomKey}:${match[2]}`, blob = blobs.get(key);
        if (req.method === 'PUT') {
          if (![...room.peers.values()].some(p => p.player === ticket.player && p.id === room.host)) return json(res, 403, { error: 'Only host uploads states' });
          if (blob) return json(res, 409, { code: 'exists' });
          const data = await readBody(req, MAX_BLOB);
          if (blobBytes + data.length > 512 * 1024 * 1024) return json(res, 503, { error: 'State store full' });
          blobs.set(key, { room: roomKey, data, expires: Date.now() + 10 * 60 * 1000 }); blobBytes += data.length;
          return json(res, 200, { ok: true });
        }
        if (req.method === 'GET') {
          if (!blob) return json(res, 404, { error: 'State missing' });
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': blob.data.length });
          return res.end(blob.data);
        }
        if (req.method === 'DELETE') {
          if (blob) { blobBytes -= blob.data.length; blobs.delete(key); }
          return json(res, 200, { ok: true });
        }
      }
      json(res, 404, { error: 'Unknown endpoint' });
    } catch (e) { if (!res.headersSent) json(res, e.status || 400, { error: e.message }); else res.destroy(); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost'), ticket = tickets.get(url.searchParams.get('ticket'));
    const refuse = status => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); };
    if (!ticket || ticket.expires < Date.now() || url.pathname !== `/room/${ticket.room}`) return refuse(401);
    const key = `${ticket.mode}:${ticket.room}`;
    let room = rooms.get(key);
    if (room && room.compatibility !== ticket.compatibility) return refuse(403);
    if (room && [...room.peers.values()].some(p => p.player === ticket.player)) return refuse(409);
    if (room?.peers.size >= 4 || (!room && rooms.size >= 256)) return refuse(429);
    if (!room) { room = { key, code: ticket.room, mode: ticket.mode, queueOpen: ticket.searchFirst, compatibility: ticket.compatibility, peers: new Map(), host: '', revision: 0 }; rooms.set(key, room); }
    sockets.handleUpgrade(req, socket, head, ws => {
      const slots = new Set([...room.peers.values()].map(p => p.slot));
      const slot = [0, 1, 2, 3].find(n => !slots.has(n));
      const peer = { id: randomBytes(12).toString('hex'), slot, player: ticket.player, name: ticket.name, ws, room, alive: true };
      if (!room.host) room.host = peer.id;
      room.peers.set(peer.id, peer); room.revision++;
      send(ws, { t: 'welcome', me: peer.id, room: { queue: 'private', size: 4 }, ...roster(room) });
      broadcast(room, { t: 'join', player: { id: peer.id }, ...roster(room) }, ws);
      let rateStart = Date.now(), messages = 0;
      ws.on('message', (bytes, binary) => {
        try {
          if (binary) return ws.close(1003, 'JSON text only');
          if (Date.now() - rateStart > 1000) { rateStart = Date.now(); messages = 0; }
          if (++messages > 240) return ws.close(1008, 'Rate limit');
          const m = JSON.parse(bytes.toString());
          if (m.t === 'ping') send(ws, { t: 'pong', at: m.at });
          else if (m.t === 'leave') { remove(peer); ws.close(1000); }
          else if (m.t === 'msg' && m.d && typeof m.d === 'object' && !Array.isArray(m.d)) {
            if (m.d.k === 'p' && m.d.s !== slot) return ws.close(1008, 'Wrong input seat');
            const out = { t: 'msg', from: peer.id, d: m.d };
            if (typeof m.to === 'string') { const target = room.peers.get(m.to); if (target && target !== peer) send(target.ws, out); }
            else broadcast(room, out, ws);
          } else send(ws, { t: 'command-error', action: m.t, error: 'Private rooms support inputs, signaling and leave' });
        } catch { ws.close(1007, 'Invalid JSON'); }
      });
      ws.on('pong', () => { peer.alive = true; });
      ws.on('error', () => {});
      ws.on('close', () => remove(peer));
    });
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [token, ticket] of tickets) if (ticket.expires < now) tickets.delete(token);
    for (const [key, blob] of blobs) if (blob.expires < now) { blobBytes -= blob.data.length; blobs.delete(key); }
    for (const room of rooms.values()) for (const peer of room.peers.values()) {
      if (!peer.alive) peer.ws.terminate(); else { peer.alive = false; peer.ws.ping(); }
    }
  }, 30000); cleanup.unref();
  return { server, rooms, async close() {
    clearInterval(cleanup); for (const room of rooms.values()) for (const p of room.peers.values()) p.ws.terminate();
    await new Promise(resolve => server.close(resolve)); sockets.close();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = createRelay({ publicUrl: process.env.PUBLIC_URL || '', accessKey: process.env.RELAY_KEY || '',
    ice: process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : [] });
  const port = Number(process.env.PORT || 4318), host = process.env.HOST || '127.0.0.1';
  relay.server.listen(port, host, () => console.log(`Standalone relay listening on ${host}:${port}`));
  process.on('SIGINT', async () => { await relay.close(); process.exit(); });
}
