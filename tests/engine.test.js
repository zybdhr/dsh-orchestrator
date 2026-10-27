import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Orchestrator, validateGraph, parseReview, Store} from '../src/engine.js';
import {DshAdapter} from '../src/adapter.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const task = (id, extra = {}) => ({id, title: id, prompt: `执行 ${id}`, acceptance: '返回已核实的事实', dependsOn: [], ...extra});
const approval = {stopReason: 'completed', text: JSON.stringify({approved: true, evidence: '独立检查实际结果，满足验收条件', issues: []})};
test('状态轮询复用候选快照，显式刷新读取最新模型且保留用户选择', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-model-refresh-'));
  let reads = 0;
  const engine = new Orchestrator({root, adapter: {providers: () => ['codex', 'claude-code'], modelCatalog: () => ({codex: {models: [{id: `model-${++reads}`}], efforts: []}})}});
  t.after(async () => {await engine.close(); rmSync(root, {recursive: true, force: true});});
  engine.updateConfig({models: {codex: {model: 'manual-selection', reasoningEffort: 'high'}}});
  assert.equal(engine.modelCatalog().codex.models[0].id, 'model-1');
  assert.equal(engine.modelCatalog().codex.models[0].id, 'model-1');
  assert.equal(engine.refreshModels().codex.models[0].id, 'model-2');
  assert.equal(engine.modelCatalog().codex.models[0].id, 'model-2');
  const selected = engine.config.models.find(entry => entry.provider === 'codex' && entry.default);
  assert.equal(selected.model, 'manual-selection');
  assert.equal(selected.alias, 'codex-manual-selection');
});
function fixture(t, execute, config) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-orchestrator-test-'));
  const calls = [];
  const adapter = {providers: () => ['codex', 'claude-code', 'third'], execute: async args => {
    calls.push(args); args.onStarted?.(`child-${calls.length}`);
    return execute ? execute(args, calls) : args.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '实际执行结果'};
  }};
  const engine = new Orchestrator({root, adapter, config});
  t.after(async () => {await engine.close(); rmSync(root, {recursive: true, force: true});});
  const create = tasks => engine.create({owner: 'parent', goal: '测试目标', cwd: root, tasks});
  return {engine, root, calls, create, adapter};
}

test('原生授权等待暂停整个编排，不重试执行，也不触发下游', async t => {
  const {engine, create, calls} = fixture(t, async args => {
    const error = Object.assign(new Error('等待 Bash 执行授权，请进入终端'), {code: 'ORCHESTRATOR_APPROVAL_REQUIRED'});
    args.onAttention(error); throw error;
  });
  const run = create([task('a'), task('b', {dependsOn: ['a']})]);
  const state = await engine.run(run.id, 'parent', {});
  assert.equal(state.status, 'paused'); assert.equal(calls.length, 1);
  assert.equal(state.tasks[0].state, 'interrupted'); assert.match(state.tasks[0].error, /执行授权/);
  assert.equal(state.tasks[1].state, 'pending');
  assert.equal(state.calls[0].status, 'interrupted'); assert.equal(state.calls[0].failureCode, 'ORCHESTRATOR_APPROVAL_REQUIRED');
  assert(state.events.some(event => event.type === 'approval-required'));
});

test('DSH 选项等待不消耗执行时限，回答后在同次调用继续', async t => {
  let ready = Promise.withResolvers(), answer = Promise.withResolvers();
  const {engine, create, calls} = fixture(t, async args => {
    if (args.label.startsWith('执行')) {
      args.onPermissionWait(true); ready.resolve();
      await answer.promise; args.onPermissionWait(false); args.signal.throwIfAborted();
      return {stopReason: 'completed', text: '执行完成'};
    }
    return approval;
  }, {taskTimeoutMs: 1000});
  const run = create([task('a')]), pending = engine.run(run.id, 'parent', {});
  await ready.promise; await pause(1200);
  assert.equal(calls[0].signal.aborted, false);
  assert.equal(engine.snapshot(run.id, 'parent').calls[0].waitingForApproval, true);
  answer.resolve(); const state = await pending;
  assert.equal(state.status, 'completed'); assert.equal(state.calls.length, 2);
  assert.equal(state.calls[0].waitingForApproval, undefined);
});

