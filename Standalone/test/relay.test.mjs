// SPDX-License-Identifier: GPL-2.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay } from '../relay.mjs';

test('rooms relay inputs, isolate incompatible games and transfer encrypted state blobs', async () => {
  const relay = createRelay({ direct: false, accessKey: 'testkey' });
  relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening');
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  const peers = [];
  try {
    async function ticket(player, compatibility = 'orca1:test', room = 'testroom') {
      const res = await fetch(origin + '/api/multiplayer/ticket', { method: 'POST', body: JSON.stringify({ dev: 'testkey', player_id: player, name: player, room, mode: 'orca-pplus32', lobby: { compatibility } }) });
      assert.equal(res.status, 200); return res.json();
    }
    async function connect(t) {
      const ws = new WebSocket(t.url.replace('http:', 'ws:') + '/room/testroom?ticket=' + t.ticket);
      const queue = [], waiters = [];
      ws.on('message', raw => { const message = JSON.parse(raw); const waiting = waiters.shift(); if (waiting) waiting(message); else queue.push(message); });
      ws.next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve));
      ws.until = async type => { for (let i = 0; i < 20; i++) { const m = await ws.next(); if (m.t === type) return m; } throw Error('Missing ' + type); };
      peers.push(ws); await once(ws, 'open'); return ws;
    }
    const aTicket = await ticket('host'), a = await connect(aTicket), welcomeA = await a.until('welcome');
    assert.equal(welcomeA.participants[0].slot, 0);
    const bTicket = await ticket('guest'), b = await connect(bTicket), welcomeB = await b.until('welcome');
    assert.equal(welcomeB.participants[1].slot, 1); assert.equal(welcomeB.host, welcomeA.me);
    await a.until('join');
    b.send(JSON.stringify({ t: 'ping', at: 123 })); assert.deepEqual(await b.until('pong'), { t: 'pong', at: 123 });
    const packet = { k: 'p', s: 0, f: 40, c: 42, p: 'abcd', a: [42, 42, -1, -1] };
    a.send(JSON.stringify({ t: 'msg', d: packet })); const received = await b.until('msg');
    assert.equal(received.from, welcomeA.me); assert.deepEqual(received.d, packet);
    const bad = await ticket('wrongbuild', 'orca1:different');
    const refused = new WebSocket(bad.url.replace('http:', 'ws:') + '/room/testroom?ticket=' + bad.ticket);
    const [error] = await once(refused, 'error'); assert.match(error.message, /403/);
    const data = Buffer.from('already encrypted state from emulator');
    const store = origin + '/api/orca/keyframes/testroom/keyframe1';
    const authA = { Authorization: 'Ticket ' + aTicket.ticket }, authB = { Authorization: 'Ticket ' + bTicket.ticket };
    assert.equal((await fetch(store, { method: 'PUT', headers: authB, body: data })).status, 403);
    assert.equal((await fetch(store, { method: 'PUT', headers: authA, body: data })).status, 200);
    assert.equal((await fetch(store, { method: 'PUT', headers: authA, body: data })).status, 409);
    assert.deepEqual(Buffer.from(await (await fetch(store, { headers: authB })).arrayBuffer()), data);
    const other = await ticket('otherroom', 'orca1:test', 'elsewhere');
    assert.equal((await fetch(store, { headers: { Authorization: 'Ticket ' + other.ticket } })).status, 401);
    assert.equal((await fetch(store, { method: 'DELETE', headers: authB })).status, 200);
    assert.equal((await fetch(store, { headers: authA })).status, 404);
    b.send(JSON.stringify({ t: 'leave' })); const left = await a.until('leave');
    assert.equal(left.participants.length, 1); assert.equal(left.participants[0].slot, 0);
  } finally { for (const ws of peers) ws.terminate(); await relay.close(); }
});

test('casual matchmaking pairs only compatible waiting hosts', async () => {
  const relay = createRelay({ direct: false });
  relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening');
  const origin = `http://127.0.0.1:${relay.server.address().port}`; let socket;
  const ticket = async (player, compatibility) => (await fetch(origin + '/api/multiplayer/ticket', {
    method: 'POST', body: JSON.stringify({ dev: 'standalone', player_id: player, name: player, room: 'ignored1', mode: 'orca-pplus32', queue: 'casual', lobby: { compatibility } })
  })).json();
  try {
    const a = await ticket('player1', 'build1'); assert.equal(a.joining, false);
    socket = new WebSocket(a.url.replace('http:', 'ws:') + '/room/' + a.room + '?ticket=' + a.ticket);
    await once(socket, 'message');
    const incompatible = await ticket('player2', 'build2'); assert.notEqual(incompatible.room, a.room); assert.equal(incompatible.joining, false);
    const b = await ticket('player3', 'build1'); assert.equal(b.room, a.room); assert.equal(b.joining, true);
    const c = await ticket('player4', 'build1'); assert.notEqual(c.room, a.room); assert.equal(c.joining, false);
  } finally { socket?.terminate(); await relay.close(); }
});
