import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gatewayCompatibilityEnv, claudeTerminalCompatibility} from '../src/claude-compatibility.js';

test('仅第三方网关使用原生工具兼容，不关闭思考或放开权限', () => {
  assert.deepEqual(gatewayCompatibilityEnv(undefined), {});
  assert.deepEqual(gatewayCompatibilityEnv('https://api.anthropic.com'), {});
  assert.deepEqual(gatewayCompatibilityEnv('invalid'), {});
  assert.deepEqual(gatewayCompatibilityEnv('http://127.0.0.1:15721'), {ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1'});
});

test('读取实际 Claude 配置，明确提供方地址优先，不修改用户环境或文件', t => {
  const root = mkdtempSync(join(tmpdir(), 'claude-compat-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'settings.json'), JSON.stringify({env: {ANTHROPIC_BASE_URL: 'http://localhost:15721', ANTHROPIC_AUTH_TOKEN: 'private'}}));
  const env = {CLAUDE_CONFIG_DIR: root}, provider = {ANTHROPIC_BASE_URL: 'https://api.anthropic.com'};
  assert.equal(claudeTerminalCompatibility({}, env).ENABLE_TOOL_SEARCH, 'false');
  assert.deepEqual(claudeTerminalCompatibility(provider, env), {});
  assert.deepEqual(provider, {ANTHROPIC_BASE_URL: 'https://api.anthropic.com'});
  assert.deepEqual(env, {CLAUDE_CONFIG_DIR: root});
});