test('拒绝循环、重复 id、缺失依赖和缺少验收条件', () => {
  assert.throws(() => validateGraph([task('a', {dependsOn: ['b']}), task('b', {dependsOn: ['a']})]), /循环/);
  assert.throws(() => validateGraph([task('a'), task('a')]), /重复/);
  assert.throws(() => validateGraph([task('a', {dependsOn: ['missing']})]), /不存在/);
  assert.throws(() => validateGraph([task('a', {acceptance: ''})]), /验收/);
});
test('审核必须有明确结论、证据且通过时没有未解决问题', () => {
  assert.equal(parseReview(approval.text).approved, true);
  assert.throws(() => parseReview('looks good'));
  assert.throws(() => parseReview('{"approved":true,"evidence":"","issues":[]}'), /证据/);
  assert.throws(() => parseReview('{"approved":true,"evidence":"已读","issues":["bug"]}'), /未解决/);
});
test('前置任务审核通过后才能执行下游；默认跨提供方审核', async t => {
  const {engine, create, calls} = fixture(t);
  const run = create([task('a'), task('b', {dependsOn: ['a']})]);
  const result = await engine.run(run.id, 'parent', {});
  assert.equal(result.status, 'completed'); assert.equal(result.executions, 4);
  assert.deepEqual(calls.map(c => [c.provider, c.label]), [['claude-code', '执行: a'], ['codex', '审核: a'], ['claude-code', '执行: b'], ['codex', '审核: b']]);
  assert.match(calls[2].prompt, /实际执行结果/);
  assert.equal(result.calls.length, 4);
  assert.equal(result.calls[0].input, calls[0].prompt.slice(0, 12000));
  assert.equal(result.calls[0].inputTruncated, calls[0].prompt.length > 12000);
  assert.deepEqual(result.calls.map(c => [c.provider, c.phase]), [['claude-code', '执行'], ['codex', '审核'], ['claude-code', '执行'], ['codex', '审核']]);
  assert(result.calls.every(c => c.status === 'completed' && c.startedAt && c.endedAt && c.childId && c.output));
  assert.equal(JSON.parse(readFileSync(engine.store.path(run.id))).calls.length, 4);
  assert.equal(JSON.parse(readFileSync(engine.store.path(run.id))).status, 'completed');
});
test('只读任务可并行，同时不超过并发上限', async t => {
  let live = 0, peak = 0;
  const {engine, create} = fixture(t, async a => {live++; peak = Math.max(peak, live); await pause(10); live--; return a.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '检查结果'};});
  const run = create([task('a', {access: 'read'}), task('b', {access: 'read'}), task('c', {access: 'read'})]);
  assert.equal((await engine.run(run.id, 'parent', {})).status, 'completed'); assert.equal(peak, 2);
});
test('共享工作区写入与其他任务互斥', async t => {
  let live = 0, peak = 0;
  const {engine, create} = fixture(t, async a => {live++; peak = Math.max(peak, live); await pause(3); live--; return a.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '完成'};});
  const run = create([task('a'), task('b'), task('c')]);
  await engine.run(run.id, 'parent', {}); assert.equal(peak, 1);
});
test('执行与审核可以是同一后端；缺失提供方在调度前拒绝', t => {
  const {create, calls} = fixture(t);
  assert.doesNotThrow(() => create([task('a', {provider: 'codex', reviewer: 'codex'})]));
  assert.throws(() => create([task('a', {provider: 'missing'})]), /未启用/);
  assert.equal(calls.length, 0);
});
test('审核拒绝后有限返工，达到上限阻塞下游', async t => {
  const {engine, create, calls} = fixture(t, async a => a.label.startsWith('审核') ? {stopReason: 'completed', text: '{"approved":false,"disposition":"defect","evidence":"测试未通过","issues":["功能缺失"]}'} : {stopReason: 'completed', text: '声称已完成'});
  const run = create([task('a'), task('b', {dependsOn: ['a']})]);
  const result = await engine.run(run.id, 'parent', {});
  assert.equal(result.status, 'blocked'); assert.equal(result.tasks[0].state, 'failed');
  assert.equal(result.tasks[1].state, 'pending'); assert.equal(calls.length, 4);
  assert(result.calls.every(c => c.status === 'completed'), '调用返回不等于任务通过审核');
});
test('执行失败可按配置切换提供方，不固定流水线', async t => {
  const {engine, create, calls} = fixture(t, async a => a.provider === 'claude-code' ? {stopReason: 'error', text: '', diagnostic: 'service'} : a.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '备用后端完成'});
  const run = create([task('a', {fallbackProviders: ['third'], reviewer: 'codex'})]);
  const result = await engine.run(run.id, 'parent', {});
  assert.equal(result.status, 'completed');
  assert.equal(result.calls[0].status, 'failed'); assert.match(result.calls[0].error, /service/);
  assert.equal(result.calls[1].status, 'completed');
  assert.deepEqual(calls.map(c => c.provider), ['claude-code', 'third', 'codex']);
});
test('审核格式错误时不重做写入；显式恢复仅重试审核', async t => {
  let failReview = true;
  const {engine, create, calls} = fixture(t, async a => a.label.startsWith('审核') ? failReview ? {stopReason: 'completed', text: 'looks fine'} : approval : {stopReason: 'completed', text: '已写文件'});
  const run = create([task('a')]);
  const first = await engine.run(run.id, 'parent', {});
  assert.equal(first.tasks[0].state, 'interrupted');
  await assert.rejects(engine.run(run.id, 'parent', {}), /retryInterrupted/);
  failReview = false;
  const result = await engine.run(run.id, 'parent', {}, {retryInterrupted: true});
  assert.equal(result.status, 'completed'); assert.equal(calls.filter(c => c.label.startsWith('执行')).length, 1);
});
test('暂停会取消正在执行的 Agent，恢复必须确认', async t => {
  let entered;
  const started = new Promise(resolve => {entered = resolve;});
  const {engine, create} = fixture(t, async a => {entered(); await new Promise((_, reject) => a.signal.addEventListener('abort', () => reject(a.signal.reason), {once: true}));});
  const run = create([task('a')]); const work = engine.run(run.id, 'parent', {}); await started;
  assert.equal(engine.snapshot(run.id).calls[0].status, 'running');
  engine.control(run.id, 'parent', 'pause');
  const result = await work;
  assert.equal(result.status, 'paused'); assert.equal(result.tasks[0].state, 'interrupted');
  assert.equal(result.calls[0].status, 'interrupted'); assert(result.calls[0].endedAt);
  await assert.rejects(engine.run(run.id, 'parent', {}), /retryInterrupted/);
});
test('取消不自动重新执行，不允许跨会话操作', async t => {
  const {engine, create} = fixture(t); const run = create([task('a')]);
  assert.throws(() => engine.snapshot(run.id, 'other'), /本会话/);
  assert.throws(() => engine.control(run.id, 'other', 'cancel'), /本会话/);
  engine.control(run.id, 'parent', 'cancel');
  await assert.rejects(engine.run(run.id, 'parent', {}), /已结束/);
});
test('启动失败和超时均保留调用记录，不伪造启动 ID 或完成结果', async t => {
  const {engine, create} = fixture(t, undefined, {taskTimeoutMs: 1000});
  engine.adapter.execute = async () => {throw new Error('native-start-failed');};
  const first = create([task('startup', {maxAttempts: 1})]);
  const failed = await engine.run(first.id, 'parent', {});
  assert.equal(failed.calls[0].status, 'failed'); assert.equal(failed.calls[0].childId, undefined); assert.match(failed.calls[0].error, /native-start-failed/);
  engine.adapter.execute = async args => {args.onStarted('timeout-child'); return new Promise((_, reject) => args.signal.addEventListener('abort', () => reject(args.signal.reason), {once: true}));};
  const second = create([task('timeout', {maxAttempts: 1})]);
  const timed = await engine.run(second.id, 'parent', {});
  assert.equal(timed.calls[0].status, 'timed_out'); assert.equal(timed.calls[0].childId, 'timeout-child'); assert(timed.calls[0].endedAt); assert.equal(timed.calls[0].output, undefined);
});
test('动态修订可追加/取消；依赖被取消时下游不能误执行', async t => {
  const {engine, create, calls} = fixture(t); const run = create([task('a')]);
  engine.revise(run.id, 'parent', {tasks: [task('a'), task('b', {dependsOn: ['a']})], cancelIds: ['a']});
  const result = await engine.run(run.id, 'parent', {});
  assert.equal(result.status, 'blocked'); assert.equal(calls.length, 0);
});
test('已完成任务不能随改图被篡改，已通过的节点不会重跑', async t => {
  const {engine, create, calls} = fixture(t); const run = create([task('a'), task('b', {dependsOn: ['a']})]);
  engine.adapter.execute = async a => {
    calls.push(a); if (a.label.includes('b')) return {stopReason: 'error', diagnostic: '模拟失败', text: ''};
    return a.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '结果'};
  };
  await engine.run(run.id, 'parent', {});
  assert.throws(() => engine.revise(run.id, 'parent', {tasks: [task('a', {prompt: '偷偷改变'}), task('b', {dependsOn: ['a']})]}), /已完成/);
  engine.revise(run.id, 'parent', {tasks: [task('a'), task('b', {dependsOn: ['a']})]});
  engine.adapter.execute = async a => {calls.push(a); return a.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '修复完成'};};
  assert.equal((await engine.run(run.id, 'parent', {})).status, 'completed');
  assert.equal(calls.filter(c => c.label === '执行: a').length, 1);
});
test('重启将活动节点变为中断，不自动重放，排他锁阻止双宿主', async t => {
  const {engine, create, root, adapter} = fixture(t); const run = create([task('a')]);
  assert.throws(() => new Store(root), /使用/);
  run.status = 'running'; run.tasks[0].state = 'running'; run.tasks[0].attempts = 1;
  run.calls = [{id: 'interrupted-call', provider: 'codex', phase: '执行', status: 'running', startedAt: new Date().toISOString()}]; engine.store.write(run);
  await engine.close();
  const second = new Orchestrator({root, adapter});
  assert.equal(second.snapshot(run.id).status, 'paused'); assert.equal(second.snapshot(run.id).tasks[0].state, 'interrupted');
  assert.equal(second.snapshot(run.id).calls[0].status, 'interrupted'); assert(second.snapshot(run.id).calls[0].endedAt);
  await assert.rejects(second.run(run.id, 'parent', {}), /retryInterrupted/); await second.close();
});
test('总调用预算阻止无限返工；配置会在重启后保留', async t => {
  const {engine, create, root, adapter, calls} = fixture(t, undefined, {maxExecutions: 2});
  const run = create([task('a'), task('b', {dependsOn: ['a']})]);
  assert.equal((await engine.run(run.id, 'parent', {})).status, 'blocked'); assert.equal(calls.length, 2);
  engine.updateConfig({maxConcurrency: 1, maxExecutions: 10}); await engine.close();
  const second = new Orchestrator({root, adapter}); assert.equal(second.config.maxConcurrency, 1); assert.equal(second.config.maxExecutions, 10); await second.close();
});
test('适配器使用 caller 结果、隔离上下文并在取消后释放句柄', async () => {
  let disposed = 0, spec;
  const adapter = new DshAdapter({subagents: {list: () => ['codex'], getProvider: () => ({inheritsParentContext: false}), startActivation: async s => {spec = s; return {childId: 'child', result: Promise.resolve({stopReason: 'completed', output: [{type: 'text', text: 'ok'}]}), dispose: async () => {disposed++;}};}}}, {configureProvider: async () => ({name: 'codex-test', dispose() {}})});
  const result = await adapter.execute({provider: 'codex', parent: {}, cwd: '/tmp', prompt: 'task', signal: new AbortController().signal, label: 'test'});
  assert.equal(result.text, 'ok'); assert.equal(spec.delivery, 'caller'); assert.equal(disposed, 1);
});
test('清理失败必须停止调度，不能泄漏后继续启动', async t => {
  const {engine, create, calls} = fixture(t, async () => {const e = new Error('cleanup failed'); e.code = 'ORCHESTRATOR_CLEANUP_FAILED'; throw e;});
  const run = create([task('a'), task('b')]); const result = await engine.run(run.id, 'parent', {});
  assert.equal(result.status, 'paused'); assert.equal(calls.length, 1);
});
test('模型参数按实际执行与审核后端分别传递，并持久化请求记录', async t => {
  const {engine, create, calls, root, adapter} = fixture(t);
  engine.updateConfig({models: {codex: {model: 'audit-model', reasoningEffort: 'high'}, 'claude-code': {model: 'implement-model', reasoningEffort: 'medium'}}});
  const run = create([task('a')]); const result = await engine.run(run.id, 'parent', {});
  assert.deepEqual(calls[0].modelOptions, {model: 'implement-model', reasoningEffort: 'medium'});
  assert.deepEqual(calls[1].modelOptions, {model: 'audit-model', reasoningEffort: 'high'});
  assert.equal(result.calls[0].modelAlias, 'claude-implement-model'); assert.equal(result.calls[1].modelAlias, 'codex-audit-model');
  assert.equal(result.tasks[0].executionSelection.model, 'implement-model'); assert.equal(result.tasks[0].executionSelection.alias, 'claude-implement-model');
  assert.equal(result.tasks[0].reviewSelection.reasoningEffort, 'high'); assert.equal(result.tasks[0].reviewSelection.alias, 'codex-audit-model');
  await engine.close(); const second = new Orchestrator({root, adapter});
  assert.equal(second.config.models.find(entry => entry.provider === 'codex').model, 'audit-model'); await second.close();
});


