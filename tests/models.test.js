import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateModels, normalizeModelsConfig, defaultModelAlias, uniqueModelAlias, withReasoning, configuredProvider, modelCatalog} from '../src/native-models.js';

test('模型配置校验覆盖后端专属强度和非法内容', () => {
  validateModels({codex: {model: 'custom-model', reasoningEffort: 'xhigh'}, 'claude-code': {model: 'opus', reasoningEffort: 'max'}});
  assert.throws(() => validateModels({codex: {model: 'x', reasoningEffort: 'unknown'}}), /推理/);
  assert.throws(() => validateModels({'claude-code': {model: 'x', reasoningEffort: 'ultra'}}), /推理/);
  assert.throws(() => validateModels({codex: {model: 'x\nmalicious', reasoningEffort: ''}}), /模型/);
  assert.throws(() => validateModels({codex: {model: 'x', reasoningEffort: '', env: {}}}), /只能/);
});
test('多模型别名：旧配置迁移、默认别名生成、唯一性和默认项约束', () => {
  const migrated = normalizeModelsConfig({codex: {model: 'gpt-6-luna', reasoningEffort: 'high'}, 'claude-code': {model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max'}});
  assert.deepEqual(migrated.map(entry => [entry.provider, entry.alias, entry.default]), [
    ['codex', 'codex-gpt-6-luna', true], ['claude-code', 'claude-deepseek-v4.1-flash-1017', true]]);
  assert.equal(defaultModelAlias('codex', 'gpt-6-luna'), 'codex-gpt-6-luna');
  assert.equal(uniqueModelAlias('codex', 'gpt-6-luna', ['codex-gpt-6-luna']), 'codex-gpt-6-luna-2');
  const entries = normalizeModelsConfig([
    {provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'high'},
    {provider: 'codex', model: 'gpt-6-sol', reasoningEffort: 'low', alias: 'codex-sol'},
    {provider: 'claude-code', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max', alias: 'claude-deepseek', default: true},
  ]);
  assert.deepEqual(entries.map(entry => entry.alias), ['codex-gpt-6-luna', 'codex-sol', 'claude-deepseek']);
  assert.equal(entries[0].default, true);
  assert.throws(() => normalizeModelsConfig([
    {provider: 'codex', model: 'a', alias: 'same'}, {provider: 'codex', model: 'b', alias: 'same'},
  ]), /别名重复/);
  assert.throws(() => normalizeModelsConfig([
    {provider: 'codex', model: 'a', alias: 'codex-a', default: true}, {provider: 'codex', model: 'b', alias: 'codex-b', default: true},
  ]), /只能有一个默认/);
  assert.throws(() => normalizeModelsConfig([{provider: 'codex', model: 'a', alias: 'bad alias'}]), /别名/);
  assert.throws(() => normalizeModelsConfig([{provider: 'unknown', model: 'a', alias: 'x-a'}]), /不支持/);
});
test('Codex 使用配置参数，Claude 使用原生环境值；不修改原对象或权限', () => {
  const spec = {argv: ['node', 'codex.js', 'app-server', '--stdio'], cwd: '/project', env: {EXISTING: 'value'}, graceMs: 3000};
  const next = withReasoning(spec, 'codex', 'high');
  assert.deepEqual(next.argv.slice(-2), ['-c', 'model_reasoning_effort="high"']);
  assert.equal(spec.argv.length, 4); assert.equal(next.env, spec.env); assert.equal(next.cwd, spec.cwd);
  const claude = withReasoning(spec, 'claude-code', 'xhigh');
  assert.equal(claude.env.CLAUDE_CODE_EFFORT_LEVEL, 'xhigh'); assert.equal(spec.env.CLAUDE_CODE_EFFORT_LEVEL, undefined);
  assert.throws(() => withReasoning({argv: ['changed-command']}, 'codex', 'high'), /接口发生变化/);
});
test('参数化官方实例保留原生环境和权限，仅修改本次模型；生命周期可释放', async () => {
  const config = {providerName: 'codex', model: 'native-model', env: {PRIVATE_VALUE: 'must-not-be-persisted'}, permissionMode: 'never', disposeGraceMs: 3000};
  const original = {start() {}, config}; const registered = new Map([['codex', original]]); let disposed = false, supplied;
  const ctx = {subagents: {getProvider: p => registered.get(p), registerProvider: p => {registered.set(p.name, p); return () => {disposed = true; registered.delete(p.name);};}}, subprocess: {spawn: x => x}, logger: {warn() {}}};
  const result = await configuredProvider(ctx, 'codex', {model: 'selected-model', reasoningEffort: 'high'}, async () => ({apply(context, options) {
    supplied = options; context.subagents.registerProvider({name: options.providerName, start() {}});
  }}));
  assert.equal(supplied.model, 'selected-model'); assert.equal(supplied.permissionMode, 'never'); assert.equal(supplied.env.PRIVATE_VALUE, config.env.PRIVATE_VALUE);
  assert.equal(original.config.model, 'native-model'); assert.notEqual(result.name, 'codex'); result.dispose(); assert(disposed);
});
test('Claude 模型和 effort 进入官方配置，空模型保持原生选择', async () => {
  let supplied;
  const ctx = {subagents: {getProvider: () => ({start() {}, config: {model: 'original', env: {}, permissionMode: 'dontAsk', disposeGraceMs: 3000}}), registerProvider: () => () => {}}, subprocess: {spawn: x => x}, logger: {warn() {}}};
  const p = await configuredProvider(ctx, 'claude-code', {model: '', reasoningEffort: 'high'}, async () => ({apply(c, opts) {supplied = opts; c.subagents.registerProvider({name: opts.providerName});}}));
  assert.equal(supplied.model, 'original'); assert.equal(supplied.env.CLAUDE_CODE_EFFORT_LEVEL, 'high'); assert.equal(supplied.permissionMode, 'dontAsk'); p.dispose();
});
test('只返回模型元数据，不暴露缓存中的身份和凭据', t => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-catalog-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'models_cache.json'), JSON.stringify({identity: 'private-identity', models: [{slug: 'custom-model', display_name: 'Custom', supported_reasoning_levels: [{effort: 'high'}], secret: 'never-output'}]}));
  const catalog = modelCatalog(root); assert.equal(catalog.codex.models[0].id, 'custom-model');
  assert(!JSON.stringify(catalog).includes('private-identity')); assert(!JSON.stringify(catalog).includes('never-output'));
});
test('合并 DSH 国产模型、Claude 映射和 Codex 配置；覆盖同名映射并排除凭据', t => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-config-models-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const claudeHome = join(root, 'claude'); mkdirSync(claudeHome);
  writeFileSync(join(claudeHome, 'settings.json'), JSON.stringify({model: 'glm-local', apiKey: 'secret-key', env: {ANTHROPIC_DEFAULT_SONNET_MODEL: 'old-mapping', ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-local', ANTHROPIC_AUTH_TOKEN: 'secret-token', ANTHROPIC_BASE_URL: 'https://private-endpoint'}}));
  writeFileSync(join(root, 'config.toml'), 'model = "codex-local" # comment\n[model_providers.private]\nmodel = "not-a-profile"\n[profiles.work]\nmodel = \'codex-profile\'\n');
  writeFileSync(join(root, 'models_cache.json'), JSON.stringify({models: [{slug: 'codex-local', supported_reasoning_levels: [{effort: 'high'}]}, {slug: 'hidden', visibility: 'hide'}]}));
  const catalog = modelCatalog(root, {claudeHome, env: {}, providers: {'claude-code': {model: 'deepseek-local', env: {ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-new'}}, codex: {model: 'codex-local'}}});
  assert.deepEqual(catalog.codex.models.map(m => m.id), ['codex-local', 'codex-profile']);
  assert.deepEqual(catalog.codex.models[0].efforts, ['high']);
  assert.deepEqual(catalog['claude-code'].models.map(m => m.id), ['deepseek-local', 'glm-local', 'glm-new', 'kimi-local']);
  for (const unwanted of ['secret-key', 'secret-token', 'private-endpoint', 'old-mapping', 'sonnet', 'opus', 'haiku']) assert(!JSON.stringify(catalog).includes(unwanted));
});
test('本地目录覆盖生效；损坏配置不丢失 DSH 模型，不伪造官方候选', t => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-bad-models-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'settings.json'), '{broken'); writeFileSync(join(root, 'models_cache.json'), 'null');
  const catalog = modelCatalog('/not-used', {env: {}, providers: {codex: {env: {CODEX_HOME: root}}, 'claude-code': {model: 'deepseek', env: {CLAUDE_CONFIG_DIR: root}}}});
  assert.deepEqual(catalog['claude-code'].models.map(m => m.id), ['deepseek']);
  assert.deepEqual(catalog.codex.models, []);
});
test('Claude 模型自动识别所有 *_MODEL 槽位（含 FABLE），显示名取 *_MODEL_NAME，不泄露凭据', t => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-claude-slots-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'settings.json'), JSON.stringify({env: {
    ANTHROPIC_AUTH_TOKEN: 'secret-token', ANTHROPIC_BASE_URL: 'http://private',
    ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5[1M]', ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'auto',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5', ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: 'deepseek-v4.1-flash-1017',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5[1M]', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5',
    CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4.1-flash-1017', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'}}));
  const catalog = modelCatalog('/not-used', {claudeHome: root, env: {ANTHROPIC_SMALL_FAST_MODEL: 'small-fast'}});
  const ids = catalog['claude-code'].models.map(m => m.id);
  assert.deepEqual(ids, ['claude-fable-5[1M]', 'claude-haiku-5-5', 'claude-opus-5[1M]', 'claude-sonnet-5', 'deepseek-v4.1-flash-1017', 'small-fast']);
  assert.equal(catalog['claude-code'].models[1].label, 'claude-haiku-5-5 · deepseek-v4.1-flash-1017');
  assert.equal(catalog['claude-code'].models[0].label, 'claude-fable-5[1M]');
  assert.deepEqual(catalog['claude-code'].models.filter(model => model.preferred).map(model => model.id), ids.slice(0, 4));
  for (const unwanted of ['secret-token', 'private', 'auto']) assert(!JSON.stringify(catalog).includes(unwanted), unwanted);
});
test('默认别名不重复 CLI 前缀', () => {
  assert.equal(defaultModelAlias('claude-code', 'claude-opus-5[1M]'), 'claude-opus-5-1m');
  assert.equal(defaultModelAlias('claude-code', 'deepseek-v4.1-flash-1017'), 'claude-deepseek-v4.1-flash-1017');
  assert.equal(defaultModelAlias('codex', 'gpt-6-luna'), 'codex-gpt-6-luna');
  assert.equal(defaultModelAlias('codex', 'codex-mini'), 'codex-mini');
});

test('Claude 用户模型选择器、可选模型和覆盖映射均参与本地扫描', t => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-picker-models-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  writeFileSync(join(root, 'settings.json'), JSON.stringify({modelPicker: {options: [{model: 'custom-picker', label: '自定义候选', secret: 'never-output'}]},
    availableModels: ['allowlisted-model'], modelOverrides: {'wire-model': 'provider-model'}, apiKey: 'secret-key'}));
  const catalog = modelCatalog(root, {claudeHome: root, env: {}});
  assert.deepEqual(catalog['claude-code'].models.map(model => model.id), ['custom-picker', 'allowlisted-model', 'wire-model', 'provider-model']);
  assert(!JSON.stringify(catalog).includes('secret-key'));
  assert(!JSON.stringify(catalog).includes('never-output'));
});
