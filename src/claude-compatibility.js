import {readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

/** 第三方 Anthropic 网关常不接受动态工具增量消息；采用 CLI 原生兼容开关。 */
export function gatewayCompatibilityEnv(baseUrl) {
  if (!baseUrl) return {};
  let url;
  try {url = new URL(baseUrl);} catch {return {};}
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === 'api.anthropic.com') return {};
  return {ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1'};
}

export function claudeTerminalCompatibility(providerEnv = {}, env = process.env) {
  const directory = providerEnv.CLAUDE_CONFIG_DIR || env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  let settingsEnv = {};
  try {
    const path = join(directory, 'settings.json');
    if (statSync(path).size <= 4 * 1024 * 1024) settingsEnv = JSON.parse(readFileSync(path, 'utf8')).env ?? {};
  } catch { /* CLI 自行报告配置或登录错误，不用默认地址覆盖用户配置。 */ }
  return gatewayCompatibilityEnv(providerEnv.ANTHROPIC_BASE_URL ?? settingsEnv.ANTHROPIC_BASE_URL ?? env.ANTHROPIC_BASE_URL);
}