test('模型与角色路由同时保存时使用新别名列表校验', async t => {
  const {engine} = fixture(t);
  const saved = engine.updateConfig({models: [
    {provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'high', alias: 'codex-gpt-6-luna', default: true},
    {provider: 'claude-code', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max', alias: 'claude-deepseek', default: true},
  ], routes: {plan: 'codex-gpt-6-luna', implement: 'claude-deepseek', test: 'codex-gpt-6-luna', research: 'codex-gpt-6-luna', review: 'claude-deepseek'}});
  assert.equal(saved.routes.plan, 'codex-gpt-6-luna');
  assert.throws(() => engine.updateConfig({models: [
    {provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'high', alias: 'codex-gpt-6-luna', default: true},
  ]}), /未启用或不存在/);
});
test('编排任务用模型别名选择真实后端与模型，同后端别名仍不能互相审核', async t => {
  const config = {models: [
    {provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'high', alias: 'codex-gpt-6-luna', default: true},
    {provider: 'codex', model: 'gpt-6-sol', reasoningEffort: 'low', alias: 'codex-gpt-6-sol'},
    {provider: 'claude-code', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max', alias: 'claude-deepseek', default: true},
  ]};
  const {engine, create, calls} = fixture(t, undefined, config);
  assert.deepEqual(engine.defaultAliases(), {codex: 'codex-gpt-6-luna', 'claude-code': 'claude-deepseek'});
  assert.equal(engine.modelAliases().length, 3);
  const run = create([task('a', {provider: 'codex-gpt-6-sol', reviewer: 'claude-deepseek'})]);
  const result = await engine.run(run.id, 'parent', {});
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls.map(call => [call.provider, call.modelOptions]), [
    ['codex', {model: 'gpt-6-sol', reasoningEffort: 'low'}],
    ['claude-code', {model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max'}],
  ]);
  assert.deepEqual(result.calls.map(call => call.modelAlias), ['codex-gpt-6-sol', 'claude-deepseek']);
  assert.doesNotThrow(() => create([task('b', {provider: 'codex-gpt-6-luna', reviewer: 'codex-gpt-6-sol'})]));
  assert.doesNotThrow(() => create([task('b2', {provider: 'claude-deepseek', reviewer: 'claude-deepseek'})]));
  assert.throws(() => create([task('c', {provider: 'missing-alias'})]), /未启用/);
});
test('补验阻塞不重放写任务，增加验证权限后仅恢复审核', async t => {
  let blocked=true;
  const {engine,create,calls}=fixture(t,async a=>a.label.startsWith('审核') ? blocked ? {stopReason:'completed',text:JSON.stringify({approved:false,disposition:'blocked',evidence:'测试工具被权限拒绝',issues:['待运行类型检查']})} : approval : {stopReason:'completed',text:'已完成修改，请补验'});
  const run=create([task('a'),task('b',{dependsOn:['a']})]);
  let state=await engine.run(run.id,'parent',{});
  assert.equal(state.tasks[0].state,'interrupted');assert.equal(state.tasks[0].attempts,1);assert.equal(calls.length,2);
  assert.equal(state.calls[1].reviewDisposition,'blocked');
  const updated=state.tasks.map(x=>({...x,...(x.id==='a'?{verification:['typescript']}:{})}));
  engine.revise(run.id,'parent',{tasks:updated});
  assert.equal(engine.snapshot(run.id).tasks[0].output,'已完成修改，请补验');
  blocked=false;state=await engine.run(run.id,'parent',{}, {retryInterrupted:true});
  assert.equal(state.status,'completed');assert.equal(calls.filter(c=>c.label==='执行: a').length,1);
  const reviews=calls.filter(c=>c.label==='审核: a');assert.deepEqual(reviews[1].verification,['typescript']);assert.equal(reviews[1].access,'read');
});

test('旧格式拒绝审核默认待补验，不能以证据不足重复执行', async t=>{
  const {engine,create,calls}=fixture(t,async a=>a.label.startsWith('审核')?{stopReason:'completed',text:JSON.stringify({approved:false,evidence:'缺少历史基线',issues:[]})}:{stopReason:'completed',text:'已有副作用'});
  const run=create([task('a')]);const result=await engine.run(run.id,'parent',{});
  assert.equal(result.tasks[0].interruptedPhase,'reviewing');assert.equal(calls.length,2);
  assert.throws(()=>parseReview(JSON.stringify({approved:true,disposition:'blocked',evidence:'证据',issues:[]})),/不一致/);
  assert.throws(()=>parseReview(JSON.stringify({approved:false,disposition:'defect',evidence:'证据',issues:[]})),/具体问题/);
  assert.throws(()=>validateGraph([task('b',{verification:['shell']})]),/verification/);
});

test('声明测试副作用的只读任务也使用互斥调度',async t=>{
  let live=0,peak=0;
  const {engine,create}=fixture(t,async a=>{live++;peak=Math.max(peak,live);await pause(5);live--;return a.label.startsWith('审核')?approval:{stopReason:'completed',text:'验证完成'};});
  const run=create([task('a',{access:'read',verification:['typescript']}),task('b',{access:'read'})]);
  assert.equal((await engine.run(run.id,'parent',{})).status,'completed');assert.equal(peak,1);
});

test('补验检查点跨重启保留执行结果，恢复仍只运行审核',async t=>{
  const {engine,create,root,adapter,calls}=fixture(t,async a=>a.label.startsWith('审核')?{stopReason:'completed',text:JSON.stringify({approved:false,disposition:'blocked',evidence:'环境尚未准备好',issues:['等待测试环境']})}:{stopReason:'completed',text:'不可重复的执行结果'});
  const run=create([task('a')]);await engine.run(run.id,'parent',{});await engine.close();
  adapter.execute=async a=>{calls.push(a);return approval;};
  const restored=new Orchestrator({root,adapter});
  try{
    const result=await restored.run(run.id,'parent',{}, {retryInterrupted:true});
    assert.equal(result.status,'completed');assert.equal(result.tasks[0].output,'不可重复的执行结果');
    assert.equal(calls.filter(c=>c.label==='执行: a').length,1);
  }finally{await restored.close();}
});

test('返工复用执行和审核的各自会话，其他任务不共享会话', async t => {
  let reviewCount = 0;
  const {engine, create, calls} = fixture(t, async a => {
    const c = a.continuity;
    c.onSession(c.previous ?? {id: `native-${calls.length}`, provider: a.provider, binding: c.binding});
    if (a.label.startsWith('审核') && ++reviewCount === 1) return {stopReason: 'completed', text: JSON.stringify({approved: false, disposition: 'defect', evidence: '定位到缺陷', issues: ['修复错误']})};
    return a.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '实际修改位置和测试证据'};
  });
  const run = create([task('a'), task('b', {dependsOn: ['a']})]);
  const state = await engine.run(run.id, 'parent', {});
  assert.equal(state.status, 'completed');
  assert.equal(calls[2].continuity.previous.id, 'native-1');
  assert.equal(calls[3].continuity.previous.id, 'native-2');
  assert.equal(calls[4].continuity.previous, undefined);
  assert.notEqual(state.tasks[0].sessions.execution.id, state.tasks[0].sessions.review.id);
  assert(state.calls[2].sessionResumed); assert.match(calls[2].prompt, /实际修改位置和测试证据/);
});

test('会话身份跨宿主重启保存，补验仅恢复审核会话', async t => {
  const {engine, create, root, adapter, calls} = fixture(t, async a => {
    a.continuity.onSession({id: `persisted-${calls.length}`, provider: a.provider, binding: a.continuity.binding});
    return a.label.startsWith('审核') ? {stopReason: 'completed', text: JSON.stringify({approved: false, disposition: 'blocked', evidence: '等待环境', issues: ['补验']})} : {stopReason: 'completed', text: '已写入'};
  });
  const run = create([task('a')]); await engine.run(run.id, 'parent', {}); await engine.close();
  adapter.execute = async a => {calls.push(a); assert.equal(a.continuity.previous.id, 'persisted-2'); return approval;};
  const restored = new Orchestrator({root, adapter});
  try {assert.equal((await restored.run(run.id, 'parent', {}, {retryInterrupted: true})).status, 'completed');}
  finally {await restored.close();}
  assert.equal(calls.filter(c => c.label.startsWith('执行')).length, 1);
});

test('上下文超限不自动重放；显式恢复先单独计预算压缩，再继续原会话', async t => {
  let overflow = true;
  const {engine, create, calls} = fixture(t, async a => {
    const c = a.continuity;
    c.onSession({...c.previous, id: 'execution-native', provider: a.provider, binding: c.binding,
      ...(overflow ? {recovery: 'compact'} : {recovery: undefined})});
    if (overflow) {overflow = false; throw Object.assign(new Error('上下文超限'), {code: 'ORCHESTRATOR_CONTEXT_LIMIT'});}
    return a.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '完成'};
  });
  const run = create([task('a')]);
  let state = await engine.run(run.id, 'parent', {});
  assert.equal(calls.length, 1); assert.equal(state.tasks[0].state, 'interrupted');
  await assert.rejects(engine.run(run.id, 'parent', {}), /retryInterrupted/);
  state = await engine.run(run.id, 'parent', {}, {retryInterrupted: true});
  assert.equal(state.status, 'completed'); assert.equal(state.executions, 4);
  assert.equal(calls[1].continuity.operation, 'compact'); assert.equal(calls[2].continuity.previous.id, 'execution-native');
  assert.equal(state.calls[1].operation, 'compact');
});

test('压缩失败后明确切换新会话并携带交接事实，不删除旧调用身份', async t => {
  let first = true;
  const {engine, create, calls} = fixture(t, async a => {
    const c = a.continuity;
    if (first) {first = false; c.onSession({id: 'old-native', provider: a.provider, binding: c.binding, recovery: 'compact'}); throw Object.assign(new Error('overflow'), {code: 'ORCHESTRATOR_CONTEXT_LIMIT'});}
    if (c.operation === 'compact') throw Object.assign(new Error('无法压缩'), {code: 'ORCHESTRATOR_SESSION_BLOCKED'});
    assert.equal(c.previous, undefined);
    return a.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '完成'};
  });
  const run = create([task('a')]); await engine.run(run.id, 'parent', {});
  const state = await engine.run(run.id, 'parent', {}, {retryInterrupted: true});
  assert.equal(state.status, 'completed'); assert(state.events.some(e => e.type === 'session-rollover'));
  assert.equal(state.calls[0].nativeSessionId, 'old-native'); assert.match(calls[2].prompt, /持久化交接事实/);
});

