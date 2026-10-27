import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, existsSync} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {resolveCodexRuntime} from './codex-runtime.js';
import {withClaudeTools} from './claude-permissions.js';
import {claudeTerminalCompatibility} from './claude-compatibility.js';
import {permissionRequestHash} from './terminal-hook.mjs';

const failure = message => Object.assign(new Error(message), {code: 'ORCHESTRATOR_SESSION_BLOCKED'});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const shellQuote = text => `'${String(text).replaceAll("'", "'\\''")}'`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hookPath = fileURLToPath(new URL('./terminal-hook.mjs', import.meta.url));
const readJson = path => {try {return JSON.parse(readFileSync(path, 'utf8'));} catch {return null;}};
const remove = path => {try {unlinkSync(path);} catch (error) {if (error.code !== 'ENOENT') throw error;}};
const save = (path, data) => {writeFileSync(`${path}.tmp`, JSON.stringify(data), {mode: 0o600}); renameSync(`${path}.tmp`, path);};

/** 真实原生交互 CLI 的有界 PTY 池；完成依赖 CLI 回调，输出仅用于观察和启动提示。 */
export class VisibleTerminals {
  constructor(ctx, {root, maxLive = 4, screenFactory, resolveRuntime = resolveCodexRuntime, idleMs = 30 * 60000} = {}) {
    this.ctx = ctx; this.root = root; this.maxLive = maxLive; this.screenFactory = screenFactory;
    this.idleMs = idleMs; this.entries = new Map(); this.closed = false;
    this.resolveRuntime = resolveRuntime;
    mkdirSync(root, {recursive: true, mode: 0o700});
  }
  async screen() {
    if (this.screenFactory) return this.screenFactory();
    const module = await import('@xterm/headless');
    const Terminal = module.Terminal ?? module.default?.Terminal;
    return new Terminal({cols: 120, rows: 32, scrollback: 500, allowProposedApi: true});
  }
  text(entry) {
    const buffer = entry.screen.buffer.active, lines = [];
    for (let index = Math.max(0, buffer.length - 532); index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
    return lines.join('\n').slice(-128000);
  }
  snapshot(entry, withScreen = true) {
    return {id: entry.id, ...entry.meta, provider: entry.provider, nativeSessionId: entry.sessionId,
      status: entry.status, control: entry.control, error: entry.error, ...(withScreen ? {screen: this.text(entry)} : {}), updatedAt: entry.updatedAt};
  }
  list(owner, screenId) {return [...this.entries.values()].filter(entry => entry.meta.owner === owner).map(entry => this.snapshot(entry, entry.id === screenId));}
  owned(id, owner) {const entry = this.entries.get(id); if (!entry || entry.meta.owner !== owner) throw new Error('终端不存在或不属于此会话'); return entry;}
  async stop(entry) {
    clearTimeout(entry.idleTimer);
    if (entry.stopping) return entry.stopping;
    if (!entry.pty) return;
    entry.stopping = (async () => {
      try {await entry.pty.terminate();} catch (cause) {
        this.cleanupFailure = Object.assign(new Error('子代理终端资源未能释放', {cause}), {code: 'ORCHESTRATOR_CLEANUP_FAILED'});
        entry.error = this.cleanupFailure.message; throw this.cleanupFailure;
      }
      entry.pty = null; entry.status = 'closed'; entry.updatedAt = Date.now();
      for (const name of readdirSync(entry.directory)) if (/^permission-(?:request|response)-[0-9a-f-]{36}\.json$/.test(name)) remove(join(entry.directory, name));
    })();
    try {await entry.stopping;} finally {entry.stopping = null;}
  }
  async acquire(args) {
    if (this.cleanupFailure) throw this.cleanupFailure;
    if (this.closed) throw failure('终端池已停止');
    const config = this.ctx.subagents.getProvider(args.provider)?.config;
    if (!config) throw failure('CLI 后端未启用');
    const compatibility = args.provider === 'claude-code' ? claudeTerminalCompatibility(config.env) : undefined;
    const profileKey = hash({provider: args.provider, config, options: args.modelOptions, access: args.access, verification: args.verification, transport: 'visible-terminal-v1', compatibility});
    const existing = [...this.entries.values()].find(entry => entry.binding === args.continuity.binding && entry.profileKey === profileKey && entry.pty);
    if (existing) {
      if (existing.control === 'human') throw failure('该子代理终端已被人工接管，请先交还控制权');
      if (existing.job || ['starting', 'running'].includes(existing.status)) throw failure('该终端仍在启动或执行另一项调用');
      if (existing.status === 'waiting') throw failure('CLI 正在等待初始化或授权，请先接管处理后再交还');
      clearTimeout(existing.idleTimer); return existing;
    }
    const live = [...this.entries.values()].filter(entry => entry.pty);
    if (live.length >= this.maxLive) {
      const oldest = live.filter(entry => !entry.job && entry.control === 'automatic' && ['idle', 'exited', 'failed'].includes(entry.status)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) throw failure('常驻终端已达到上限，请等待任务完成或关闭已接管的终端');
      await this.stop(oldest);
    }
    // 串行分配由 execute 的分配锁保护；不在业务任务之间共享原生会话。
    const prior = args.continuity.previous;
    const reusable = prior?.profileKey === profileKey && prior.binding === args.continuity.binding && prior.provider === args.provider;
    if (prior && !reusable) args.continuity.onEvent?.({type: 'replaced', reason: '切换为可见终端或 CLI 设置发生变化'});
    const id = randomUUID(), directory = join(this.root, id);
    mkdirSync(directory, {recursive: true, mode: 0o700});
    const entry = {id, directory, binding: args.continuity.binding, profileKey, provider: args.provider,
      meta: args.terminalInfo, parent: args.parent, control: 'automatic', status: 'starting', updatedAt: Date.now(),
      sessionId: reusable ? prior.id : args.provider === 'claude-code' ? randomUUID() : undefined,
      screen: await this.screen(), turns: reusable ? prior.turns ?? 0 : 0};
    const hook = [process.execPath, hookPath, directory, args.provider];
    let argv;
    if (args.provider === 'codex') {
      const runtime = this.resolveRuntime({pathEnv: config.env?.PATH ?? process.env.PATH});
      argv = [...runtime.argv, ...(entry.sessionId ? ['resume', entry.sessionId] : []), '--no-alt-screen', '-C', args.cwd,
        '-s', args.access === 'write' ? 'workspace-write' : 'read-only', '-c', 'approval_policy="never"', '-c', 'check_for_update_on_startup=false', '-c', `notify=${JSON.stringify(hook)}`,
        ...(args.modelOptions.model ? ['-m', args.modelOptions.model] : []),
        ...(args.modelOptions.reasoningEffort ? ['-c', `model_reasoning_effort=${JSON.stringify(args.modelOptions.reasoningEffort)}`] : [])];
    } else {
      const executable = await this.ctx.subprocess.resolveExecutable('claude', config.env, args.signal);
      const command = hook.map(shellQuote).join(' ');
      const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'].map(event => [event, [{hooks: [{type: 'command', command, timeout: event === 'PermissionRequest' ? 310 : 10}]}]]));
      argv = withClaudeTools({argv: [executable, ...(reusable ? ['--resume', entry.sessionId] : ['--session-id', entry.sessionId]),
        '--ax-screen-reader', '--permission-mode', args.access === 'write' ? 'acceptEdits' : 'dontAsk', '--settings', JSON.stringify({hooks, env: compatibility}),
        '--disallowedTools', 'AskUserQuestion,ExitPlanMode',
        ...(args.modelOptions.model ? ['--model', args.modelOptions.model] : []),
        ...(args.modelOptions.reasoningEffort ? ['--effort', args.modelOptions.reasoningEffort] : [])]},
      {writeAccess: args.access === 'write', verification: args.verification}).argv;
    }
    // 原生 PTY 生命周期属于终端池；调用取消由 execute 决定是否停止，人工授权等待必须存活。
    const launching = new AbortController(), cancelLaunch = () => launching.abort(args.signal.reason);
    args.signal.addEventListener('abort', cancelLaunch, {once: true});
    if (args.signal.aborted) cancelLaunch();
    try {
      entry.pty = await this.ctx.subprocess.spawnTerminal({argv, cwd: args.cwd, env: {...config.env, ...(args.provider === 'claude-code' ? {DISABLE_AUTOUPDATER: '1'} : {}), TERM: 'xterm-256color'},
        cols: 120, rows: 32, terminalType: 'xterm-256color', graceMs: 3000, signal: launching.signal});
    } catch (error) {entry.screen.dispose(); throw error;}
    finally {args.signal.removeEventListener('abort', cancelLaunch);}
    this.entries.set(id, entry);
    entry.pendingBytes = 0;
    entry.pty.output.on('data', chunk => {
      const text = chunk.toString(), bytes = Buffer.byteLength(text);
      if (entry.pendingBytes + bytes > 2 * 1024 * 1024) {
        entry.error = '终端输出超过缓冲上限，已停止进程'; entry.job?.reject(failure(entry.error)); this.stop(entry).catch(() => {}); return;
      }
      entry.pendingBytes += bytes; entry.screen.write(text, () => {entry.pendingBytes -= bytes;}); entry.updatedAt = Date.now();
    });
    entry.pty.output.on('error', () => {entry.error = '终端输出中断'; entry.job?.reject(failure(entry.error));});
    entry.pty.done.then(() => {if (entry.status !== 'closed') entry.status = 'exited'; entry.job?.reject(failure('原生 CLI 已退出，任务未收到完成事件'));}, () => {entry.status = 'failed'; entry.job?.reject(failure('原生 CLI 终端异常'));});
    // 已停止的屏幕只保留最近 64 个，实时 PTY 数单独受 maxLive 限制。
    for (const retired of [...this.entries.values()].filter(item => !item.pty).slice(0, Math.max(0, this.entries.size - 64))) {retired.screen.dispose(); this.entries.delete(retired.id);}
    return entry;
  }
  checkpoint(entry, args) {
    if (!entry.sessionId) return;
    save(join(entry.directory, 'identity.json'), {sessionId: entry.sessionId});
    args.continuity.onSession({id: entry.sessionId, provider: entry.provider, binding: entry.binding, profileKey: entry.profileKey,
      turns: entry.turns, compactions: args.continuity.previous?.compactions ?? 0, createdAt: args.continuity.previous?.createdAt ?? new Date().toISOString()});
  }
  async confirmClaudeIdle(entry, args) {
    const executable = await this.ctx.subprocess.resolveExecutable('claude', undefined, args.signal);
    const config = this.ctx.subagents.getProvider('claude-code')?.config ?? {};
    for (let attempt = 0; attempt < 5; attempt++) {
      args.signal.throwIfAborted();
      const controller = new AbortController(), signal = AbortSignal.any([args.signal, controller.signal]);
      const child = this.ctx.subprocess.spawn({argv: [executable, 'agents', '--json'], cwd: args.cwd, env: {...config.env, DISABLE_AUTOUPDATER: '1'},
        signal, graceMs: 1000, stdio: {stdin: 'ignore', stdout: 'pipe', stderr: {maxBytes: 4096}}});
      let output = '', tooLarge = false;
      child.stdout.on('data', chunk => {if (Buffer.byteLength(output) + chunk.length > 1024 * 1024) {tooLarge = true; controller.abort();} else output += chunk;});
      const timer = setTimeout(() => controller.abort(), 5000);
      let done;
      try {done = await child.done;} finally {
        clearTimeout(timer); child.terminate();
        if (!await child.waitForExit()) throw Object.assign(new Error('CLI 状态查询进程未能释放'), {code: 'ORCHESTRATOR_CLEANUP_FAILED'});
      }
      if (tooLarge || done.exitCode !== 0) throw failure('无法核实 Claude CLI 完成状态，请查看终端或切换原生协议方式');
      let rows;
      try {rows = JSON.parse(output);} catch {throw failure('Claude CLI 状态接口返回无效数据');}
      if (Array.isArray(rows) && rows.some(row => row.sessionId === entry.sessionId && row.status === 'idle')) return;
      await delay(200);
    }
    throw failure('Claude 停止事件后仍未确认空闲，已停止自动流转，请接管核查');
  }
  async requestPermission(entry, args, jobId, request, path) {
    const controller = new AbortController(), limit = setTimeout(() => controller.abort(new Error('授权等待时间过长')), 270000);
    entry.approvalControllers ??= new Set(); entry.approvalControllers.add(controller);
    entry.approvalRequests ??= new Map(); entry.approvalRequests.set(request.requestId, path);
    const signal = AbortSignal.any([args.signal, controller.signal]);
    let behavior = 'fallback';
    args.onPermissionWait?.(true);
    entry.status = 'waiting'; entry.error = '等待 DSH 选项弹窗中的授权选择'; entry.updatedAt = Date.now();
    try {
      const questions = args.parent?.ctx?.get?.('userQuestions') ?? this.ctx.get?.('userQuestions');
      if (!args.parent || !questions?.ask) throw new Error('DSH 选项服务不可用');
      const toolInput = JSON.stringify(request.toolInput, null, 2);
      if (!toolInput || Buffer.byteLength(toolInput) > 12000 || /[\u202a-\u202e\u2066-\u2069]/u.test(toolInput)) throw new Error('授权内容无法完整安全展示');
      const runs = toolInput.match(/`+/g) ?? [], fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
      const questionId = `cli-permission-${request.requestId}`;
      const choices = ['允许本次', '拒绝'];
      const cancelled = new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), {once: true});
      });
      const answer = await Promise.race([questions.ask({agent: args.parent, signal, questions: [{id: questionId,
        header: '子代理授权请求', question: `${entry.meta.title}：是否允许 Claude 使用 ${request.toolName}？`,
        detail: `工作目录：${args.cwd}\n\n请求参数：\n\n${fence}json\n${toolInput}\n${fence}`,
        options: choices.map(label => ({label})), multiSelect: false}]}), cancelled]);
      const item = answer?.answers?.length === 1 && answer.answers[0];
      if (item?.id !== questionId || item.custom || !Array.isArray(item.selected) || item.selected.length !== 1 || !choices.includes(item.selected[0])) throw new Error('授权选择无效');
      behavior = item.selected[0] === choices[0] ? 'allow' : 'deny';
    } catch {} finally {
      clearTimeout(limit); entry.approvalControllers.delete(controller);
      const current = readJson(path);
      if (entry.job?.jobId === jobId && entry.control === 'automatic' && !args.signal.aborted && existsSync(path)) {
        const matches = current?.requestHash === request.requestHash && permissionRequestHash(current) === request.requestHash;
        save(join(entry.directory, `permission-response-${request.requestId}.json`), {requestId: request.requestId, requestHash: request.requestHash, behavior: matches ? behavior : 'fallback'});
      }
      entry.approvalRequests.delete(request.requestId);
      if (!entry.approvalControllers.size && entry.job?.jobId === jobId && entry.control === 'automatic') {
        entry.status = 'running'; entry.error = null; entry.updatedAt = Date.now();
      }
      args.onPermissionWait?.(false);
    }
  }
  async execute(args) {
    if (!args.continuity || !args.terminalInfo) throw failure('缺少终端任务归属信息');
    if (args.continuity.operation === 'compact') throw failure('可见 CLI 使用原生自动压缩；手动压缩需在接管终端后执行');
    // 只锁分配，业务执行仍按引擎并发上限运行。
    const previousLock = this.allocation ?? Promise.resolve();
    let release; this.allocation = new Promise(resolve => {release = resolve;});
    await previousLock;
    let entry;
    try {args.signal.throwIfAborted(); entry = await this.acquire(args);} finally {release();}
    args.onTerminal?.({id: entry.id, provider: entry.provider}); args.onStarted?.(`terminal-${entry.id}`);
    this.checkpoint(entry, args);
    let lastEvent; const seenPermissions = new Set();
    const readyUntil = Date.now() + 20000;
    while (entry.status === 'starting') {
      if (args.signal.aborted) {if (entry.control !== 'human') await this.stop(entry); args.signal.throwIfAborted();}
      if (entry.control === 'human') throw failure('终端已被人工接管');
      const event = readJson(join(entry.directory, 'event.json'));
      if (event?.type === 'ready' || entry.provider === 'codex' && /Ask Codex/.test(this.text(entry))) {entry.status = 'idle'; break;}
      if (Date.now() >= readyUntil) {
        entry.error = 'CLI 尚未就绪，可能正在等待初始化或授权；可打开终端查看并接管'; entry.status = 'waiting';
        entry.idleTimer = setTimeout(() => {this.stop(entry).catch(() => {});}, this.idleMs); entry.idleTimer.unref?.(); throw failure(entry.error);
      }
      await delay(100);
    }
    if (!entry.pty || ['failed', 'exited'].includes(entry.status)) throw failure('CLI 终端已经退出');
    if (entry.control === 'human') throw failure('终端已被人工接管');
    const jobId = randomUUID(), marker = `[DSH_CALL:${jobId}]`;
    const completion = Promise.withResolvers(); completion.promise.catch(() => {});
    entry.job = {jobId, reject: completion.reject}; entry.status = 'running'; entry.error = null;
    save(join(entry.directory, 'active.json'), {jobId, marker}); remove(join(entry.directory, 'started.json'));
    const abort = () => completion.reject(args.signal.reason ?? failure('调用已停止'));
    args.signal.addEventListener('abort', abort, {once: true});
    const poll = setInterval(async () => {
      for (const name of readdirSync(entry.directory)) {
        const match = /^permission-request-([0-9a-f-]{36})\.json$/.exec(name);
        if (!match || seenPermissions.has(match[1])) continue;
        const path = join(entry.directory, name), request = readJson(path);
        if (!request || request.requestId !== match[1] || request.jobId !== jobId || request.sessionId !== entry.sessionId || request.requestHash !== permissionRequestHash(request) || entry.control !== 'automatic') continue;
        seenPermissions.add(request.requestId);
        this.requestPermission(entry, args, jobId, request, path).catch(error => completion.reject(error));
      }
      const attention = readJson(join(entry.directory, 'attention.json'));
      if (attention?.type === 'permission-required' && attention.jobId === jobId && attention.sessionId === entry.sessionId && entry.control === 'automatic') {
        const error = Object.assign(new Error(`等待 ${attention.toolName || '工具'} 执行授权；编排已暂停，请进入终端接管并处理授权，完成后交还并显式继续`), {code: 'ORCHESTRATOR_APPROVAL_REQUIRED'});
        // 先保留 PTY 并解除自动调用，再暂停其他分支；接管时不能发送 Ctrl+C 取消授权框。
        entry.control = 'human'; entry.status = 'waiting'; entry.error = error.message; entry.updatedAt = Date.now();
        for (const controller of entry.approvalControllers ?? []) controller.abort(error);
        entry.job = null; remove(join(entry.directory, 'active.json'));
        completion.reject(error); args.onAttention?.(error); return;
      }
      const event = readJson(join(entry.directory, 'event.json'));
      if (!event || event.eventId === lastEvent) return;
      lastEvent = event.eventId;
      if (event.type !== 'completed' || event.jobId !== jobId) return;
      if (event.background) return completion.reject(failure('CLI 仍有后台任务，已停止自动流转，请接管核查'));
      if (entry.sessionId && entry.sessionId !== event.sessionId) return completion.reject(failure('原生会话身份发生变化，拒绝接收结果'));
      if (event.failed || !event.text.trim()) return completion.reject(failure('原生 CLI 未正常返回有效结果，请查看终端'));
      try {
        if (entry.provider === 'claude-code') await this.confirmClaudeIdle(entry, args);
        if (entry.control !== 'automatic' || args.signal.aborted || entry.job?.jobId !== jobId) return;
        entry.sessionId = event.sessionId; completion.resolve(event.text);
      } catch (error) {completion.reject(error);}
    }, 100);
    try {
      const text = `${marker}\n${args.prompt}`.replaceAll('\x1b', '').replaceAll('\0', '');
      await entry.pty.write(`\x1b[200~${text}\x1b[201~`); await delay(400);
      if (entry.control !== 'automatic') throw failure('终端已被人工接管');
      args.signal.throwIfAborted(); await entry.pty.write('\r');
      const output = await completion.promise;
      entry.turns++; this.checkpoint(entry, args); entry.status = 'idle'; entry.updatedAt = Date.now();
      return {stopReason: 'completed', text: output};
    } catch (error) {
      entry.error = error.message;
      if (entry.control !== 'human') await this.stop(entry);
      throw error;
    } finally {
      for (const controller of entry.approvalControllers ?? []) controller.abort(new Error('终端调用已结束'));
      clearInterval(poll); args.signal.removeEventListener('abort', abort); entry.job = null; remove(join(entry.directory, 'active.json'));
      if (entry.pty && entry.control === 'automatic') {entry.idleTimer = setTimeout(() => {this.stop(entry).catch(() => {});}, this.idleMs); entry.idleTimer.unref?.();}
    }
  }
  async takeover(id, owner) {
    const entry = this.owned(id, owner);
    if (!entry.pty) throw new Error('终端已关闭，不能接管');
    const wasRunning = Boolean(entry.job);
    const waitingApproval = (entry.approvalRequests?.size ?? 0) > 0;
    // 人工接管时先让 hook 交回原生授权框，不能把数字选择猜成按键或发送中断。
    for (const [requestId, path] of entry.approvalRequests ?? []) {
      if (existsSync(path)) save(join(entry.directory, `permission-response-${requestId}.json`), {requestId, behavior: 'fallback'});
    }
    for (const controller of entry.approvalControllers ?? []) controller.abort(new Error('用户接管终端'));
    entry.control = 'human'; entry.lease = randomUUID(); clearTimeout(entry.idleTimer); remove(join(entry.directory, 'active.json'));
    entry.job?.reject(failure('用户接管终端，编排已暂停'));
    if (wasRunning && !waitingApproval) await entry.pty.write(entry.provider === 'codex' ? '\x1b' : '\x03');
    return {...this.snapshot(entry), lease: entry.lease};
  }
  async input(id, owner, data, lease) {
    const entry = this.owned(id, owner);
    if (entry.control !== 'human' || !entry.pty || !lease || entry.lease !== lease) throw new Error('控制权已失效，请重新接管终端');
    if (typeof data !== 'string' || Buffer.byteLength(data) > 16000) throw new Error('终端输入无效或过长');
    await entry.pty.write(data);
  }
  async release(id, owner, lease) {
    const entry = this.owned(id, owner);
    if (entry.control !== 'human' || !lease || entry.lease !== lease) throw new Error('控制权已失效，请重新接管终端');
    // 交还先证明旧进程及其工具已完全停止，再允许重建原生会话继续。
    const event = readJson(join(entry.directory, 'event.json'));
    if (event?.sessionId && ['manual-completed', 'completed', 'ready'].includes(event.type)) entry.sessionId = event.sessionId;
    await this.stop(entry); entry.control = 'automatic'; entry.lease = null; return this.snapshot(entry);
  }
  async close() {
    this.closed = true;
    const results = await Promise.allSettled([...this.entries.values()].map(entry => this.stop(entry)));
    for (const entry of this.entries.values()) if (!entry.pty) entry.screen.dispose();
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), '部分子代理终端未能完全释放');
  }
}
