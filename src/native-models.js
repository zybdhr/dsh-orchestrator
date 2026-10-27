import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {withCodexRuntime, observeCodexErrors} from './codex-runtime.js';
import {withClaudeTools} from './claude-permissions.js';
import {createSessionProvider} from './native-sessions.js';

export const EFFORTS = Object.freeze({
  codex: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  'claude-code': ['low', 'medium', 'high', 'xhigh', 'max'],
});
export const PROVIDER_IDS = Object.freeze(Object.keys(EFFORTS));
export const ALIAS_PREFIX = Object.freeze({codex: 'codex', 'claude-code': 'claude'});
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,199}$/i;
const control = value => /[\x00-\x1f]/.test(value);

/** 默认别名使用 CLI 名 + 模型 ID 的可读 slug，例如 codex-gpt-6-luna、claude-deepseek-v4.1-flash-1017。 */
export function defaultModelAlias(provider, model) {
  if (!Object.hasOwn(EFFORTS, provider)) throw new Error(`暂不支持为 ${provider} 配置模型别名`);
  const modelPart = String(model || 'native').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '') || 'native';
  // 模型名已带 CLI 前缀时不重复，例如 claude-opus-5[1M] → claude-opus-5-1m。
  const prefix = ALIAS_PREFIX[provider];
  return (modelPart.startsWith(`${prefix}-`) ? modelPart : `${prefix}-${modelPart}`).slice(0, 200).replace(/[-._]+$/g, '');
}

export function uniqueModelAlias(provider, model, used = []) {
  const base = defaultModelAlias(provider, model), taken = new Set(used);
  let alias = base, suffix = 2;
  while (taken.has(alias)) alias = `${base.slice(0, 196)}-${suffix++}`;
  return alias;
}

export function findModelByAlias(models, alias) {
  return (Array.isArray(models) ? models : []).find(entry => entry.alias === alias);
}

export function defaultModelEntry(models, provider) {
  const entries = (Array.isArray(models) ? models : []).filter(entry => entry.provider === provider);
  return entries.find(entry => entry.default) ?? entries[0];
}

/**
 * 兼容旧版 {codex:{model,reasoningEffort}}，统一迁移为条目数组。
 * 每个条目绑定 provider 与模型；alias 是编排层的稳定目标名。
 */
export function normalizeModelsConfig(models) {
  if (models == null) return [];
  let raw;
  if (Array.isArray(models)) raw = models.map(entry => ({...entry}));
  else if (typeof models === 'object') {
    raw = [];
    for (const [provider, value] of Object.entries(models)) {
      if (!Object.hasOwn(EFFORTS, provider)) throw new Error(`暂不支持为 ${provider} 覆盖模型参数`);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['model', 'reasoningEffort'].includes(k))) throw new Error('模型配置只能包含 model 和 reasoningEffort');
      raw.push({provider, model: value.model ?? '', reasoningEffort: value.reasoningEffort ?? '', default: true});
    }
  } else throw new Error('模型配置必须为条目数组或旧版后端对象');

  const aliases = new Set(), entries = [];
  for (const [index, value] of raw.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`第 ${index + 1} 个模型条目无效`);
    const provider = value.provider;
    if (!Object.hasOwn(EFFORTS, provider)) throw new Error(`暂不支持为 ${provider} 配置模型`);
    if (typeof value.model !== 'string' || value.model.length > 200 || control(value.model)) throw new Error('模型 ID 无效');
    if (typeof (value.reasoningEffort ?? '') !== 'string' || (value.reasoningEffort && !EFFORTS[provider].includes(value.reasoningEffort))) throw new Error(`${provider} 不支持此推理强度`);
    if (value.default !== undefined && typeof value.default !== 'boolean') throw new Error('default 必须为布尔值');
    let alias;
    if (value.alias === undefined || value.alias === '') alias = uniqueModelAlias(provider, value.model, aliases);
    else {
      if (typeof value.alias !== 'string' || !ALIAS_PATTERN.test(value.alias)) throw new Error('模型别名只能使用字母、数字、点、下划线和横线，且必须以字母或数字开头');
      alias = value.alias;
    }
    if (PROVIDER_IDS.includes(alias)) throw new Error(`模型别名不能与后端 id 相同：${alias}`);
    if (aliases.has(alias)) throw new Error(`模型别名重复：${alias}`);
    aliases.add(alias);
    entries.push({provider, model: value.model, reasoningEffort: value.reasoningEffort ?? '', alias, default: Boolean(value.default)});
  }
  for (const provider of PROVIDER_IDS) {
    const own = entries.filter(entry => entry.provider === provider);
    if (!own.length) continue;
    const defaults = own.filter(entry => entry.default);
    if (defaults.length > 1) throw new Error(`${provider} 只能有一个默认模型别名`);
    if (!defaults.length) own[0].default = true;
  }
  return entries;
}

