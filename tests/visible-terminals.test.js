import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {VisibleTerminals} from '../src/visible-terminals.js';
import {hookEvent, permissionRequestHash} from '../src/terminal-hook.mjs';

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsho-terminal-'));
  const handles = [], sessions = []; let pool;
  const ctx = {subagents: {getProvider: () => ({config: {env: {}}})}, subprocess: {
    async spawnTerminal(spec) {
      const done = Promise.withResolvers(), output = new PassThrough();
      const handle = {output, done: done.promise, writes: [], spec,
        async write(text) {
          this.writes.push(text);
          if (text === '\r' && options.complete !== false) {
            const entry = [...pool.entries.values()].find(entry => entry.pty === handle);
            const active = JSON.parse(readFileSync(join(entry.directory, 'active.json')));
            writeFileSync(join(entry.directory, 'event.json'), JSON.stringify({eventId: active.jobId, type: 'completed', jobId: active.jobId,
              sessionId: options.wrongSession && entry.sessionId ? 'wrong-session' : 'native-session', text: 'answer'}));
          }
        },
        async terminate() {if (options.cleanupFailure) throw new Error('still alive'); done.resolve({exitCode: 0});},
      };
      handles.push(handle); return handle;
    },
  }};
  pool = new VisibleTerminals(ctx, {root, maxLive: options.maxLive ?? 2, resolveRuntime: () => ({argv: ['mock-codex']}), screenFactory: () => ({
    buffer: {active: {length: 1, getLine: () => ({translateToString: () => 'Ask Codex'})}}, write(_text, done) {done();}, dispose() {},
  })});
  const args = {provider: 'codex', cwd: process.cwd(), parent: {}, access: 'read', verification: [], modelOptions: {}, prompt: 'task',
    signal: new AbortController().signal, terminalInfo: {owner: 'owner', runId: 'run', taskId: 'task', phase: '执行'},
    continuity: {binding: 'binding', onSession: session => sessions.push(session)}};
  t.after(async () => {options.cleanupFailure = false; await pool.close(); rmSync(root, {recursive: true, force: true});});
  return {pool, args, handles, sessions};
}

test('完成回调必须匹配当前调用；人工消息不能伪造自动完成', () => {
  const active = {jobId: 'job', marker: '[DSH_CALL:job]'};
  const codex = {'thread-id': 'session', type: 'agent-turn-complete', 'last-assistant-message': 'done', 'input-messages': ['old', `${active.marker}\ntask`]};
  assert.equal(hookEvent('codex', codex, active).type, 'completed');
  assert.equal(hookEvent('codex', {...codex, 'input-messages': [active.marker, 'human message']}, active), undefined);
  assert.equal(hookEvent('codex', {...codex, 'input-messages': [`Generate a title for this user message: ${active.marker}\ntask`]}, active), undefined);
  assert.equal(hookEvent('codex', {...codex, 'thread-id': 'background'}, null, null, {sessionId: 'session'}), undefined);
  const claude = {session_id: 'session', hook_event_name: 'Stop', last_assistant_message: 'done'};
  assert.equal(hookEvent('claude-code', claude, active, {sessionId: 'session', jobId: 'other'}).type, 'manual-completed');
  assert.equal(hookEvent('claude-code', claude, active, {sessionId: 'session', jobId: 'job'}).jobId, 'job');
  assert.equal(hookEvent('codex', {...codex, 'thread-id': '../escape'}, active), undefined);
});

test('同一任务连续调用复用 PTY 和原生历史，审核独立分配', async t => {
  const f = fixture(t);
  assert.equal((await f.pool.execute(f.args)).text, 'answer');
  await f.pool.execute({...f.args, continuity: {...f.args.continuity, previous: f.sessions.at(-1)}});
  assert.equal(f.handles.length, 1); assert.equal(f.sessions.at(-1).turns, 2);
  await f.pool.execute({...f.args, continuity: {...f.args.continuity, binding: 'review-binding'}, terminalInfo: {...f.args.terminalInfo, phase: '审核'}});
  assert.equal(f.handles.length, 2);
  assert.equal(f.pool.list('another-owner').length, 0);
  assert.equal(f.pool.list('owner')[0].screen, undefined);
});

