import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function harness(state) {
  const hooks = new Map();
  const dispatched = [];
  let frame;
  const React = {Fragment: Symbol('fragment'), createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useState(initial) {
      const index = frame.index++, values = frame.values;
      if (!(index in values)) values[index] = initial === null ? state : initial;
      return [values[index], value => {values[index] = typeof value === 'function' ? value(values[index]) : value;}];
    }, useRef(initial) {const [ref] = React.useState({current: initial}); return ref;}, useEffect() {}};
  let descriptor;
  vm.runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {window: {__ModuleLoader__: {load: d => {descriptor = d;}}, dispatchEvent: event => dispatched.push(event)}, CustomEvent: class {constructor(type, init) {this.type = type; this.detail = init.detail;}}, console});
  assert.equal(descriptor.id, 'dsh-local-orchestrator');
  const plugin = descriptor.factory(name => {assert.equal(name, 'react'); return React;});
  const slots = [];
  plugin.apply({slots: {inject(_name, cb) {cb();}, register(options, component) {slots.push({options, component}); return () => {};}}});
  assert.deepEqual(slots.map(s => s.options.name), ['settings.section', 'conversation.view']);
  let tree;
  function resolve(node, path = 'root') {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, index) => resolve(child, `${path}/${child?.props?.key ?? index}`));
    if (typeof node.type === 'function') {
      if (!hooks.has(path)) hooks.set(path, []);
      frame = {index: 0, values: hooks.get(path)};
      return resolve(node.type(node.props), `${path}/component`);
    }
    return {...node, props: {...node.props, children: resolve(node.props.children, `${path}/children`)}};
  }
  function render(node) {tree = resolve(node); return content(tree);}
  function content(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(content).join('\n');
    return node.type === 'style' ? '' : content(node.props.children);
  }
  function collect(predicate, node, out = []) {
    if (arguments.length === 1) node = tree;
    if (node == null || typeof node !== 'object') return out;
    if (Array.isArray(node)) {node.forEach(child => collect(predicate, child, out)); return out;}
    if (predicate(node)) out.push(node);
    if (node.props?.children !== undefined) collect(predicate, node.props.children, out);
    return out;
  }
  function click(predicate) {
    const button = collect(node => node.type === 'button' && predicate(node))[0];
    assert(button, '找不到目标按钮'); button.props.onClick();
  }
  return {React, slots, render, collect, click, content, dispatched};
}

test('点击分支行显示进入终端入口，按本次调用定位；旧记录不伪造入口', () => {
  const state = {runs: [{id: 'run', owner: 'owner', goal: '终端定位', status: 'running',
    tasks: [{id: 'task', title: '实现功能', dependsOn: [], state: 'reviewing'}],
    calls: [
      {id: 'execute', taskId: 'task', title: '实现功能', provider: 'codex', phase: '执行', attempt: 1, status: 'completed', terminalId: 'execution-pty', startedAt: '2026-10-27T00:00:00Z', endedAt: '2026-10-27T00:00:01Z'},
      {id: 'review', taskId: 'task', title: '实现功能', provider: 'claude-code', phase: '审核', attempt: 1, status: 'running', terminalId: 'review-pty', startedAt: '2026-10-27T00:00:02Z'},
    ]}]};
  const f = harness(state), tab = f.slots.find(slot => slot.options.name === 'conversation.view');
  const page = f.React.createElement(tab.component, tab.options.inject('owner'));
  f.render(page);
  assert.equal(f.collect(node => node.props?.className === 'dsho-git-terminal').length, 0);
  for (const [callId, kind, terminalId] of [['execute', 'return', 'execution-pty'], ['review', 'work', 'review-pty']]) {
    f.click(node => node.props['data-call-id'] === callId && node.props['data-event-kind'] === kind);
    assert(f.render(page).includes('进入终端 ↗'));
    f.click(node => node.props.className === 'dsho-git-terminal');
    assert.equal(f.dispatched.at(-1).type, 'dsho-open-terminal');
    assert.equal(f.dispatched.at(-1).detail.id, terminalId); assert.equal(f.dispatched.at(-1).detail.owner, 'owner');
  }
  delete state.runs[0].calls[1].terminalId;
  assert(f.render(page).includes('未关联终端'));
  assert.equal(f.collect(node => node.props?.className === 'dsho-git-terminal')[0].props.disabled, true);
});

