import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createSessionProvider} from '../src/native-sessions.js';

function fixture(provider = 'codex', behavior = {}) {
  const providers = new Map([[provider, {config: {model: 'test-model', permissionMode: provider === 'codex' ? 'never' : 'dontAsk', env: {}, disposeGraceMs: 1000}, start() {}}]]);
  const native = new Map(), requests = [], spawns = [], sessions = [], events = [];
  let exits = 0;
  const ctx = {get() {}, subagents: {getProvider: name => providers.get(name), registerProvider: p => {providers.set(p.name, p); return () => providers.delete(p.name);}},
    subprocess: {spawn(spec) {
      spawns.push(spec);
      const stdout = new PassThrough(), stderr = new PassThrough(), done = Promise.withResolvers();
      const send = frame => stdout.write(JSON.stringify({jsonrpc: '2.0', ...frame}) + '\n');
      let threadId;
      const stdin = new Writable({write(chunk, _enc, next) {
        for (const line of chunk.toString().trim().split('\n').filter(Boolean)) {
          const frame = JSON.parse(line); requests.push(frame);
          if (!frame.method || frame.id == null) continue;
          if (frame.method === 'initialize') send({id: frame.id, result: {}});
          if (frame.method === 'thread/start') {threadId = randomUUID(); native.set(threadId, true); send({id: frame.id, result: {thread: {id: threadId, ephemeral: false}}});}
          if (frame.method === 'thread/resume') {
            threadId = frame.params.threadId;
            send(native.has(threadId) ? {id: frame.id, result: {thread: {id: behavior.wrongId ? randomUUID() : threadId, ephemeral: false}}} : {id: frame.id, error: {code: -1, message: 'missing native history'}});
          }
          if (['turn/start', 'thread/compact/start'].includes(frame.method)) {
            const turnId = randomUUID(), compact = frame.method === 'thread/compact/start';
            const notify = () => {
              send({method: 'turn/started', params: {threadId, turn: {id: turnId}}});
              send({method: 'item/completed', params: {threadId, turnId, item: compact ? {type: 'contextCompaction'} : {type: 'agentMessage', phase: 'final_answer', text: 'answer'}}});
              send({method: 'turn/completed', params: {threadId, turn: {id: turnId, status: behavior.overflow ? 'failed' : 'completed', ...(behavior.overflow ? {error: {codexErrorInfo: 'contextWindowExceeded'}} : {})}}});
            };
            if (behavior.early && !behavior.hang) notify();
            send({id: frame.id, result: compact ? {} : {turn: {id: turnId}}});
            if (!behavior.early && !behavior.hang) setImmediate(notify);
          }
        }
        next();
      }});
      return {stdin, stdout, stderr, done: done.promise, terminate() {exits++; done.resolve({exitCode: 0, signal: null});}, waitForExit: async () => {if (behavior.cleanupFailure) throw new Error('cannot observe range'); return true;}};
    }}};
  const continuity = {binding: 'task-execution-binding', operation: 'task', onSession: s => sessions.push(s), onEvent: e => events.push(e)};
  const options = {model: 'test-model', reasoningEffort: 'high', continuity};
  const dependencies = {resolveRuntime: () => ({argv: ['/fake/codex']})};
  const execute = async (extra = {}) => {
    const configured = await createSessionProvider(ctx, provider, {...options, ...extra}, dependencies);
    try {
      const run = await providers.get(configured.name).start({cwd: process.cwd(), prompt: [{type: 'text', text: 'task'}], signal: new AbortController().signal});
      try {return {result: await run.result, failure: configured.failure()};} finally {await run.dispose();}
    } finally {configured.dispose();}
  };
  return {ctx, options, dependencies, continuity, execute, providers, sessions, events, requests, spawns, native, get exits() {return exits;}};
}

test('原生 Codex 会话在首轮前保存，后续恢复；早到通知和进程释放正确', async () => {
  const f = fixture('codex', {early: true});
  assert.equal((await f.execute()).result.stopReason, 'completed');
  const first = f.sessions.at(-1);
  assert.equal(first.turns, 1); assert(f.events.some(e => e.type === 'created'));
  assert.equal((await f.execute({continuity: {...f.continuity, previous: first}})).result.stopReason, 'completed');
  assert.equal(f.sessions.at(-1).id, first.id); assert.equal(f.sessions.at(-1).turns, 2);
  assert(f.events.some(e => e.type === 'resumed')); assert.equal(f.exits, 2);
  assert.equal(f.requests.filter(r => r.method === 'thread/start').length, 1);
  assert.equal(f.requests.filter(r => r.method === 'thread/resume').length, 1);
  assert.equal(f.requests.find(r => r.method === 'thread/start').params.ephemeral, false);
});