/** 保留旧的校验入口；实际存储始终由 normalizeModelsConfig 规范化。 */
export function validateModels(models) {
  normalizeModelsConfig(models);
}

/** 仅提取模型字段；配置中的密钥、地址、账号信息不会进入返回值。 */
export function modelCatalog(codeHome = process.env.CODEX_HOME ?? join(homedir(), '.codex'), options = {}) {
  const env = options.env ?? process.env, providers = options.providers ?? {};
  const claudeEnv = {...env, ...providers['claude-code']?.env};
  const codexEnv = {...env, ...providers.codex?.env};
  codeHome = codexEnv.CODEX_HOME || codeHome;
  const result = Object.fromEntries(Object.entries(EFFORTS).map(([key, efforts]) => [key, {models: [], efforts}]));
  const add = (provider, id, label = id, efforts = []) => {
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\x00-\x1f]/.test(id)) return;
    const models = result[provider].models, existing = models.find(m => m.id === id);
    if (existing) { if (efforts.length) existing.efforts = efforts; return; }
    if (models.length < 200) models.push({id, label: typeof label === 'string' ? label.slice(0, 200) : id, efforts});
  };
  const read = path => {
    try { if (statSync(path).size < 4 * 1024 * 1024) return readFileSync(path, 'utf8'); } catch { /* 不存在或不可读时保留其余候选。 */ }
    return null;
  };
  for (const provider of Object.keys(EFFORTS)) add(provider, providers[provider]?.model);
  // Codex 配置只提取根级及 profiles 下的单行 model 字符串，不读取任何服务凭据。
  const toml = read(join(codeHome, 'config.toml'));
  if (toml) {
    let section = '';
    for (const line of toml.split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) { section = line.trim(); continue; }
      if (section && !/^\[profiles\./.test(section)) continue;
      const match = line.match(/^\s*model\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/);
      if (match) { try { add('codex', match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1)); } catch {} }
    }
  }
  try {
    const cache = JSON.parse(read(join(codeHome, 'models_cache.json')) ?? '{}');
    for (const m of (Array.isArray(cache.models) ? cache.models : []).slice(0, 200)) {
      if (!m || m.visibility === 'hide') continue;
      add('codex', m.slug, m.display_name, (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : []).map(x => x?.effort).filter(x => EFFORTS.codex.includes(x)));
    }
  } catch { /* 损坏缓存不阻断配置模型。 */ }
  const claudeHome = claudeEnv.CLAUDE_CONFIG_DIR || options.claudeHome || join(homedir(), '.claude');
  let settings = {};
  try { settings = JSON.parse(read(join(claudeHome, 'settings.json')) ?? '{}') ?? {}; } catch {}
  add('claude-code', settings.model);
  // Claude 用户自定义选择器和模型映射也属于候选来源，不只扫描环境槽位。
  for (const row of Array.isArray(settings.modelPicker?.options) ? settings.modelPicker.options : []) add('claude-code', row?.model, row?.label);
  for (const id of Array.isArray(settings.availableModels) ? settings.availableModels : []) add('claude-code', id);
  for (const [id, mapped] of Object.entries(settings.modelOverrides ?? {})) {add('claude-code', id); add('claude-code', mapped);}
  const merged = {...settings.env, ...claudeEnv};
  // 自动识别所有 ANTHROPIC_*_MODEL / CLAUDE_CODE_*_MODEL 槽位（含 FABLE 等新槽位），不写死列表；
  // 同名槽位的 *_MODEL_NAME 只作为显示名。仅读取模型字段，令牌、地址等不会进入返回值。
  for (const [key, value] of Object.entries(merged)) {
    if (!/^(?:ANTHROPIC|CLAUDE_CODE)_(?:[A-Z0-9]+_)*MODEL$/.test(key)) continue;
    const name = typeof merged[`${key}_NAME`] === 'string' ? merged[`${key}_NAME`].trim() : '';
    add('claude-code', value, name && name !== value && name !== 'auto' ? `${value} · ${name}` : value);
  }
  // 默认展示用户配置的入口；原生别名、解析 ID 和辅助模型仍可在额外候选中找到。
  const explicit = Array.isArray(settings.availableModels) && settings.availableModels.length ? settings.availableModels
    : (Array.isArray(settings.modelPicker?.options) ? settings.modelPicker.options : []).map(row => row?.model).filter(Boolean);
  const preferred = new Set(explicit.length ? explicit : Object.entries(merged)
    .filter(([key]) => /^ANTHROPIC_DEFAULT_[A-Z0-9]+_MODEL$/.test(key)).map(([, value]) => value));
  for (const row of result['claude-code'].models) if (preferred.has(row.id)) row.preferred = true;
  return result;
}

