import test from 'node:test';
import assert from 'node:assert/strict';
import {enforceCoordinator, COORDINATOR_TOOLS, MONITOR_TOOLS, GUIDANCE} from '../src/tools.js';
import {DshAdapter} from '../src/adapter.js';

test('监控协调者允许明确的读取和浏览导航，拒绝业务操作及通用执行入口', () => {
  let guard, filter;
  enforceCoordinator({tools: {guard: fn => {guard = fn;}, restrict: value => {filter = value;}, schemas: () => ['dsh_browser_snapshot', 'dsh_browser_click', 'bash'].map(name => ({name}))}});
  assert(!filter.deny.includes('dsh_browser_snapshot')); assert(filter.deny.includes('dsh_browser_click')); assert(filter.deny.includes('bash'));
  for (const name of COORDINATOR_TOOLS) assert.equal(guard({name}), undefined);
  for (const name of MONITOR_TOOLS) assert.equal(guard({name, arguments: {url: 'https://example.com'}}), undefined);
  for (const name of ['bash', 'pwsh', 'write', 'edit', 'run_code', 'agent', 'workflow', 'spawn_agent', 'send_message', 'mcp__shell', 'orchestrator_shell',
    'dsh_browser_execute', 'dsh_browser_click', 'dsh_browser_type', 'dsh_browser_key', 'dsh_browser_fill', 'dsh_browser_set_value',
    'dsh_browser_check', 'dsh_browser_select', 'dsh_browser_clear', 'dsh_browser_download', 'dsh_browser_auth', 'dsh_browser_replay',
    'dsh_browser_restrict', 'dsh_browser_reset', 'dsh_browser_reset_session', 'dsh_browser_close_tab', 'dsh_browser_unknown']) assert.match(guard({name}), /只读观察、监控和编排/);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'not-a-url', undefined]) assert.match(guard({name: 'dsh_browser_open', arguments: {url}}), /HTTP\/HTTPS/);
  assert.equal(guard({name: 'working_directory', arguments: {}}), undefined);
  assert.match(guard({name: 'working_directory', arguments: {cd: '/another-project'}}), /不能直接切换目录/);
  assert(GUIDANCE.includes('先用会话提供的目录建立一个小型侦察任务'));
  assert(GUIDANCE.includes('不会自动传给 Codex/Claude CLI'));
});

test('没有全局写入口时不提交宿主不接受的空过滤器', () => {
  let restricted = false, guarded = false;
  enforceCoordinator({tools: {schemas: () => [{name: 'read'}], restrict: () => {restricted = true;}, guard: () => {guarded = true;}}});
  assert.equal(restricted, false); assert.equal(guarded, true);
});

test('正式适配器只展示并允许 Codex 和 Claude Code，不允许其他后端绕行', async () => {
  const adapter = new DshAdapter({subagents: {list: () => ['codex', 'claude-code', 'fork', 'other']}});
  assert.deepEqual(adapter.providers(), ['codex', 'claude-code']);
  await assert.rejects(adapter.execute({provider: 'other'}), /只允许/);
});