test('预算不足时不启动压缩或业务调用，恢复失败不静默重试', async t => {
  const {engine, create, calls} = fixture(t, async a => {
    a.continuity.onSession({id: 'native', provider: a.provider, binding: a.continuity.binding, recovery: 'compact'});
    throw Object.assign(new Error('overflow'), {code: 'ORCHESTRATOR_CONTEXT_LIMIT'});
  }, {maxExecutions: 2});
  const run = create([task('a')]); await engine.run(run.id, 'parent', {});
  const state = await engine.run(run.id, 'parent', {}, {retryInterrupted: true});
  assert.equal(calls.length, 1); assert.equal(state.status, 'blocked');
});

test('显式重置待审核会话保留执行结果；任务定义变化清除旧会话', async t => {
  let blocked = true;
  const {engine, create, calls} = fixture(t, async a => {
    a.continuity.onSession({id: `native-${calls.length}`, provider: a.provider, binding: a.continuity.binding});
    return a.label.startsWith('审核') ? blocked ? {stopReason: 'completed', text: JSON.stringify({approved: false, disposition: 'blocked', evidence: '等待补验', issues: ['环境']})} : approval : {stopReason: 'completed', text: '执行事实'};
  });
  const run = create([task('a')]); await engine.run(run.id, 'parent', {});
  const reset = engine.revise(run.id, 'parent', {resetSessionIds: ['a']});
  assert.equal(reset.tasks[0].output, '执行事实'); assert.deepEqual(reset.tasks[0].sessions, {});
  blocked = false; assert.equal((await engine.run(run.id, 'parent', {}, {retryInterrupted: true})).status, 'completed');
  assert.equal(calls[2].continuity.previous, undefined); assert.equal(calls.filter(c => c.label.startsWith('执行')).length, 1);
  assert.throws(() => engine.revise(run.id, 'parent', {resetSessionIds: ['a']}), /已结束/);
  blocked = true;
  const second = create([task('b')]); await engine.run(second.id, 'parent', {});
  const revised = engine.revise(second.id, 'parent', {tasks: [task('b', {prompt: '修订后的任务说明'})]});
  assert.equal(revised.tasks[0].sessions, undefined); assert.equal(revised.tasks[0].output, undefined);
});
test('只有一个后端可用时也能编排：执行与审核同一后端，并记录协调者模型', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-orchestrator-single-'));
  const calls = [];
  const adapter = {providers: () => ['claude-code'], execute: async args => {
    calls.push(args); args.onStarted?.(`child-${calls.length}`);
    return args.label.startsWith('审核') ? approval : {stopReason: 'completed', text: '实际执行结果'};
  }};
  const engine = new Orchestrator({root, adapter, config: {routes: {plan: 'claude-code', implement: 'claude-code', test: 'claude-code', research: 'claude-code', review: 'codex'}}});
  t.after(async () => {await engine.close(); rmSync(root, {recursive: true, force: true});});
  const run = engine.create({owner: 'parent', goal: '单后端', cwd: root, tasks: [task('a')], coordinator: {provider: 'deepseek', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'high', secret: 'x'}});
  assert.deepEqual(run.coordinator, {provider: 'deepseek', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'high'});
  const result = await engine.run(run.id, 'parent', {options: {provider: 'deepseek', model: 'deepseek-v4.1-pro', reasoningEffort: 'max'}});
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls.map(call => call.provider), ['claude-code', 'claude-code']);
  assert.equal(result.coordinator.model, 'deepseek-v4.1-pro');
});

test('原生模型刷新等待完成、合并手动模型并合并并发刷新请求', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-async-model-refresh-'));
  let reads = 0, resolveCatalog;
  const engine = new Orchestrator({root, adapter: {providers: () => ['codex', 'claude-code'], modelCatalog: () => ({codex: {models: [{id: 'cached'}], efforts: []}}),
    refreshModels: () => {reads++; return new Promise(resolve => {resolveCatalog = resolve;});}}});
  t.after(async () => {await engine.close(); rmSync(root, {recursive: true, force: true});});
  engine.updateConfig({models: {codex: {model: 'manual-model', reasoningEffort: 'high'}}});
  const first = engine.refreshModels(), second = engine.refreshModels();
  assert.equal(first, second); assert.equal(reads, 1);
  assert.equal(engine.modelCatalog().codex.models[0].id, 'cached');
  resolveCatalog({codex: {models: [{id: 'live'}], efforts: []}});
  const result = await first;
  assert.deepEqual(result.codex.models.map(model => model.id), ['live', 'manual-model']);
  assert.equal(engine.modelCatalog(), result);
  assert.equal(engine.config.models[0].model, 'manual-model');
});