test('授权事件只关联当前原生会话及调用，不输出批准决定', () => {
  const active = {jobId: 'job', marker: '[DSH_CALL:job]'}, started = {sessionId: 'session', jobId: 'job'};
  const payload = {session_id: 'session', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {command: 'secret'}};
  const event = hookEvent('claude-code', payload, active, started, {sessionId: 'session'});
  assert.deepEqual(event, {type: 'permission-required', sessionId: 'session', jobId: 'job', toolName: 'Bash'});
  assert.equal(hookEvent('claude-code', payload, active, {...started, jobId: 'old'}), undefined);
  assert.equal(hookEvent('claude-code', {...payload, session_id: 'other'}, active, started), undefined);
  assert.equal(hookEvent('claude-code', payload, null, started), undefined);
  assert.equal(hookEvent('claude-code', {...payload, permission_mode: 'dontAsk'}, active, started), undefined);
  assert.equal(hookEvent('claude-code', {...payload, hook_event_name: 'Notification', notification_type: 'idle_prompt'}, active, started), undefined);
  assert.equal(hookEvent('claude-code', {...payload, hook_event_name: 'Notification', notification_type: 'permission_prompt'}, active, started).type, 'permission-required');
});

test('等待授权立即中断自动调用并保留 PTY；接管不会取消授权框', async t => {
  const f = fixture(t, {complete: false});
  const controller = new AbortController();
  let alerted = 0;
  const call = f.pool.execute({...f.args, signal: controller.signal, onAttention: error => {alerted++; controller.abort(error);}});
  while (!f.handles[0]?.writes.includes('\r')) await new Promise(resolve => setTimeout(resolve, 10));
  const entry = [...f.pool.entries.values()][0], active = JSON.parse(readFileSync(join(entry.directory, 'active.json')));
  entry.sessionId = 'session';
  writeFileSync(join(entry.directory, 'attention.json'), JSON.stringify({type: 'permission-required', jobId: 'old', sessionId: 'session', toolName: 'Bash'}));
  await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(alerted, 0);
  writeFileSync(join(entry.directory, 'attention.json'), JSON.stringify({type: 'permission-required', jobId: active.jobId, sessionId: 'session', toolName: 'Bash'}));
  await assert.rejects(call, {code: 'ORCHESTRATOR_APPROVAL_REQUIRED'});
  assert.equal(alerted, 1); assert.equal(entry.status, 'waiting'); assert(entry.pty);
  assert.equal(f.handles[0].spec.signal.aborted, false, '编排暂停不能通过宿主 signal 杀掉授权终端');
  await assert.rejects(f.pool.execute(f.args), /人工接管/);
  const writes = f.handles[0].writes.length, lease = await f.pool.takeover(entry.id, 'owner');
  assert.equal(f.handles[0].writes.length, writes);
  await f.pool.input(entry.id, 'owner', '1\r', lease.lease);
  assert.equal(f.handles[0].writes.at(-1), '1\r');
});

