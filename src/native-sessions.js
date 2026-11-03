import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {Transform} from 'node:stream';
import {JsonRpcLineTransport} from '@deepseek-ai/dsh-sdk-protocol';
import {NO_START_CAPABILITIES, assertUsableCwd, settleRunResult, subprocessRunHandle} from '@deepseek-ai/dsh-subagent';
import {scrubbedParentEnv} from '@deepseek-ai/dsh-subprocess';
import {resolveCodexRuntime, codexErrorDetail} from './codex-runtime.js';
import {withClaudeTools} from './claude-permissions.js';
import {askAgentApproval} from './agent-approval.js';

const idValid = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id);
const fail = (message, code = 'ORCHESTRATOR_SESSION_BLOCKED') => Object.assign(new Error(message), {code});
const contextLimit = value => /contextWindowExceeded|context.{0,25}(?:length|window|limit).{0,30}(?:exceed|full|large|long)|prompt is too long|too many tokens|maximum context/i.test(String(value));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const result = text => ({stopReason: 'completed', output: [{type: 'text', text}]});

/** 保留官方 SDK 所需的 Node 进程外观，生命周期仍由 DSH managed range 管理。 */
export class ManagedSdkProcess extends EventEmitter {
  constructor(child) {
    super(); this.child = child; this.stdin = child.stdin; this.stdout = child.stdout; this.killed = false;
    this.on('error', () => {});
    child.done.then(outcome => {this.outcome = outcome; this.emit('exit', outcome.exitCode, outcome.signal);}, error => this.emit('error', error));
  }
  get exitCode() {return this.outcome?.exitCode ?? null;}
  get signalCode() {return this.outcome?.signal ?? null;}
  kill() {if (this.killed || this.outcome) return false; this.killed = true; this.child.terminate(); return true;}
}

