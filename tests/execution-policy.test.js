import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExecutionPolicy, resolveExecutionPolicy, codexApprovalPolicy} from '../src/execution-policy.js';

test('权限策略有受限默认值，并兼容旧配置', () => {
  assert.deepEqual(normalizeExecutionPolicy(), {
    codex: {sandbox: 'workspace-write', approval: 'never'},
    claude: {readMode: 'dontAsk', writeMode: 'acceptEdits'},
  });
  assert.equal(resolveExecutionPolicy(undefined, 'codex', 'read').sandbox, 'read-only');
  assert.equal(resolveExecutionPolicy(undefined, 'claude-code', 'read').permissionMode, 'dontAsk');
});

test('只读任务不能从管理员配置获得完全权限', () => {
  const policy = {codex: {sandbox: 'danger-full-access', approval: 'on-request'},
    claude: {writeMode: 'bypassPermissions'}};
  assert.deepEqual(resolveExecutionPolicy(policy, 'codex', 'read'),
    {sandbox: 'read-only', approval: 'on-request'});
  assert.deepEqual(resolveExecutionPolicy(policy, 'claude-code', 'read'),
    {permissionMode: 'dontAsk'});
});

test('GPU任务必须显式配置完全访问权限', () => {
  assert.throws(() => resolveExecutionPolicy(undefined, 'codex', 'write', {gpu: true}), /GPU/);
  assert.deepEqual(resolveExecutionPolicy({codex: {sandbox: 'danger-full-access', approval: 'on-request'}}, 'codex', 'write', {gpu: true}),
    {sandbox: 'danger-full-access', approval: 'on-request'});
  assert.deepEqual(codexApprovalPolicy({sandbox: 'danger-full-access', approval: 'on-request'}),
    {approvalPolicy: 'on-request', sandbox: 'danger-full-access'});
});

test('非法或未识别的权限和资源配置均被拒绝', () => {
  for (const invalid of [{x: 1}, {codex: 3}, {codex: {sandbox: 'invalid'}},
    {claude: {readMode: 'bypassPermissions'}}, {claude: {writeMode: 'invalid'}}]) {
    assert.throws(() => normalizeExecutionPolicy(invalid));
  }
  assert.throws(() => resolveExecutionPolicy(undefined, 'codex', 'write', {gpu: 'yes'}));
  assert.throws(() => resolveExecutionPolicy(undefined, 'codex', 'write', {network: true}));
  assert.throws(() => resolveExecutionPolicy(undefined, 'unknown', 'write'));
});
