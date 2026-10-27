import {existsSync, statSync} from 'node:fs';
import {delimiter, join, resolve} from 'node:path';
import {homedir} from 'node:os';

export const TESTED_DSH_VERSION = '0.2.1-rc.2';

export function resolveDshCommand({runtime, bin, env = process.env} = {}) {
  if (runtime) {
    const entry = join(resolve(runtime), '@deepseek-ai/dsh/lib/bin.js');
    if (!existsSync(entry)) throw new Error('指定的 node_modules 中没有 DSH');
    return {command: process.execPath, args: [entry]};
  }
  if (bin || env.DSH_BIN) {
    const entry = resolve(bin || env.DSH_BIN);
    if (!existsSync(entry)) throw new Error('指定的 DSH 入口不存在');
    return {command: entry, args: []};
  }
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const entry = join(directory, 'dsh');
    try {if (statSync(entry).isFile()) return {command: entry, args: []};} catch {}
  }
  return {command: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['--yes', `@deepseek-ai/dsh@${TESTED_DSH_VERSION}`]};
}

export function resolveProfile({home, profile = 'web', env = process.env} = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(profile)) throw new Error('profile 名称无效');
  const root = resolve(home || env.DSH_HOME || join(homedir(), '.dsh'));
  return {home: root, profile, directory: join(root, 'profiles', profile)};
}

export function localOrigin(port = 3080, host = '127.0.0.1') {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('端口必须为 1–65535');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('维护脚本只接受本机回环地址');
  return `http://${host === '::1' ? '[::1]' : host}:${value}`;
}