/** 会话级提供方只服务一次 activation；每轮结束释放进程，历史由原生后端持久化。 */
export async function createSessionProvider(ctx, provider, options, dependencies = {}) {
  const original = ctx.subagents.getProvider(provider);
  const config = original.config;
  const c = options.continuity;
  if (!c || typeof c.binding !== 'string' || typeof c.onSession !== 'function') throw fail('缺少会话归属信息');
  const profileKey = hash({provider, config, model: options.model ?? '', effort: options.reasoningEffort ?? '', executionPolicy: options.executionPolicy});
  const prior = c.previous;
  if (prior && (!idValid(prior.id) || prior.binding !== c.binding || prior.provider !== provider)) throw fail('会话身份或归属不匹配，拒绝恢复');
  const reusable = prior && prior.profileKey === profileKey;
  let state = reusable ? {...prior} : null, failure;
  const event = (type, data = {}) => c.onEvent?.({type, ...data});
  if (prior && !reusable) event('replaced', {reason: '后端原生配置变化'});
  const update = patch => {
    state = {...state, ...patch, binding: c.binding, provider, profileKey};
    c.onSession({...state});
  };
  const opened = id => {
    if (!idValid(id) || (reusable && id !== prior.id)) throw fail('原生后端返回了不匹配的会话 ID');
    update({id, turns: state?.turns ?? 0, compactions: state?.compactions ?? 0,
      createdAt: state?.createdAt ?? new Date().toISOString(), recovery: undefined});
    event(reusable ? 'resumed' : 'created');
  };
  const compacted = () => {update({compactions: (state?.compactions ?? 0) + 1, recovery: undefined}); event('compacted');};
  const markError = error => {
    const overflow = error.code === 'ORCHESTRATOR_CONTEXT_LIMIT' || contextLimit(error.message);
    failure = {code: overflow ? 'ORCHESTRATOR_CONTEXT_LIMIT' : 'ORCHESTRATOR_SESSION_BLOCKED',
      message: overflow ? '原生上下文达到上限，已停止；显式恢复后先压缩，不自动重放业务操作' : '原生会话调用失败，已保留检查点；请检查会话、权限或后端状态后显式恢复'};
    if (overflow && state) update({recovery: 'compact'});
    // 只暴露分类后的诊断，不将远端自由文本或凭据写入调用记录。
    const safe = provider === 'codex' ? codexErrorDetail(error) : undefined;
    if (safe && !overflow) failure.message = safe;
  };
  let sdk;
  if (provider === 'claude-code') {
    if (dependencies.query) sdk = {query: dependencies.query};
    else {
      const dir = ctx.get('profileContext')?.dir;
      const require = dir ? createRequire(join(dir, 'package.json')) : createRequire(import.meta.url);
      const nativeRequire = createRequire(require.resolve('@deepseek-ai/dsh-subagent-claude-code'));
      sdk = await import(pathToFileURL(nativeRequire.resolve('@anthropic-ai/claude-agent-sdk')));
    }
  }
  const name = `orchestrator-${provider}-${randomUUID()}`;
  const instance = {name, capabilities: NO_START_CAPABILITIES, inheritsParentContext: false,
    async start(request) {
      assertUsableCwd('orchestrator', 'cwd', request.cwd); request.signal.throwIfAborted();
      const controller = new AbortController();
      const cancel = () => controller.abort(new Error('编排调用已停止'));
      request.signal.addEventListener('abort', cancel, {once: true});
      let child, closeProtocol = () => {}, query;
      let teardown;
      const dispose = () => teardown ??= (async () => {
        request.signal.removeEventListener('abort', cancel);
        const failures = [];
        try {query?.close();} catch (error) {failures.push(error);}
        try {closeProtocol();} catch (error) {failures.push(error);}
        if (child) {
          child.terminate();
          try {if (!await child.waitForExit()) throw new Error('managed range 未退出'); await child.done.catch(() => {});} catch (error) {failures.push(error);}
        }
        if (failures.length) throw Object.assign(new Error('原生会话进程未能完整释放'), {code: 'ORCHESTRATOR_CLEANUP_FAILED'});
      })();
      const spawn = spec => {
        child = ctx.subprocess.spawn(spec);
        child.done.catch(() => {});
        return child;
      };
      const hooks = {opened, compacted, update, event};
      let task;
      try {
        if (provider === 'codex') {
          task = await openCodexSession({request, config, options, previous: reusable ? prior : null, signal: controller.signal, spawn, hooks,
            setClose: close => {closeProtocol = close;}, resolveRuntime: dependencies.resolveRuntime});
        } else {
          if (!reusable && c.operation === 'compact') throw fail('没有可压缩的原生会话');
          const sessionId = reusable ? prior.id : randomUUID();
          // Claude 允许预先指定 UUID，在发送任务之前写入检查点。
          opened(sessionId);
          const env = {...scrubbedParentEnv(), ...config.env,
            ...(options.reasoningEffort ? {CLAUDE_CODE_EFFORT_LEVEL: options.reasoningEffort} : {})};
          const permissionMode = options.executionPolicy?.permissionMode ?? (options.writeAccess ? 'acceptEdits' : config.permissionMode);
          const sdkOptions = {cwd: request.cwd, env, model: options.model || config.model, persistSession: true,
            ...(reusable ? {resume: prior.id} : {sessionId}), abortController: controller, permissionMode,
            settings: {autoCompactEnabled: true},
            disallowedTools: ['AskUserQuestion', 'ExitPlanMode'],
            ...(permissionMode === 'bypassPermissions' ? {allowDangerouslySkipPermissions: true} : {canUseTool: async (toolName, input) => {
              if (!options.writeAccess) return {behavior: 'deny', message: '审核和只读任务不能提升工具权限'};
              const approved = await askAgentApproval({...options.approvalContext, provider: 'Claude Code', title: options.approvalContext?.label ?? '执行任务', toolName, toolInput: input});
              return approved ? {behavior: 'allow', updatedInput: input} : {behavior: 'deny', message: '此操作未获得用户授权'};
            }}),
            onElicitation: async () => ({action: 'decline'}), onUserDialog: async () => ({behavior: 'cancelled'}), supportedDialogKinds: ['refusal_fallback_prompt'],
            spawnClaudeCodeProcess(spec) {
              const overlay = {...spec.env};
              for (const key of Object.keys(scrubbedParentEnv())) if (!(key in spec.env)) overlay[key] = undefined;
              const managed = spawn(withClaudeTools({argv: [spec.command, ...spec.args], cwd: spec.cwd, env: overlay,
                signal: spec.signal, graceMs: config.disposeGraceMs ?? 3000, stdio: {stdin: 'pipe', stdout: 'pipe', stderr: {maxBytes: 8192}}}, options));
              return new ManagedSdkProcess(managed);
            }};
          query = sdk.query({prompt: c.operation === 'compact' ? '/compact Preserve task requirements, authorization limits, modified paths, verification evidence and unresolved issues.' : request.prompt.map(b => b.text).join('\n'), options: sdkOptions});
          if (!child) throw fail('Claude SDK 未通过 DSH 子进程服务创建进程');
          task = async () => {
            let terminal, didCompact = false;
            for await (const message of query) {
              if (message.session_id && message.session_id !== sessionId) throw fail('Claude 恢复到了其他会话');
              if (message.type === 'system' && message.subtype === 'compact_boundary') {didCompact = true; compacted();}
              if (message.type === 'result') terminal = message;
            }
            if (terminal && (terminal.subtype !== 'success' || terminal.is_error)) {
              const details = (terminal.errors ?? []).join(' ');
              if (contextLimit(details)) throw fail('contextWindowExceeded', 'ORCHESTRATOR_CONTEXT_LIMIT');
              throw fail('Claude 未正常完成本次调用');
            }
            if (c.operation === 'compact') {
              if (!didCompact) throw fail('Claude 未提供压缩完成证据');
              return result('原生会话压缩完成');
            }
            if (!terminal || !terminal.result?.trim()) throw fail('Claude 未返回有效结果');
            update({turns: (state?.turns ?? 0) + 1});
            return result(terminal.result.slice(0, 16000));
          };
        }
      } catch (error) {
        markError(error); cancel(); await dispose();
        throw Object.assign(new Error(failure.message), {code: failure.code});
      }
      const execution = settleRunResult({attempt: async () => {
        try {return await task();} catch (error) {markError(error); throw new Error(failure.message);}
      }, collectOutput: () => [], collectDiagnostic: () => failure?.message,
      cancelled: () => controller.signal.aborted, signal: request.signal, onAbort: cancel});
      return subprocessRunHandle({id: randomUUID(), result: execution, signal: request.signal, onAbort: cancel, requestCancel: cancel, teardown: dispose});
    }};
  const off = ctx.subagents.registerProvider(instance);
  return {name, dispose: off, failure: () => failure};
}