test('Claude 请求通过 DSH 原生选项展示完整参数，并只向匹配的请求回传选择', async t => {
  const f = fixture(t, {complete: false}), answer = Promise.withResolvers(), waits = [];
  let shown;
  const parent = {ctx: {get(name) {assert.equal(name, 'userQuestions'); return {ask: request => {shown = request; return answer.promise;}};}}};
  const call = f.pool.execute({...f.args, parent, onPermissionWait: value => waits.push(value)});
  while (!f.handles[0]?.writes.includes('\r')) await new Promise(resolve => setTimeout(resolve, 10));
  const entry = [...f.pool.entries.values()][0], active = JSON.parse(readFileSync(join(entry.directory, 'active.json')));
  entry.sessionId = 'session';
  const requestId = '12345678-1234-4123-8123-123456789012';
  const path = join(entry.directory, `permission-request-${requestId}.json`);
  const request = {requestId, jobId: active.jobId, sessionId: 'session', toolName: 'Bash', toolInput: {command: 'printf safe'}};
  request.requestHash = permissionRequestHash(request); writeFileSync(path, JSON.stringify(request));
  while (!shown) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(shown.agent, parent); assert.match(shown.questions[0].detail, /printf safe/);
  assert.deepEqual(shown.questions[0].options.map(option => option.label), ['允许本次', '拒绝']);
  assert.equal(entry.status, 'waiting'); assert.deepEqual(waits, [true]);
  answer.resolve({answers: [{id: shown.questions[0].id, selected: ['允许本次']}]});
  const response = join(entry.directory, `permission-response-${requestId}.json`);
  while (!readable(response)) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(JSON.parse(readFileSync(response)), {requestId, requestHash: request.requestHash, behavior: 'allow'});
  assert.deepEqual(waits, [true, false]);
  writeFileSync(join(entry.directory, 'event.json'), JSON.stringify({eventId: 'completed', type: 'completed', jobId: active.jobId, sessionId: 'session', text: 'answer'}));
  assert.equal((await call).text, 'answer');
});

test('接管授权等待不发送中断或接收迟到的弹窗选择', async t => {
  const f = fixture(t, {complete: false}), answer = Promise.withResolvers();
  let shown;
  const parent = {ctx: {get: () => ({ask: request => {shown = request; return answer.promise;}})}};
  const call = f.pool.execute({...f.args, parent});
  while (!f.handles[0]?.writes.includes('\r')) await new Promise(resolve => setTimeout(resolve, 10));
  const entry = [...f.pool.entries.values()][0], active = JSON.parse(readFileSync(join(entry.directory, 'active.json')));
  entry.sessionId = 'session'; const requestId = '12345678-1234-4123-8123-123456789013';
  const request = {requestId, jobId: active.jobId, sessionId: 'session', toolName: 'Bash', toolInput: {command: 'printf safe'}};
  request.requestHash = permissionRequestHash(request); writeFileSync(join(entry.directory, `permission-request-${requestId}.json`), JSON.stringify(request));
  while (!shown) await new Promise(resolve => setTimeout(resolve, 10));
  const count = f.handles[0].writes.length;
  await f.pool.takeover(entry.id, 'owner');
  await assert.rejects(call, /接管终端/);
  answer.resolve({answers: [{id: shown.questions[0].id, selected: ['允许本次']}]});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.handles[0].writes.length, count);
  assert.equal(JSON.parse(readFileSync(join(entry.directory, `permission-response-${requestId}.json`))).behavior, 'fallback');
});

test('确认时请求参数发生变化则回到原生授权，不能批准被替换的命令', async t => {
  const f = fixture(t, {complete: false}), answer = Promise.withResolvers(); let shown;
  const parent = {ctx: {get: () => ({ask: request => {shown = request; return answer.promise;}})}};
  const controller = new AbortController(), call = f.pool.execute({...f.args, parent, signal: controller.signal});
  while (!f.handles[0]?.writes.includes('\r')) await new Promise(resolve => setTimeout(resolve, 10));
  const entry = [...f.pool.entries.values()][0], active = JSON.parse(readFileSync(join(entry.directory, 'active.json')));
  entry.sessionId = 'session'; const requestId = '12345678-1234-4123-8123-123456789014';
  const path = join(entry.directory, `permission-request-${requestId}.json`);
  const request = {requestId, jobId: active.jobId, sessionId: 'session', toolName: 'Bash', toolInput: {command: 'printf safe'}};
  request.requestHash = permissionRequestHash(request); writeFileSync(path, JSON.stringify(request));
  while (!shown) await new Promise(resolve => setTimeout(resolve, 10));
  writeFileSync(path, JSON.stringify({...request, toolInput: {command: 'different command'}}));
  answer.resolve({answers: [{id: shown.questions[0].id, selected: ['允许本次']}]});
  const response = join(entry.directory, `permission-response-${requestId}.json`);
  while (!readable(response)) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(JSON.parse(readFileSync(response)).behavior, 'fallback');
  controller.abort(new Error('test finished')); await assert.rejects(call, /test finished/);
});

