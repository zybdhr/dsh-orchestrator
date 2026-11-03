import {configuredProvider, modelCatalog} from './native-models.js';
import {discoverProviderModels, mergeDiscoveredModels} from './model-discovery.js';
/** 通过官方 activation 执行；持续会话复用原生协议/SDK及宿主子进程服务。 */
export class DshAdapter {
  constructor(ctx, {configureProvider = configuredProvider, discoverModels = discoverProviderModels, terminals} = {}) { this.ctx = ctx; this.configureProvider = configureProvider; this.discoverModels = discoverModels; this.terminals = terminals; }
  providers() { return this.ctx.subagents.list().filter(name => ['codex', 'claude-code'].includes(name)); }
  modelCatalog() {
    const providers = Object.fromEntries(['codex', 'claude-code'].map(name => [name, this.ctx.subagents.getProvider(name)?.config ?? {}]));
    return modelCatalog(undefined, {providers});
  }
  async refreshModels() {
    const catalog = this.modelCatalog();
    for (const provider of ['codex', 'claude-code']) {
      if (!this.ctx.subagents.getProvider(provider)) {catalog[provider].warning = '后端未启用，仅显示本地候选'; continue;}
      try {
        mergeDiscoveredModels(catalog, provider, await this.discoverModels(this.ctx, provider));
        catalog[provider].refreshedAt = new Date().toISOString();
      } catch (error) {
        catalog[provider].warning = '原生目录查询未完成，保留本地和已配置候选；请检查 CLI 登录及后端状态。';
        if (error.code === 'ORCHESTRATOR_CATALOG_CLEANUP_FAILED') break;
      }
    }
    return catalog;
  }
  async execute({provider, parent, cwd, prompt, signal, label, onStarted, modelOptions = {}, access = 'read', verification = [], continuity, executionMode, terminalInfo, onTerminal, onAttention, onPermissionWait, executionPolicy, resources}) {
    if (!['codex', 'claude-code'].includes(provider)) throw new Error('此模式只允许通过 Codex 或 Claude Code 执行任务');
    if (executionMode === 'terminal') {
      if (!this.terminals) throw new Error('当前宿主未装配可见子代理终端');
      return this.terminals.execute({provider, parent, cwd, prompt, signal, label, onStarted, modelOptions, access, verification, continuity, terminalInfo, onTerminal, onAttention, onPermissionWait, executionPolicy, resources});
    }
    const descriptor = this.ctx.subagents.getProvider(provider);
    if (!descriptor) throw new Error(`提供方未注册：${provider}`);
    if (descriptor.inheritsParentContext) throw new Error(`编排任务要求独立上下文，不能使用继承父历史的提供方：${provider}`);
    const writeAccess = provider === 'claude-code' && access === 'write';
    const configured = await this.configureProvider(this.ctx, provider, {...modelOptions, verification, ...(writeAccess ? {writeAccess: true} : {}), executionPolicy, approvalContext: {parent, signal, onPermissionWait, ctx: this.ctx, label}, ...(continuity ? {continuity} : {})});
    let activation;
    try {
      activation = await this.ctx.subagents.startActivation({
        provider: configured?.name ?? provider, label, request: {parent, cwd, prompt: [{type: 'text', text: prompt}]}, signal, delivery: 'caller',
      });
    } catch (error) {configured?.dispose(); throw error;}
    let cleanup;
    const abort = () => { cleanup ??= activation.dispose(); cleanup.catch(() => {}); };
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort();
    try {
      onStarted?.(String(activation.childId));
      const result = await activation.result;
      signal.throwIfAborted();
      return {stopReason: result.stopReason, failureCode: configured?.failure?.()?.code,
        diagnostic: result.stopReason === 'completed' ? result.diagnostic : [result.diagnostic, configured?.failure?.()?.message, configured?.diagnostic?.()].filter(Boolean).join('\n'),
        text: result.output.filter(block => block.type === 'text').map(block => block.text).join('\n')};
    } finally {
      signal.removeEventListener('abort', abort);
      try { await (cleanup ?? activation.dispose()); }
      catch (cause) { const error = new Error('子 Agent 资源未能释放，已停止继续调度', {cause}); error.code = 'ORCHESTRATOR_CLEANUP_FAILED'; throw error; }
      finally {configured?.dispose();}
    }
  }
}
