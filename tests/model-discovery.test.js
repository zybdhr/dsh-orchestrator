import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough, Writable} from 'node:stream';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverProviderModels, mergeDiscoveredModels} from '../src/model-discovery.js';
import {DshAdapter} from '../src/adapter.js';

test('Codex 目录查询分页并包含隐藏候选，不发送任务，结束释放进程', async () => {
  const methods = [], params = []; let terminated = 0, cursor;
  const stdout = new PassThrough();
  const done = Promise.withResolvers();
  const stdin = new Writable({write(chunk, _encoding, callback) {
    for (const line of chunk.toString().trim().split('\n')) {
      const request = JSON.parse(line); methods.push(request.method);
      if (!Object.hasOwn(request, 'id')) continue;
      let result = {};
      if (request.method === 'model/list') {
        params.push(request.params); cursor = request.params.cursor;
        result = cursor ? {data: [{model: 'hidden-model', hidden: true, displayName: 'Hidden', supportedReasoningEfforts: [{reasoningEffort: 'high'}]}], nextCursor: null}
          : {data: [{model: 'first-model', displayName: 'First', supportedReasoningEfforts: []}], nextCursor: 'next-page'};
      }
      queueMicrotask(() => stdout.write(JSON.stringify({id: request.id, result}) + '\n'));
    }
    callback();
  }});
  const ctx = {get: () => ({dir: '/project'}), subagents: {getProvider: () => ({config: {env: {}}})}, subprocess: {spawn: () => ({stdin, stdout, done: done.promise,
    terminate() {terminated++; done.resolve({exitCode: 0});}, waitForExit: async () => true})}};
  const rows = await discoverProviderModels(ctx, 'codex', {resolveRuntime: () => ({argv: ['mock-codex']})});
  assert.deepEqual(rows.map(row => row.id), ['first-model', 'hidden-model']);
  assert.equal(rows[1].hidden, true);
  assert.equal(terminated, 1);
  assert(params.every(value => value.includeHidden === true && value.limit === 100));
  assert.deepEqual(methods, ['initialize', 'initialized', 'model/list', 'model/list']);
});

test('Claude 查询原生目录，保留别名与真实模型 ID，不发送 prompt 或持久化会话', async () => {
  let closed = false, supplied;
  const ctx = {get: () => ({dir: '/project'}), subagents: {getProvider: () => ({config: {env: {}}})}};
  const rows = await discoverProviderModels(ctx, 'claude-code', {querySdk: args => {
    supplied = args;
    return {supportedModels: async () => [{value: 'family', resolvedModel: 'actual-model', displayName: 'Model', supportsEffort: false}], close() {closed = true;}};
  }});
  assert.deepEqual(rows.map(row => row.id), ['family', 'actual-model']);
  assert.equal(rows[0].effortSupported, false);
  assert.equal(supplied.options.persistSession, false);
  assert.equal(supplied.options.strictMcpConfig, true);
  assert.deepEqual(supplied.options.tools, []);
  assert.equal(supplied.options.settings.disableAllHooks, true);
  assert.equal((await supplied.prompt[Symbol.asyncIterator]().next()).done, true, '关闭后空输入流直接结束');
  assert(closed);
});

test('目录查询超时关闭 SDK，候选合并只保留允许的元数据', async () => {
  let closed = false;
  const ctx = {get: () => ({dir: '/project'}), subagents: {getProvider: () => ({config: {env: {}}})}};
  await assert.rejects(discoverProviderModels(ctx, 'claude-code', {timeoutMs: 10, querySdk: () => ({supportedModels: () => new Promise(() => {}), close() {closed = true;}})}), /超时/);
  assert(closed);
  const catalog = {codex: {models: [{id: 'existing', efforts: []}], efforts: []}};
  mergeDiscoveredModels(catalog, 'codex', [{id: 'existing', efforts: ['high', 'invalid'], token: 'private'}, {id: 'hidden', label: 'Hidden', hidden: true, apiKey: 'private'}, {id: 'bad\nid'}]);
  assert.deepEqual(catalog.codex.models[0].efforts, ['high']);
  assert.equal(catalog.codex.models.length, 2);
  assert.equal(catalog.codex.models[1].hidden, true);
  assert(!JSON.stringify(catalog).includes('private'));
});

test('原生目录失败保留本地候选并给出安全提示，不泄漏远端错误', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-catalog-fallback-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const ctx = {subagents: {getProvider: provider => ({config: {model: `${provider}-configured`, env: {CODEX_HOME: root, CLAUDE_CONFIG_DIR: root}}})}};
  const adapter = new DshAdapter(ctx, {discoverModels: async () => {throw new Error('secret remote token');}});
  const catalog = await adapter.refreshModels();
  assert(catalog.codex.models.some(row => row.id === 'codex-configured'));
  assert(catalog['claude-code'].models.some(row => row.id === 'claude-code-configured'));
  assert(catalog.codex.warning.includes('保留本地'));
  assert(!JSON.stringify(catalog).includes('secret remote token'));
});
