import test from 'node:test';
import assert from 'node:assert/strict';
import {askAgentApproval} from '../src/agent-approval.js';

const fixture = (choice = '允许本次') => {
  let shown, callCount = 0;
  const userQuestions = {ask: async ({questions}) => {
    callCount++; shown = questions[0];
    return {answers: [{id: shown.id, selected: [choice]}]};
  }};
  const parent = {ctx: {get: () => userQuestions}};
  return {parent, shown: () => shown, callCount: () => callCount};
};

test('只批准当前一项命令且显示完整参数', async () => {
  const f = fixture(), waits = [];
  assert.equal(await askAgentApproval({parent: f.parent, signal: new AbortController().signal,
    provider: 'Codex', title: '执行测试', toolName: '命令执行',
    toolInput: {command: ['python', '-m', 'pytest']}, onPermissionWait: value => waits.push(value)}), true);
  assert.match(f.shown().detail, /python/);
  assert.deepEqual(waits, [true, false]);
  assert.equal(f.callCount(), 1);
});

test('拒绝选择与无审批服务均拒绝授权', async () => {
  const f = fixture('拒绝');
  assert.equal(await askAgentApproval({parent: f.parent, provider: 'Claude Code',
    title: '执行测试', toolName: 'Bash', toolInput: {command: 'rm -rf build'}}), false);
  assert.equal(await askAgentApproval({parent: {}, provider: 'Codex', toolName: '命令执行', toolInput: {}}), false);
});

test('无法完整显示的授权参数拒绝提交', async () => {
  const f = fixture();
  assert.equal(await askAgentApproval({parent: f.parent, provider: 'Codex', toolName: '命令执行',
    toolInput: {command: 'x'.repeat(13000)}}), false);
  assert.equal(f.callCount(), 0);
});
