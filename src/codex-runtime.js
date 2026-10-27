import {accessSync, constants, realpathSync, statSync} from 'node:fs';
import {delimiter, isAbsolute, join} from 'node:path';

/** 解析宿主 PATH 中用户安装的 Codex，排除官方插件固定打包的旧入口。 */
export function resolveCodexRuntime({pathEnv = process.env.PATH ?? '', excluded = []} = {}) {
  const blocked = new Set(excluded.map(path => {try {return realpathSync(path);} catch {return path;}}));
  for (const dir of pathEnv.split(delimiter).filter(isAbsolute)) {
    for (const name of process.platform === 'win32' ? ['codex.exe', 'codex'] : ['codex']) {
      try {
        const path = realpathSync(join(dir, name));
        if (blocked.has(path) || !statSync(path).isFile()) continue;
        accessSync(path, constants.X_OK);
        return {path, argv: path.endsWith('.js') ? [process.execPath, path] : [path]};
      } catch { /* 继续检查下一个 PATH 入口。 */ }
    }
  }
  throw new Error('未找到用户安装的 Codex CLI；请检查 DSH 启动环境的 PATH，不会退回插件内置的旧版 Codex。');
}

export function withCodexRuntime(spec, resolveRuntime = resolveCodexRuntime) {
  const index = spec.argv?.indexOf('app-server') ?? -1;
  if (index < 0) throw new Error('Codex 原生启动接口发生变化，无法替换 CLI 入口');
  const runtime = resolveRuntime({pathEnv: spec.env?.PATH ?? process.env.PATH, excluded: spec.argv.slice(0, index)});
  return {...spec, argv: [...runtime.argv, ...spec.argv.slice(index)]};
}

/** 只投影已识别的错误类别，不将远端自由文本、地址或凭据带到页面。 */
export function codexErrorDetail(error) {
  let message = error?.message, status = error?.httpStatus;
  if (typeof message !== 'string' || message.length > 32000) return;
  try {const nested = JSON.parse(message); status = nested.status ?? status; message = nested.error?.message ?? message;} catch {}
  if (/model is not supported when using Codex with a ChatGPT account/i.test(message)) {
    const model = message.match(/'([a-zA-Z0-9._-]{1,200})' model/)?.[1];
    return `当前 Codex CLI 的 ChatGPT 登录调用不支持模型${model ? ` ${model}` : ''}；请检查 CLI 版本及模型设置。`;
  }
  if (status === 401 || /unauthorized|authentication.*failed/i.test(message)) return 'Codex 登录认证失败，请重新登录当前 CLI。';
  if (status === 429 || /rate limit|quota exceeded/i.test(message)) return 'Codex 额度或请求频率受限，请检查账号用量后重试。';
  if (/reasoning.*not supported|unsupported.*reasoning/i.test(message)) return '当前 Codex 模型不支持所选推理强度，请调整模型设置。';
}

export function observeCodexErrors(stream) {
  let buffer = '', detail;
  const onData = chunk => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 262144) {buffer = ''; return;}
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const frame = JSON.parse(line);
        const error = frame.method === 'error' ? frame.params?.error : frame.method === 'turn/completed' ? frame.params?.turn?.error : frame.error;
        detail = codexErrorDetail(error) ?? detail;
      } catch { /* 诊断旁路不能影响官方协议处理。 */ }
    }
  };
  stream?.on('data', onData);
  return {read: () => detail, dispose: () => stream?.off('data', onData)};
}
