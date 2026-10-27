import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {JsonRpcLineTransport} from '@deepseek-ai/dsh-sdk-protocol';
import {scrubbedParentEnv} from '@deepseek-ai/dsh-subprocess';
import {ManagedSdkProcess} from './native-sessions.js';
import {resolveCodexRuntime} from './codex-runtime.js';
import {EFFORTS} from './native-models.js';

// 只投影目录元数据，错误与原生自由文本不透传到浏览器。
export function mergeDiscoveredModels(catalog, provider, rows, source = '原生目录') {
  const target = catalog[provider];
  for (const row of rows.slice(0, 1000)) {
    const id = row?.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\x00-\x1f]/.test(id)) continue;
    const efforts = (Array.isArray(row.efforts) ? row.efforts : []).filter(value => EFFORTS[provider].includes(value));
    const previous = target.models.find(model => model.id === id);
    const metadata = {id, label: typeof row.label === 'string' ? row.label.replace(/[\x00-\x1f]/g, '').slice(0, 200) : id,
      efforts, ...(typeof row.effortSupported === 'boolean' ? {effortSupported: row.effortSupported} : {}), ...(row.hidden ? {hidden: true} : {})};
    if (previous) {
      if (efforts.length) previous.efforts = efforts;
      if (metadata.label !== id) previous.label = metadata.label;
      previous.sources = [...new Set([...(previous.sources ?? []), source])];
      if (row.hidden) previous.hidden = true;
      if (typeof row.effortSupported === 'boolean') previous.effortSupported = row.effortSupported;
    } else if (target.models.length < 1000) target.models.push({...metadata, sources: [source]});
  }
}

/** 元数据查询不提交 prompt、不创建业务线程；逐个后端查询并严格释放 managed range。 */
export async function discoverProviderModels(ctx, provider, {timeoutMs = 15000, querySdk, resolveRuntime = resolveCodexRuntime} = {}) {
  const config = ctx.subagents.getProvider(provider)?.config ?? {};
  const controller = new AbortController();
  let child, transport, framed, query, closePrompt;
  const timer = setTimeout(() => controller.abort(new Error('模型目录查询超时')), timeoutMs);
  const stopped = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {once: true}));
  stopped.catch(() => {});
  const spawn = spec => {
    child = ctx.subprocess.spawn({...spec, signal: controller.signal, graceMs: config.disposeGraceMs ?? 3000,
      stdio: {stdin: 'pipe', stdout: 'pipe', stderr: {maxBytes: 8192}}});
    child.done.catch(() => {});
    return child;
  };
  const bounded = promise => Promise.race([promise, stopped]);
  try {
    if (provider === 'codex') {
      const runtime = resolveRuntime({pathEnv: config.env?.PATH ?? process.env.PATH});
      spawn({argv: [...runtime.argv, 'app-server', '--stdio'], cwd: ctx.get('profileContext')?.dir ?? process.cwd(), env: config.env});
      let size = 0;
      framed = new Transform({transform(chunk, _encoding, callback) {
        for (const byte of chunk) {size = byte === 10 ? 0 : size + 1; if (size > 8 * 1024 * 1024) return callback(new Error('模型目录帧过大'));}
        callback(null, chunk);
      }});
      const fatal = error => controller.abort(error instanceof Error ? error : new Error('模型目录进程结束'));
      framed.on('error', fatal); child.stdout.on('error', fatal); child.stdin.on('error', fatal);
      child.done.then(fatal, fatal);
      transport = new JsonRpcLineTransport(framed, child.stdin);
      transport.onRequest(async () => {throw new Error('目录查询不接受业务操作');});
      child.stdout.pipe(framed); transport.start();
      const rpc = (method, params) => bounded(transport.request(method, params, controller.signal));
      await rpc('initialize', {clientInfo: {name: 'dsh-model-catalog', version: '1'}, capabilities: {experimentalApi: false}});
      transport.notify('initialized');
      const models = [], seen = new Set();
      let cursor;
      for (let page = 0; page < 10; page++) {
        const result = await rpc('model/list', {cursor, limit: 100, includeHidden: true});
        for (const row of result.data ?? []) models.push({id: row.model || row.id, label: row.displayName,
          hidden: row.hidden, efforts: (row.supportedReasoningEfforts ?? []).map(value => value.reasoningEffort)});
        if (!result.nextCursor) return models;
        if (seen.has(result.nextCursor)) throw new Error('模型目录分页重复');
        cursor = result.nextCursor; seen.add(cursor);
      }
      throw new Error('模型目录超出分页上限');
    }
    let sdkQuery = querySdk;
    if (!sdkQuery) {
      const dir = ctx.get('profileContext')?.dir;
      const require = createRequire(dir ? join(dir, 'package.json') : import.meta.url);
      const nativeRequire = createRequire(require.resolve('@deepseek-ai/dsh-subagent-claude-code'));
      sdkQuery = (await import(pathToFileURL(nativeRequire.resolve('@anthropic-ai/claude-agent-sdk')))).query;
    }
    const promptClosed = new Promise(resolve => {closePrompt = resolve;});
    async function* noPrompt() {await promptClosed;}
    query = sdkQuery({prompt: noPrompt(), options: {
      cwd: ctx.get('profileContext')?.dir ?? process.cwd(), env: {...scrubbedParentEnv(), ...config.env},
      abortController: controller, persistSession: false, settingSources: ['user'],
      tools: [], permissionMode: 'dontAsk', strictMcpConfig: true, mcpServers: {}, settings: {disableAllHooks: true},
      canUseTool: async () => ({behavior: 'deny', message: '模型目录查询不执行业务操作'}),
      spawnClaudeCodeProcess: spec => new ManagedSdkProcess(spawn({argv: [spec.command, ...spec.args], cwd: spec.cwd, env: spec.env})),
    }});
    const models = await bounded(query.supportedModels());
    return models.flatMap(row => [...new Set([row.value, row.resolvedModel].filter(Boolean))].map(id => ({id,
      label: row.displayName, effortSupported: row.supportsEffort, efforts: row.supportedEffortLevels ?? []})));
  } finally {
    clearTimeout(timer); closePrompt?.();
    try {query?.close();} finally {
      transport?.close(); framed?.destroy();
      if (child) {child.terminate(); if (!await child.waitForExit()) throw Object.assign(new Error('模型目录进程未能释放'), {code: 'ORCHESTRATOR_CATALOG_CLEANUP_FAILED'}); await child.done.catch(() => {});}
    }
  }
}