function readable(path) {try {readFileSync(path); return true;} catch {return false;}}

test('人工接管阻止自动投递；租约更新拒绝旧输入，交还保留历史', async t => {
  const f = fixture(t); await f.pool.execute(f.args);
  const entry = [...f.pool.entries.values()][0];
  await assert.rejects(f.pool.takeover(entry.id, 'other'), /不属于/);
  const first = await f.pool.takeover(entry.id, 'owner');
  await assert.rejects(f.pool.execute(f.args), /人工接管/);
  const second = await f.pool.takeover(entry.id, 'owner');
  await assert.rejects(f.pool.input(entry.id, 'owner', 'old', first.lease), /控制权/);
  await f.pool.input(entry.id, 'owner', 'human', second.lease);
  assert.equal(f.handles[0].writes.at(-1), 'human');
  assert.equal(f.pool.list('owner', entry.id)[0].lease, undefined);
  const released = await f.pool.release(entry.id, 'owner', second.lease);
  assert.equal(released.status, 'closed'); assert.equal(released.nativeSessionId, 'native-session');
  await assert.rejects(f.pool.input(entry.id, 'owner', 'late', second.lease), /控制权/);
});

test('达到终端上限仅回收空闲自动终端，人工终端不会被挤掉', async t => {
  const f = fixture(t, {maxLive: 1}); await f.pool.execute(f.args);
  const entry = [...f.pool.entries.values()][0]; await f.pool.takeover(entry.id, 'owner');
  const other = {...f.args, continuity: {...f.args.continuity, binding: 'other'}};
  await assert.rejects(f.pool.execute(other), /上限/); assert.equal(f.handles.length, 1);
  await f.pool.release(entry.id, 'owner', entry.lease); await f.pool.execute(other);
  assert.equal(f.handles.length, 2);
});

test('并发分配不能回收仍在启动的终端或重复占用同一终端', async t => {
  const f = fixture(t, {maxLive: 1});
  const entry = await f.pool.acquire(f.args); assert.equal(entry.status, 'starting');
  await assert.rejects(f.pool.acquire(f.args), /启动/);
  await assert.rejects(f.pool.acquire({...f.args, continuity: {...f.args.continuity, binding: 'parallel'}}), /上限/);
  assert.equal(f.handles.length, 1);
});

test('完成身份变化停止 CLI；资源清理失败后禁止新启动', async t => {
  const f = fixture(t, {wrongSession: true}); await f.pool.execute(f.args);
  await assert.rejects(f.pool.execute(f.args), /身份/);
  assert.equal([...f.pool.entries.values()][0].pty, null);
  const options = {cleanupFailure: true}, g = fixture(t, options);
  await g.pool.execute(g.args);
  await assert.rejects(g.pool.stop([...g.pool.entries.values()][0]), {code: 'ORCHESTRATOR_CLEANUP_FAILED'});
  await assert.rejects(g.pool.execute({...g.args, continuity: {...g.args.continuity, binding: 'next'}}), {code: 'ORCHESTRATOR_CLEANUP_FAILED'});
  assert.equal(g.handles.length, 1);
});

test('调用取消立即退出等待并释放终端，不接收旧结果', async t => {
  const f = fixture(t, {complete: false}), controller = new AbortController();
  const call = f.pool.execute({...f.args, signal: controller.signal, onStarted: () => setTimeout(() => controller.abort(new Error('paused')), 500)});
  await assert.rejects(call, /paused/);
  assert.equal([...f.pool.entries.values()][0].pty, null);
});