test('设置只含配置，任务会话的高级AI记录严格隔离', () => {
  const state = {config: {maxConcurrency: 2, maxExecutions: 40, taskTimeoutMs: 600000, routes: {plan: 'codex', implement: 'claude-code', test: 'codex', research: 'codex', review: 'codex'}, models: [{provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'high', alias: 'codex-gpt-6-luna', default: true}, {provider: 'codex', model: 'gpt-6-sol', reasoningEffort: 'low', alias: 'codex-gpt-6-sol'}, {provider: 'claude-code', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max', alias: 'claude-deepseek', default: true}]}, providers: ['codex', 'claude-code'], root: '/test/orchestrator', runs: [{
    id: 'test-run', owner: 'test-session', goal: '检查实际任务', cwd: '/test/project', status: 'completed', executions: 2,
    tasks: [{id: 'inspect', title: '检查目标文件', dependsOn: [], access: 'read', state: 'completed', attempts: 1, maxAttempts: 2, executedProvider: 'codex', reviewProvider: 'claude-code', acceptance: '独立核查', output: '具体执行证据', review: {approved: true, evidence: '审核证据', issues: []}}],
    calls: [{id: 'call-1', taskId: 'inspect', title: '检查目标文件', phase: '执行', provider: 'codex', attempt: 1, status: 'completed', startedAt: '2026-10-23T00:00:00Z', endedAt: '2026-10-23T00:00:01Z', input: '发送给 Codex 的实际任务正文', output: '后端真实返回摘要', childId: 'native-call-1'}],
    events: [{at: '2026-10-23T00:00:00Z', message: '审核已通过'}],
  }]};
  const {React, slots, render, click} = harness(state);
  const text = render(React.createElement(slots[0].component));
  assert(text.includes('刷新模型列表'));
  assert(text.includes('手动填写模型 ID'));
  assert(!text.includes('官方别名'));
  for (const expected of ['多 Agent 编排', '模型与推理强度', '统一模型列表', 'Codex', 'Claude Code', '+ 添加模型', '模型别名', '默认别名', 'codex-gpt-6-luna', 'codex-gpt-6-sol', 'claude-deepseek']) assert(text.includes(expected), expected);
  for (const hidden of ['高级AI记录', '后端真实返回摘要', '全部会话', '任务运行']) assert(!text.includes(hidden), hidden);
  const tab = slots.find(s => s.options.name === 'conversation.view');
  const page = React.createElement(tab.component, tab.options.inject('test-session'));
  const initialText = render(page);
  assert(initialText.includes('分支图'));
  assert(!initialText.includes('后端真实返回摘要'));
  click(node => node.props['data-task-id'] === 'inspect');
  const pageText = render(page);
  for (const value of ['发出', '返回', 'Codex', '后端真实返回摘要', 'native-call-1']) assert(pageText.includes(value), value);
  for (const hidden of ['模型与推理强度', '全部会话', '所属会话', '当前任务会话', '每秒自动更新', '执行后端', '调用状态', '任务 / 依赖', '共 1 条']) assert(!pageText.includes(hidden), hidden + ':' + pageText.slice(Math.max(0, pageText.indexOf(hidden) - 60), pageText.indexOf(hidden) + 100));
  assert(pageText.includes('发送给 Codex 的实际任务正文'));
  Object.assign(state.runs[0].calls[0], {nativeSessionId: 'native-thread-test', sessionResumed: true, contextEvents: [{type: 'compacted'}], sessionChangedReason: '压缩失败后交接'});
  const sessionText = render(React.createElement(tab.component, tab.options.inject('test-session')));
  assert(sessionText.includes('原生会话：native-thread-test · 恢复 · 已压缩'));
  assert(sessionText.includes('会话切换：压缩失败后交接'));
  assert(pageText.indexOf('\n发出\n') < pageText.indexOf('\n返回\n'));
  state.runs[0].calls[0].status = 'running'; delete state.runs[0].calls[0].endedAt;
  const runningText = render(React.createElement(tab.component, tab.options.inject('test-session')));
  assert(runningText.includes('等待返回')); assert(!runningText.includes('后端真实返回摘要'));
  const otherText = render(React.createElement(tab.component, tab.options.inject('other-session')));
  assert(!otherText.includes('后端真实返回摘要'));
});

test('分支图点选任务展示依赖、审核结论和旧调用兜底', () => {
  const state = {config: {maxConcurrency: 2, maxExecutions: 40, taskTimeoutMs: 600000, routes: {plan: 'codex', implement: 'claude-code', test: 'codex', research: 'codex', review: 'codex'}, models: [{provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'high', alias: 'codex-gpt-6-luna', default: true}, {provider: 'codex', model: 'gpt-6-sol', reasoningEffort: 'low', alias: 'codex-gpt-6-sol'}, {provider: 'claude-code', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max', alias: 'claude-deepseek', default: true}]}, providers: ['codex', 'claude-code'], root: '/test/orchestrator', runs: [{
    id: 'lane-run', owner: 'lane-session', goal: '验证泳道展示', cwd: '/test/project', status: 'running', createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:10:00Z',
    tasks: [
      {id: 'inspect', title: '侦察目标', dependsOn: [], access: 'read', state: 'completed', attempts: 1, maxAttempts: 2, executedProvider: 'codex', reviewProvider: 'claude-code', executionSelection: {provider: 'codex', alias: 'codex-recon', model: 'gpt-6-luna', reasoningEffort: 'high'}, reviewSelection: {provider: 'claude-code', alias: 'claude-review', model: 'deepseek', reasoningEffort: 'max'}},
      {id: 'implement', title: '实现改动', dependsOn: ['inspect'], access: 'write', state: 'failed', attempts: 2, maxAttempts: 2, executedProvider: 'claude-code', reviewProvider: 'codex', error: '审核未通过'},
    ],
    calls: [
      {id: 'lane-1', taskId: 'inspect', title: '侦察目标', phase: '执行', provider: 'codex', modelAlias: 'codex-recon', attempt: 1, status: 'completed', startedAt: '2026-10-24T00:00:01Z', endedAt: '2026-10-24T00:00:02Z', input: '侦察请求', output: '侦察结果'},
      {id: 'lane-2', taskId: 'inspect', title: '侦察目标', phase: '审核', provider: 'claude-code', modelAlias: 'claude-review', attempt: 1, status: 'completed', startedAt: '2026-10-24T00:00:03Z', endedAt: '2026-10-24T00:00:04Z', input: '审核请求', output: '{"approved":true}', reviewDisposition: 'pass'},
      {id: 'lane-3', taskId: 'implement', title: '实现改动', phase: '执行', provider: 'claude-code', attempt: 2, status: 'completed', startedAt: '2026-10-24T00:00:05Z', endedAt: '2026-10-24T00:00:06Z', input: '重试请求', output: '重试结果'},
      {id: 'lane-4', taskId: 'implement', title: '实现改动', phase: '审核', provider: 'codex', attempt: 2, status: 'completed', startedAt: '2026-10-24T00:00:07Z', endedAt: '2026-10-24T00:00:08Z', input: '复审请求', output: '{"approved":false}', reviewDisposition: 'defect'},
      {id: 'lane-old', taskId: 'legacy', title: '旧记录任务', phase: '执行', provider: 'codex', attempt: 1, status: 'completed', startedAt: '2026-10-24T00:00:09Z', endedAt: '2026-10-24T00:00:10Z', input: '旧请求', output: '旧结果'},
    ], events: [],
  }]};
  const {React, slots, render, click, collect} = harness(state);
  const tab = slots.find(s => s.options.name === 'conversation.view');
  const page = React.createElement(tab.component, tab.options.inject('lane-session'));
  const text = render(page);
  for (const expected of ['分支图', '时间顺序', '侦察目标', '实现改动', '旧记录任务',
    'codex-recon', 'claude-review', 'Claude Code', '审核通过', '缺陷返工']) assert(text.includes(expected), expected);
  assert(!text.includes('undefined'));
  assert(!text.includes('重试请求'));
  assert.equal(collect(node => node.props?.className?.includes('dsho-branch-edge')).length, 10);
  click(node => node.props['data-task-id'] === 'inspect');
  const inspectText = render(page);
  assert(inspectText.includes('下游：实现改动'));
  assert(inspectText.includes('侦察请求'));
  assert(!inspectText.includes('重试请求'));
  click(node => node.props['data-task-id'] === 'implement');
  const detailText = render(page);
  for (const expected of ['依赖：侦察目标', '失败 · 第 2/2 次', '重试请求', '缺陷返工']) assert(detailText.includes(expected), expected);
  click(node => node.props['aria-label'] === '收起节点详情');
  assert(!render(page).includes('重试请求'));
  click(node => node.props['data-task-id'] === 'legacy');
  assert(render(page).includes('旧结果'));
});

test('Git 形态分支从主干分出、返回回接，并行占独立列，返工继续向下', () => {
  const tasks = [{id: 'a', title: '实现任务', state: 'running', attempts: 2, maxAttempts: 2, dependsOn: []},
    {id: 'b', title: '并行检查', state: 'completed', attempts: 1, maxAttempts: 2, dependsOn: []},
    {id: 'waiting', title: '等待下游', state: 'pending', attempts: 0, maxAttempts: 2, dependsOn: ['a', 'b']}];
  const call = (id, taskId, start, end, status = 'completed') => ({id, taskId, title: tasks.find(task => task.id === taskId).title,
    provider: 'claude-code', phase: '执行', attempt: id === 'retry' ? 2 : 1, status,
    startedAt: `2026-10-26T09:00:${start}Z`, ...(end ? {endedAt: `2026-10-26T09:00:${end}Z`} : {}), input: id + '请求', output: id + '结果'});
  const state = {runs: [{id: 'fork-run', owner: 'fork-owner', goal: '分出与回接', status: 'running',
    coordinator: {provider: 'codex', model: 'coordinator-model'}, tasks,
    calls: [call('first', 'a', '00', '20', 'failed'), call('parallel', 'b', '05', '10'), call('retry', 'a', '30', null, 'running')]}]};
  const {React, slots, render, collect, click, content} = harness(state);
  const tab = slots.find(s => s.options.name === 'conversation.view');
  const page = React.createElement(tab.component, tab.options.inject('fork-owner'));
  const text = render(page);
  assert(text.includes('Codex · coordinator-model'));
  assert(text.includes('等待下游'));
  assert(text.includes('等待返回'));
  const edges = collect(node => node.type === 'path' && node.props['data-edge-kind']);
  assert.equal(edges.filter(edge => edge.props['data-edge-kind'] === 'fork').length, 3);
  assert.equal(edges.filter(edge => edge.props['data-edge-kind'] === 'merge').length, 2);
  assert.equal(edges.filter(edge => edge.props['data-edge-kind'] === 'open').length, 1);
  assert(!edges.some(edge => edge.props['data-call-id'] === 'retry' && edge.props['data-edge-kind'] === 'merge'), '未返回不能提前画回接');
  const circles = collect(node => node.type === 'circle');
  const point = id => circles.find(node => node.props['data-event-id'] === id).props;
  const mainX = point('run-start').cx;
  assert(point('first-work').cx > mainX);
  assert.notEqual(point('first-work').cx, point('parallel-work').cx, '重叠调用使用不同列');
  assert.equal(point('first-return').cx, mainX);
  assert.equal(point('parallel-return').cx, mainX);
  assert(point('retry-work').cy > point('first-return').cy, '返工在历史返回后继续向下');
  assert.equal(point('retry-work').cx, point('first-work').cx, '已回接的列可以复用');
  assert.equal(point('run-state').cx, mainX);
  click(node => node.props['data-call-id'] === 'retry');
  const retryText = render(page);
  assert(retryText.includes('retry请求'));
  assert(!retryText.includes('first请求'));
  assert(!retryText.includes('retry结果'), '未返回不能展示输出');
  click(node => node.props['aria-label'] === '收起节点详情');
  render(page);
  click(node => node.props['aria-label'] === '缩小分支图');
  assert(render(page).includes('85%'));
  click(node => content(node) === '时间顺序');
  assert(render(page).includes('first结果'));
  click(node => content(node) === '分支图');
  assert(render(page).includes('分出与回接'));
  assert(!render(React.createElement(tab.component, tab.options.inject('other-owner'))).includes('实现任务'));
});

test('没有调用时只展示协调主线和待执行任务，不伪造分支或身份', () => {
  const state = {runs: [{id: 'draft', owner: 'owner', goal: '等待开始', status: 'draft',
    tasks: [{id: 'a', title: '待执行任务', dependsOn: [], state: 'pending'}], calls: []}]};
  const {React, slots, render, collect, click, content} = harness(state);
  const tab = slots.find(s => s.options.name === 'conversation.view');
  const page = React.createElement(tab.component, tab.options.inject('owner'));
  const text = render(page);
  assert(text.includes('协调主线'));
  assert(text.includes('尚未调用'));
  assert(!text.includes('Codex'));
  assert.equal(collect(node => node.props?.['data-edge-kind']).length, 0);
  click(node => node.props['data-task-id'] === 'a');
  assert(render(page).includes('当前任务尚无调用记录'));
  click(node => content(node) === '时间顺序');
  assert(render(page).includes('当前运行尚无后端调用'));
});

test('需要处理展示实际任务错误，取消任务不混入故障原因', () => {
  const state = {runs: [{id: 'blocked', owner: 'owner', goal: '核查后端', status: 'blocked', tasks: [
    {id: 'failed', title: '探测 Codex', state: 'interrupted', error: '原生会话调用失败，已保留检查点', dependsOn: []},
    {id: 'cancelled', title: '已取消任务', state: 'cancelled', error: '已取消的旧错误', dependsOn: []},
  ], calls: []}]};
  const {React, slots, render} = harness(state);
  const tab = slots.find(s => s.options.name === 'conversation.view');
  const text = render(React.createElement(tab.component, tab.options.inject('owner')));
  assert(text.includes('需要处理的原因'));
  assert(text.includes('原生会话调用失败，已保留检查点'));
  assert(!text.includes('已取消的旧错误'));
  assert(text.includes('显式恢复'));
});

test('多模型添加、默认项切换和删除保留配置语义', () => {
  const state = {config: {models: [{provider: 'codex', model: 'first', alias: 'codex-first', default: true}], routes: {}, maxConcurrency: 2},
    providers: ['codex', 'claude-code'], runs: []};
  const {React, slots, render, collect, click, content} = harness(state);
  const page = React.createElement(slots[0].component);
  render(page);
  click(node => content(node) === '+ 添加模型');
  render(page);
  click(node => content(node) === '手动添加 Codex 模型');
  assert(render(page).includes('2 个模型'));
  assert.equal(collect(node => node.type === 'input' && node.props.placeholder === '沿用原生配置或填写模型 ID').length, 2);
  click(node => content(node) === '设为默认');
  render(page);
  const modelAliases = collect(node => node.type === 'input' && String(node.props.placeholder).startsWith('codex-'));
  assert.equal(modelAliases.length, 2);
  click(node => node.props['aria-label'] === '移除 codex-native');
  const text = render(page);
  assert(text.includes('1 个模型'));
  assert(text.includes('codex-first'));
  assert.equal(collect(node => node.type === 'button' && content(node) === '默认别名' && node.props.disabled).length, 1, '删除默认项后恢复剩余模型为默认');
});

test('统一列表通过左右双栏区分同名模型，选择时绑定正确后端', () => {
  const state = {config: {models: [{provider: 'codex', model: 'existing', alias: 'codex-existing', default: true}], routes: {}},
    providers: ['codex', 'claude-code'], runs: [], modelCatalog: {
      codex: {models: [{id: 'shared', label: '共享名称'}], efforts: ['high']},
      'claude-code': {models: [{id: 'shared', label: '共享名称'}], efforts: ['high']},
    }};
  const {React, slots, render, collect, click, content} = harness(state);
  const page = React.createElement(slots[0].component);
  render(page);
  assert.equal(collect(node => node.props?.className === 'dsho-card dsho-unified-models').length, 1);
  click(node => content(node) === '+ 添加模型');
  render(page);
  assert.deepEqual(collect(node => node.props?.role === 'listbox').map(node => node.props['aria-label']), ['Codex 模型候选', 'Claude Code 模型候选']);
  const claude = collect(node => node.props?.role === 'listbox' && node.props['aria-label'] === 'Claude Code 模型候选')[0];
  const option = collect(node => node.props?.role === 'option', claude)[0]; option.props.onClick();
  const text = render(page);
  assert(text.includes('claude-shared'));
  assert(text.includes('2 个模型'));
  assert.equal(collect(node => node.props?.role === 'dialog').length, 0);
  const inputs = collect(node => node.type === 'input' && node.props.placeholder === '沿用原生配置或填写模型 ID');
  assert.deepEqual(inputs.map(node => node.props.value), ['existing', 'shared']);
});

test('角色路由仅显示已配置模型，旧后端入口映射默认模型且失效选项不回填', () => {
  const state = {config: {models: [
    {provider: 'codex', model: 'first', alias: 'codex-first', default: true},
    {provider: 'claude-code', model: 'second', alias: 'claude-second', default: true},
  ], routes: {plan: 'claude-code', implement: 'codex', review: 'deleted-alias'}}, providers: ['codex', 'claude-code'], runs: []};
  const f = harness(state), page = f.React.createElement(f.slots[0].component);
  f.render(page);
  const plan = f.collect(node => node.type === 'select' && node.props['aria-label'] === '规划默认模型')[0];
  assert.equal(plan.props.value, 'claude-second');
  assert.deepEqual(f.collect(node => node.type === 'option', plan).map(node => node.props.value), ['codex-first', 'claude-second']);
  const implement = f.collect(node => node.type === 'select' && node.props['aria-label'] === '开发默认模型')[0];
  assert.equal(implement.props.value, 'codex-first');
  const review = f.collect(node => node.type === 'select' && node.props['aria-label'] === '审核默认模型')[0];
  assert.equal(review.props.value, '');
  assert(!f.collect(node => node.type === 'option', review).some(node => ['codex', 'claude-code', 'deleted-alias'].includes(node.props.value)));
});

test('Claude 默认只显示配置入口，额外别名可展开且搜索仍覆盖完整目录', () => {
  const state = {config: {models: [], routes: {}}, providers: ['codex', 'claude-code'], runs: [], modelCatalog: {
    codex: {models: []}, 'claude-code': {models: [
      ...['fable', 'haiku', 'opus', 'sonnet'].map(id => ({id: `configured-${id}`, label: id, preferred: true})),
      {id: 'native-alias', label: '额外原生别名'}, {id: 'resolved-model', label: '解析后 ID'},
    ]}}};
  const f = harness(state), page = f.React.createElement(f.slots[0].component);
  f.render(page); f.click(node => f.content(node) === '+ 添加模型'); f.render(page);
  const options = () => f.collect(node => node.props?.role === 'option').map(node => f.content(node));
  assert.equal(options().length, 4); assert(!options().some(text => text.includes('native-alias')));
  f.click(node => f.content(node) === '显示其他候选（2）'); f.render(page);
  assert.equal(options().length, 6);
  f.click(node => f.content(node) === '收起其他候选'); f.render(page);
  f.collect(node => node.props?.['aria-label'] === '搜索模型')[0].props.onChange({target: {value: 'resolved-model'}});
  f.render(page); assert.equal(options().length, 1); assert(options()[0].includes('resolved-model'));
});