/** 构造原生参数，不经 shell；不修改权限、目录或全局配置。 */
export function withReasoning(spec, provider, effort) {
  if (!effort) return spec;
  if (!EFFORTS[provider]?.includes(effort)) throw new Error('推理强度无效');
  if (provider === 'codex') {
    if (!Array.isArray(spec.argv) || !spec.argv.includes('app-server')) throw new Error('Codex 原生启动接口发生变化，拒绝静默忽略推理强度');
    return {...spec, argv: [...spec.argv, '-c', `model_reasoning_effort=${JSON.stringify(effort)}`]};
  }
  return {...spec, env: {...spec.env, CLAUDE_CODE_EFFORT_LEVEL: effort}};
}

/**
 * 针对 DSH 0.2.1 的官方后端构造一次性具名实例。
 * 官方插件继续拥有协议、SDK、权限及退出处理；这里仅覆写模型与原生 effort 参数。
 * config 是已核对的具体后端实现字段，升级后若不再提供会明确拒绝，不降级为提示词。
 */
export async function configuredProvider(ctx, provider, options, importImplementation) {
  const original = ctx.subagents.getProvider(provider);
  if (!original || !original.config || typeof original.start !== 'function') throw new Error('当前官方后端不支持本版本的模型参数适配，请保留原生默认或核对 DSH 版本');
  if (options.continuity) return createSessionProvider(ctx, provider, options);
  const config = original.config;
  const name = `orchestrator-${provider}-${randomUUID()}`;
  let implementation;
  if (importImplementation) implementation = await importImplementation(provider);
  else {
    const dir = ctx.get('profileContext')?.dir;
    const require = dir ? createRequire(join(dir, 'package.json')) : createRequire(import.meta.url);
    implementation = await import(pathToFileURL(require.resolve(`@deepseek-ai/dsh-subagent-${provider}`)).href);
  }
  let instance;
  const subprocess = ctx.subprocess;
  const diagnostics = [];
  implementation.apply({
    subagents: {registerProvider: value => {instance = value;}},
    subprocess: {spawn: spec => {
      let next = withReasoning(spec, provider, options.reasoningEffort);
      if (provider === 'claude-code') next = withClaudeTools(next, options);
      const child = subprocess.spawn(provider === 'codex' ? withCodexRuntime(next) : next);
      if (provider === 'codex') diagnostics.push(observeCodexErrors(child.stdout));
      return child;
    }},
    logger: ctx.logger,
  }, {...config, providerName: name,
    ...(provider === 'claude-code' && options.writeAccess ? {permissionMode: 'acceptEdits'} : {}),
    ...(options.model ? {model: options.model} : {}),
    env: {...config.env, ...(provider === 'claude-code' && options.reasoningEffort ? {CLAUDE_CODE_EFFORT_LEVEL: options.reasoningEffort} : {})},
  });
  if (!instance || instance.name !== name) throw new Error('官方后端未创建参数化实例');
  const dispose = ctx.subagents.registerProvider(instance);
  return {name, diagnostic: () => diagnostics.map(d => d.read()).find(Boolean), dispose: () => {
    try {return dispose();} finally {for (const diagnostic of diagnostics) diagnostic.dispose();}
  }};
}
