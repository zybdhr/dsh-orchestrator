import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {waitForPermissionDecision, permissionDecisionOutput} from '../src/terminal-hook.mjs';

const payload = (sessionId = 'session') => ({session_id: sessionId, hook_event_name: 'PermissionRequest',
  tool_name: 'Bash', tool_input: {command: 'uv run pytest tests/foo.py -q', description: 'run tests'},
  permission_suggestions: [{type: 'addRules', behavior: 'allow', destination: 'session', rules: [{toolName: 'Bash'}]}]});
const active = {jobId: 'job', marker: '[DSH_CALL:job]'};
const started = {sessionId: 'session', jobId: 'job'};
const identity = {sessionId: 'session'};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('每个授权请求使用独立令牌文件，允许一次输出 Claude 官方 schema', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsho-approval-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const pending = waitForPermissionDecision(root, payload(), active, started, identity, {timeoutMs: 1000});
  let requestFile;
  for (let i = 0; i < 20 && !requestFile; i++) {requestFile = readdirSync(root).find(name => name.startsWith('permission-request-')); await wait(5);}
  assert(requestFile);
  const request = JSON.parse(readFileSync(join(root, requestFile)));
  assert.match(request.requestId, /^[0-9a-f-]{36}$/); assert.equal(request.toolInput.command, 'uv run pytest tests/foo.py -q');
  writeFileSync(join(root, `permission-response-${request.requestId}.json`), JSON.stringify({requestId: request.requestId, requestHash: request.requestHash, behavior: 'allow'}), {mode: 0o600});
  assert.deepEqual(await pending, {requestId: request.requestId, behavior: 'allow'});
  assert.deepEqual(permissionDecisionOutput({behavior: 'allow'}), {hookSpecificOutput: {hookEventName: 'PermissionRequest', decision: {behavior: 'allow'}}});
});

test('并发授权不会覆盖对方；拒绝只携带本次请求的说明', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsho-approval-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const first = waitForPermissionDecision(root, payload(), active, started, identity, {timeoutMs: 1000});
  const second = waitForPermissionDecision(root, payload(), {...active, jobId: 'job-2'}, {...started, jobId: 'job-2'}, identity, {timeoutMs: 1000});
  let files = [];
  for (let i = 0; i < 20 && files.length < 2; i++) {files = readdirSync(root).filter(name => name.startsWith('permission-request-')); await wait(5);}
  assert.equal(files.length, 2);
  const requests = files.map(name => JSON.parse(readFileSync(join(root, name))));
  writeFileSync(join(root, `permission-response-${requests[0].requestId}.json`), JSON.stringify({requestId: requests[0].requestId, requestHash: requests[0].requestHash, behavior: 'deny', message: '需人工复核', interrupt: true}), {mode: 0o600});
  writeFileSync(join(root, `permission-response-${requests[1].requestId}.json`), JSON.stringify({requestId: requests[1].requestId, requestHash: requests[1].requestHash, behavior: 'allow'}), {mode: 0o600});
  const results = await Promise.all([first, second]);
  assert.deepEqual(new Set(results.map(result => result.behavior)), new Set(['allow', 'deny']));
  assert.deepEqual(permissionDecisionOutput({behavior: 'deny', message: '需人工复核', interrupt: true}), {hookSpecificOutput: {hookEventName: 'PermissionRequest', decision: {behavior: 'deny', message: '需人工复核', interrupt: true}}});
});

test('超时或会话不匹配不返回决定，保留 Claude 原生提示', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsho-approval-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  assert.equal(await waitForPermissionDecision(root, payload('other'), active, started, identity, {timeoutMs: 10}), null);
  assert.equal(await waitForPermissionDecision(root, payload(), active, started, identity, {timeoutMs: 30}), null);
  assert.equal(permissionDecisionOutput(null), null);
});

test('授权响应必须匹配完整请求摘要，错误摘要不能批准命令', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsho-approval-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const pending = waitForPermissionDecision(root, payload(), active, started, identity, {timeoutMs: 250});
  let name;
  while (!name) {name = readdirSync(root).find(file => file.startsWith('permission-request-')); await wait(5);}
  const request = JSON.parse(readFileSync(join(root, name)));
  writeFileSync(join(root, `permission-response-${request.requestId}.json`), JSON.stringify({requestId: request.requestId, requestHash: 'wrong', behavior: 'allow'}));
  assert.equal(await pending, null);
});
