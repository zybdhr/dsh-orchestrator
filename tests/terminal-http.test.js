import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mountRoutes} from '../src/http.js';

function fixture() {
  let handler; const calls = [];
  const entry = {id: 'terminal', meta: {owner: 'owner', runId: 'run', taskId: 'task', phase: '执行'}, lease: 'lease'};
  const state = {id: 'run', owner: 'owner', status: 'running', tasks: [], calls: []};
  const pool = {
    list: owner => owner === 'owner' ? [{id: entry.id}] : [],
    owned(id, owner) {if (id !== entry.id || owner !== entry.meta.owner) throw new Error('归属错误'); return entry;},
    async takeover() {if (entry.broken) throw new Error('PTY 不可写'); return {id: entry.id, lease: entry.lease};},
    async input(id, owner, data, lease) {if (lease !== entry.lease) throw new Error('控制权失效'); calls.push(['input', data]);},
    async release() {calls.push(['release']); return {id: entry.id};},
  };
  const engine = {adapter: {terminals: pool}, active: {state}, snapshot: () => state, control: (...args) => calls.push(['control', ...args])};
  mountRoutes({get: () => ({requestRejection: req => req.headers.cookie === 'login' ? undefined : 401}), webServer: {register(spec) {handler = spec.handler;}}}, engine);
  const request = async (path, body, extra = {}) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    req.method = body ? 'POST' : 'GET'; req.url = `/dsh-orchestrator/api/${path}`;
    req.headers = {cookie: 'login', host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', 'x-dsh-orchestrator': '1', ...extra};
    const result = {};
    await handler(req, {writeHead(code) {result.code = code;}, end(text) {result.body = JSON.parse(text);}});
    return result;
  };
  return {request, calls, state, entry};
}

test('终端读取和写入均经过认证及来源检查，跨会话操作拒绝', async () => {
  const f = fixture();
  assert.equal((await f.request('terminals?owner=owner', null, {cookie: ''})).code, 401);
  assert.deepEqual((await f.request('terminals?owner=other')).body.terminals, []);
  const body = {id: 'terminal', owner: 'owner', action: 'takeover'};
  assert.equal((await f.request('terminal/control', body, {'x-dsh-orchestrator': ''})).code, 403);
  assert.equal((await f.request('terminal/control', body, {origin: 'https://evil.example'})).code, 403);
  assert.equal((await f.request('terminal/control', {...body, owner: 'other'})).code, 400);
  assert.equal(f.calls.length, 0);
});

test('接管会暂停所属编排，输入必须持有当前租约', async () => {
  const f = fixture(), body = {id: 'terminal', owner: 'owner', action: 'takeover'};
  assert.equal((await f.request('terminal/control', body)).body.lease, 'lease');
  assert.deepEqual(f.calls[0], ['control', 'run', 'owner', 'pause']);
  assert.equal((await f.request('terminal/control', {...body, action: 'input', data: 'test', lease: 'old'})).code, 400);
  assert.equal((await f.request('terminal/control', {...body, action: 'input', data: 'test', lease: 'lease'})).code, 200);
  assert.deepEqual(f.calls.at(-1), ['input', 'test']);
  f.entry.broken = true;
  assert.equal((await f.request('terminal/control', body)).code, 400);
  assert.deepEqual(f.calls.at(-1), ['control', 'run', 'owner', 'pause']);
});

test('已经完成的编排不能通过交还按钮再次执行', async () => {
  const f = fixture(); f.state.status = 'completed';
  const response = await f.request('terminal/control', {id: 'terminal', owner: 'owner', action: 'release', lease: 'lease', resume: true});
  assert.equal(response.code, 400); assert.match(response.body.error, /已结束/);
  assert.equal(f.calls.length, 0);
});
