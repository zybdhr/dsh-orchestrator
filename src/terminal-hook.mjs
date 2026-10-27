import {readFileSync, writeFileSync, renameSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// 仅在子 CLI 的本次启动参数中注册，不修改用户的全局配置。
export function hookEvent(provider, payload, active, started, identity) {
  const sessionId = provider === 'codex' ? payload['thread-id'] : payload.session_id;
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) return;
  if (identity?.sessionId && sessionId !== identity.sessionId) return;
  const kind = provider === 'codex' ? payload.type : payload.hook_event_name;
  if (kind === 'SessionStart') return {type: 'ready', sessionId};
  if (kind === 'UserPromptSubmit') {
    if (active && String(payload.prompt).includes(active.marker)) return {type: 'started', sessionId, jobId: active.jobId};
    return {type: 'manual-started', sessionId};
  }
  if (provider === 'claude-code' && (kind === 'PermissionRequest' || kind === 'Notification' && payload.notification_type === 'permission_prompt')) {
    if (kind === 'PermissionRequest' && ['dontAsk', 'bypassPermissions'].includes(payload.permission_mode)) return;
    if (!active || started?.jobId !== active.jobId || started.sessionId !== sessionId) return;
    // 只报告等待状态，不向 CLI 输出任何授权决定，也不保存命令中的敏感参数。
    return {type: 'permission-required', sessionId, jobId: active.jobId, toolName: String(payload.tool_name ?? '工具').slice(0, 100)};
  }
  if (!['agent-turn-complete', 'Stop', 'StopFailure', 'SessionEnd'].includes(kind)) return;
  if (kind === 'SessionEnd') return {type: 'exited', sessionId};
  const matches = active && (provider === 'codex'
    ? String(payload['input-messages']?.at(-1) ?? '').startsWith(`${active.marker}\n`)
    : started?.jobId === active.jobId && started.sessionId === sessionId);
  // 隐藏标题线程会继承 notify；嵌在它提示词里的 nonce 不能算本次用户调用。
  if (provider === 'codex' && active && !matches) return;
  return {type: matches ? 'completed' : 'manual-completed', sessionId, ...(matches ? {jobId: active.jobId} : {}),
    failed: kind === 'StopFailure', text: String(provider === 'codex' ? payload['last-assistant-message'] ?? '' : payload.last_assistant_message ?? '').slice(0, 16000),
    background: Array.isArray(payload.background_tasks) && payload.background_tasks.length > 0};
}

const PERMISSION_WAIT_MS = 5 * 60 * 1000;
const PERMISSION_MAX_BYTES = 64 * 1024;
const permissionPath = (directory, name, requestId = '') => join(directory, `permission-${name}${requestId ? `-${requestId}` : ''}.json`);
const writePrivate = (path, value) => {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), {mode: 0o600});
  renameSync(temporary, path);
};
const removeFile = path => {try {unlinkSync(path);} catch (error) {if (error.code !== 'ENOENT') throw error;}};
export function permissionRequestHash(request) {
  return createHash('sha256').update(JSON.stringify({requestId: request.requestId, sessionId: request.sessionId, jobId: request.jobId,
    toolName: request.toolName, toolInput: request.toolInput})).digest('hex');
}

/** Wait for one matching DSH decision; null deliberately preserves Claude's native prompt. */
export async function waitForPermissionDecision(directory, payload, active, started, identity, {timeoutMs = PERMISSION_WAIT_MS} = {}) {
  const event = hookEvent('claude-code', payload, active, started, identity);
  if (event?.type !== 'permission-required') return null;
  if (typeof payload.tool_name !== 'string' || !payload.tool_name || payload.tool_name.length > 100 || !payload.tool_input || typeof payload.tool_input !== 'object' || Array.isArray(payload.tool_input)) return null;
  const requestId = randomUUID();
  const request = {type: 'permission-required', requestId, sessionId: event.sessionId, jobId: event.jobId,
    toolName: String(payload.tool_name ?? '工具').slice(0, 100),
    toolInput: payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {},
    permissionSuggestions: Array.isArray(payload.permission_suggestions) ? payload.permission_suggestions : [], at: Date.now()};
  request.requestHash = permissionRequestHash(request);
  if (Buffer.byteLength(JSON.stringify(request)) > PERMISSION_MAX_BYTES) return null;
  const requestFile = permissionPath(directory, 'request', requestId), responseFile = permissionPath(directory, 'response', requestId);
  writePrivate(requestFile, request);
  const until = Date.now() + Math.max(0, Math.min(timeoutMs, PERMISSION_WAIT_MS));
  try {
    while (Date.now() < until) {
      let response;
      try {response = JSON.parse(readFileSync(responseFile, 'utf8'));} catch {}
      if (response?.requestId === requestId && response.behavior === 'fallback') return null;
      if (response?.requestId === requestId && response.requestHash === request.requestHash && (response.behavior === 'allow' || response.behavior === 'deny')) {
        return {requestId, behavior: response.behavior,
          ...(response.behavior === 'deny' && typeof response.message === 'string' ? {message: response.message.slice(0, 2000)} : {}),
          ...(response.behavior === 'deny' && response.interrupt === true ? {interrupt: true} : {})};
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  } finally {removeFile(requestFile); removeFile(responseFile);}
}

export function permissionDecisionOutput(decision) {
  if (!decision || !['allow', 'deny'].includes(decision.behavior)) return null;
  return {hookSpecificOutput: {hookEventName: 'PermissionRequest', decision: {behavior: decision.behavior,
    ...(decision.behavior === 'deny' && decision.message ? {message: decision.message} : {}),
    ...(decision.behavior === 'deny' && decision.interrupt ? {interrupt: true} : {})}}};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [directory, provider, argument] = process.argv.slice(2);
  const read = name => {try {return JSON.parse(readFileSync(join(directory, name), 'utf8'));} catch {return null;}};
  try {
    let input = argument ?? '';
    if (provider !== 'codex') for await (const chunk of process.stdin) {input += chunk; if (input.length > 1024 * 1024) process.exit(1);}
    const payload = JSON.parse(input), active = read('active.json'), started = read('started.json'), identity = read('identity.json');
    const event = hookEvent(provider, payload, active, started, identity);
    if (event) {
      if (event.type === 'permission-required' && provider === 'claude-code' && payload.hook_event_name === 'PermissionRequest') {
        const decision = await waitForPermissionDecision(directory, payload, active, started, identity);
        const output = permissionDecisionOutput(decision);
        if (output) process.stdout.write(JSON.stringify(output));
        else writePrivate(join(directory, 'attention.json'), {...event, eventId: randomUUID(), at: Date.now()});
      } else {
        const body = {...event, eventId: randomUUID(), at: Date.now()};
        const name = event.type === 'started' ? 'started.json' : event.type === 'permission-required' ? 'attention.json' : 'event.json';
        const temporary = join(directory, `${name}.${process.pid}.tmp`);
        writeFileSync(temporary, JSON.stringify(body), {mode: 0o600}); renameSync(temporary, join(directory, name));
      }
    }
  } catch {process.exitCode = 1;}
}