test('恢复不到原历史时阻塞，不暗中新建会话或发送业务提示', async () => {
  const f = fixture(); await f.execute(); const first = f.sessions.at(-1); f.native.clear();
  await assert.rejects(f.execute({continuity: {...f.continuity, previous: first}}), {code: 'ORCHESTRATOR_SESSION_BLOCKED'});
  assert.equal(f.requests.filter(r => r.method === 'thread/start').length, 1);
  assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1);
  assert.equal(f.exits, 2);
});

test('后端返回另一个会话 ID 时拒绝执行', async () => {
  const f = fixture('codex', {wrongId: true}); await f.execute();
  await assert.rejects(f.execute({continuity: {...f.continuity, previous: f.sessions.at(-1)}}), {code: 'ORCHESTRATOR_SESSION_BLOCKED'});
  assert.equal(f.requests.filter(r => r.method === 'turn/start').length, 1);
});

test('会话归属不匹配在启动进程前拒绝，原生配置变化则明确建立新会话', async () => {
  const f = fixture(); await f.execute(); const first = f.sessions.at(-1);
  await assert.rejects(f.execute({continuity: {...f.continuity, previous: {...first, binding: 'another-task'}}}), /归属/);
  assert.equal(f.spawns.length, 1);
  f.providers.get('codex').config.model = 'changed-native-model';
  await f.execute({continuity: {...f.continuity, previous: first}});
  assert.notEqual(f.sessions.at(-1).id, first.id); assert(f.events.some(e => e.type === 'replaced'));
});

test('Codex 超限保存恢复标记；压缩等待完成事件且不提交业务 turn', async () => {
  const f = fixture('codex', {overflow: true});
  const failed = await f.execute();
  assert.equal(failed.result.stopReason, 'error'); assert.equal(failed.failure.code, 'ORCHESTRATOR_CONTEXT_LIMIT');
  assert.equal(f.sessions.at(-1).recovery, 'compact');
  const normal = fixture(); await normal.execute(); const previous = normal.sessions.at(-1);
  const compact = await normal.execute({continuity: {...normal.continuity, previous, operation: 'compact'}});
  assert.equal(compact.result.stopReason, 'completed'); assert.equal(normal.sessions.at(-1).compactions, 1);
  assert.equal(normal.requests.filter(r => r.method === 'turn/start').length, 1);
  assert.equal(normal.requests.filter(r => r.method === 'thread/compact/start').length, 1);
});

test('Claude 使用持久会话及相同 resume，保留权限并观察压缩边界', async () => {
  const f = fixture('claude-code'), calls = [];
  f.dependencies.query = ({prompt, options}) => {
    calls.push({prompt, options});
    options.spawnClaudeCodeProcess({command: '/fake/claude', args: ['--permission-mode', options.permissionMode], cwd: options.cwd, env: options.env, signal: options.abortController.signal});
    const iterator = (async function* () {
      const session_id = options.resume ?? options.sessionId;
      yield {type: 'system', subtype: 'init', session_id};
      if (prompt.startsWith('/compact')) yield {type: 'system', subtype: 'compact_boundary', session_id};
      yield {type: 'result', subtype: 'success', is_error: false, result: 'answer', session_id};
    })();
    iterator.close = () => {}; return iterator;
  };
  await f.execute(); const previous = f.sessions.at(-1);
  await f.execute({continuity: {...f.continuity, previous}});
  await f.execute({continuity: {...f.continuity, previous: f.sessions.at(-1), operation: 'compact'}});
  assert.equal(calls[0].options.persistSession, true); assert.equal(calls[1].options.resume, previous.id);
  assert.equal(calls[0].options.settings.autoCompactEnabled, true);
  assert.equal(calls[0].options.permissionMode, 'dontAsk');
  assert(!f.spawns[0].argv.at(-1).includes('Write')); assert.equal(f.sessions.at(-1).compactions, 1);
  assert.equal(f.exits, 3);
});

test('原生 Codex 取消立即结束等待，dispose 幂等且等待 managed range 释放', async () => {
  const f = fixture('codex', {hang: true});
  const configured = await createSessionProvider(f.ctx, 'codex', f.options, f.dependencies);
  const controller = new AbortController();
  try {
    const run = await f.providers.get(configured.name).start({cwd: process.cwd(), prompt: [{type: 'text', text: 'task'}], signal: controller.signal});
    controller.abort(); assert.equal((await run.result).stopReason, 'aborted');
    await Promise.all([run.dispose(), run.dispose()]); assert.equal(f.exits, 1);
  } finally {configured.dispose();}
});

test('无法确认 managed range 释放时报告清理失败', async () => {
  const f = fixture('codex', {cleanupFailure: true});
  await assert.rejects(f.execute(), {code: 'ORCHESTRATOR_CLEANUP_FAILED'});
});