/** 单连接单轮，原生历史持久化；协议帧有上限，校验当前 thread/turn。 */
export async function openCodexSession({request, config, options, previous, signal, spawn, hooks, setClose, resolveRuntime = resolveCodexRuntime}) {
  const runtime = resolveRuntime({pathEnv: config.env?.PATH ?? process.env.PATH});
  const argv = [...runtime.argv, 'app-server', '--stdio',
    ...(options.reasoningEffort ? ['-c', `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`] : [])];
  const child = spawn({argv, cwd: request.cwd, env: config.env, graceMs: config.disposeGraceMs ?? 3000,
    stdio: {stdin: 'pipe', stdout: 'pipe', stderr: {maxBytes: 8192}}});
  let lineBytes = 0;
  const framed = new Transform({transform(chunk, _enc, done) {
    for (const byte of chunk) {lineBytes = byte === 10 ? 0 : lineBytes + 1; if (lineBytes > 8 * 1024 * 1024) {done(fail('原生协议单帧超过 8 MiB')); return;}}
    done(null, chunk);
  }});
  const transport = new JsonRpcLineTransport(framed, child.stdin);
  const fatal = Promise.withResolvers(); fatal.promise.catch(() => {});
  const abort = () => fatal.reject(signal.reason ?? new Error('调用已停止'));
  const died = error => fatal.reject(error instanceof Error ? error : fail('Codex 进程提前退出'));
  framed.on('error', died); child.stdout.on('error', died); child.stdin.on('error', died);
  child.stdout.on('end', died); child.done.then(() => died(), died);
  signal.addEventListener('abort', abort, {once: true});
  setClose(() => {
    signal.removeEventListener('abort', abort); child.stdout.off('error', died); child.stdin.off('error', died); child.stdout.off('end', died);
    child.stdout.unpipe(framed); transport.close(); framed.destroy();
  });
  child.stdout.pipe(framed);
  let threadId, turnId, completion, pendingTurn, answer, partial, unphased, compactionSeen = false;
  let turns = previous?.turns ?? 0;
  const operation = options.continuity.operation;
  function matchTurn(id) {
    if (!idValid(id)) throw fail('Codex turn ID 无效');
    if (turnId) return turnId === id;
    if (pendingTurn && pendingTurn !== id) throw fail('Codex 返回了冲突的 turn ID');
    pendingTurn = id; return true;
  }
  transport.onNotification((method, p) => {
    try {
      if (p.threadId !== threadId || !completion) return;
      if (method === 'turn/started') {matchTurn(p.turn?.id); return;}
      if (method === 'thread/tokenUsage/updated') {
        const usage = p.tokenUsage;
        if (Number.isSafeInteger(usage?.last?.totalTokens)) hooks.event('usage', {tokens: usage.last.totalTokens});
        return;
      }
      if (method === 'item/completed' && matchTurn(p.turnId)) {
        const item = p.item;
        if (item?.type === 'contextCompaction') {compactionSeen = true; hooks.compacted();}
        if (item?.type === 'agentMessage' && typeof item.text === 'string') {
          const text = item.text.slice(0, 16000);
          if (item.phase === 'final_answer') answer = text;
          else if (item.phase === 'partial_answer') partial = text;
          else if (item.phase == null) unphased = text;
        }
      }
      if (method === 'turn/completed' && matchTurn(p.turn?.id)) completion.resolve(p.turn);
    } catch (error) {fatal.reject(error);}
  });
  transport.onRequest(async (method, p) => {
    if (p.threadId !== threadId || (p.turnId != null && !matchTurn(p.turnId))) throw fail('Codex 交互请求归属不匹配');
    if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) {
      const approved = options.executionPolicy?.approval === 'on-request' && await askAgentApproval({
        ...options.approvalContext, provider: 'Codex', title: options.approvalContext?.label ?? '执行任务',
        toolName: method === 'item/fileChange/requestApproval' ? '文件修改' : '命令执行', toolInput: p,
      });
      return {decision: approved && (!Array.isArray(p.availableDecisions) || p.availableDecisions.includes('accept')) ? 'accept' : 'decline'};
    }
    if (method === 'item/permissions/requestApproval') {
      const approved = options.executionPolicy?.approval === 'on-request' && await askAgentApproval({
        ...options.approvalContext, provider: 'Codex', title: options.approvalContext?.label ?? '执行任务',
        toolName: '额外资源访问', toolInput: p,
      });
      return {permissions: approved ? p.permissions ?? {} : {}, scope: 'turn'};
    }
    if (method === 'item/tool/requestUserInput') return {answers: {}};
    if (method === 'mcpServer/elicitation/request') return {action: 'decline', content: null, _meta: null};
    throw fail('不支持的 Codex 交互请求');
  });
  const guarded = promise => Promise.race([promise, fatal.promise]);
  const rpc = (method, params) => guarded(transport.request(method, params, signal));
  transport.start();
  await rpc('initialize', {clientInfo: {name: 'dsh-local-orchestrator', version: '0.9.0'}, capabilities: {experimentalApi: false, requestAttestation: false}});
  transport.notify('initialized'); await guarded(transport.flush());
  const permission = options.executionPolicy ? {
    approvalPolicy: options.executionPolicy.approval,
    sandbox: options.executionPolicy.sandbox,
  } : {
    never: {approvalPolicy: 'never'},
    'approve-for-me': {approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write'},
    'dangerously-bypass-approvals-and-sandbox': {approvalPolicy: 'never', sandbox: 'danger-full-access'},
  }[config.permissionMode ?? 'never'];
  if (!permission) throw fail('不支持的 Codex 权限模式');
  const opened = await rpc(previous ? 'thread/resume' : 'thread/start', {
    cwd: request.cwd, ...permission, ...(options.model || config.model ? {model: options.model || config.model} : {}),
    ...(previous ? {threadId: previous.id} : {ephemeral: false}),
  });
  threadId = opened.thread?.id;
  if (!idValid(threadId) || opened.thread.ephemeral === true || (previous && threadId !== previous.id)) throw fail('Codex 未返回预期的持久会话');
  hooks.opened(threadId);
  return async () => {
    completion = Promise.withResolvers(); completion.promise.catch(() => {});
    if (operation === 'compact') {
      if (!previous) throw fail('没有可压缩的 Codex 会话');
      await rpc('thread/compact/start', {threadId});
    } else {
      const response = await rpc('turn/start', {threadId, input: request.prompt.map(b => ({type: 'text', text: b.text, text_elements: []}))});
      turnId = response.turn?.id;
      if (!idValid(turnId) || (pendingTurn && turnId !== pendingTurn)) throw fail('Codex turn/start 与通知不匹配');
    }
    const terminal = await guarded(completion.promise);
    if (terminal.status !== 'completed') {
      if (terminal.error?.codexErrorInfo === 'contextWindowExceeded') throw fail('contextWindowExceeded', 'ORCHESTRATOR_CONTEXT_LIMIT');
      throw new Error(codexErrorDetail(terminal.error) ?? 'Codex 本轮未正常完成');
    }
    if (operation === 'compact') {
      if (!compactionSeen) throw fail('Codex 未提供压缩完成证据');
      return result('原生会话压缩完成');
    }
    const output = answer ?? partial ?? unphased;
    if (!output?.trim()) throw fail('Codex 未返回有效答案');
    hooks.update({turns: ++turns});
    return result(output);
  };
}
