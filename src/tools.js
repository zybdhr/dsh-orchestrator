import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'local-orchestrator-tools';
export const inject = ['orchestrator', 'tools', 'systemPrompt'];
export const COORDINATOR_TOOLS = Object.freeze(['orchestrator_providers', 'orchestrator_create', 'orchestrator_run', 'orchestrator_status', 'orchestrator_revise', 'orchestrator_control', 'ask_user_question']);
// 显式按操作放行，不能用 browser_* 前缀或第三方的 READ_ONLY_TOOLS 豁免集合。
// 截图/图片读取可产生监控证据及附件缓存，但不允许改业务文件或网页数据。
export const MONITOR_TOOLS = Object.freeze(['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'working_directory',
  'dsh_browser_open', 'dsh_browser_snapshot', 'dsh_browser_a11y', 'dsh_browser_content', 'dsh_browser_scrape',
  'dsh_browser_screenshot', 'dsh_browser_get_value', 'dsh_browser_wait', 'dsh_browser_challenge',
  'dsh_browser_list_tabs', 'dsh_browser_switch_tab', 'dsh_browser_session', 'dsh_browser_history', 'dsh_browser_visited',
  'dsh_browser_scroll', 'dsh_browser_back', 'dsh_browser_forward', 'dsh_browser_refresh']);
export function coordinatorDenial(exec) {
  if (COORDINATOR_TOOLS.includes(exec.name)) return;
  if (MONITOR_TOOLS.includes(exec.name)) {
    if (exec.name === 'working_directory' && exec.arguments?.cd !== undefined) return '监控协调者只能查询工作目录，不能直接切换目录。';
    if (exec.name === 'dsh_browser_open') {
      try {
        const url = new URL(exec.arguments?.url);
        if (!['http:', 'https:'].includes(url.protocol)) return '监控浏览器只允许打开 HTTP/HTTPS 页面，不能执行脚本或读取本地 URL。';
      } catch {return '监控浏览器需要有效的 HTTP/HTTPS 页面 URL。';}
    }
    return;
  }
  return '此模式负责只读观察、监控和编排；文件修改、命令、网页业务交互及正式验收必须通过 orchestrator_create / orchestrator_run 委派给 codex 或 claude-code。普通点击、键盘、填表、下载、页面脚本、登录状态操作与重放不属于只读监控。';
}
export function enforceCoordinator(ctx) {
  // 必须挂在预设的 Agent 作用域；禁止以全局守卫影响其他模式及原生执行后端。
  // restrict 只能命名当时已注册的全局工具；后注册或同作用域工具仍由 guard 兜底。
  const allowed = [...COORDINATOR_TOOLS, ...MONITOR_TOOLS];
  const deny = ctx.tools.schemas().map(t => t.name).filter(name => !allowed.includes(name));
  if (deny.length) ctx.tools.restrict({deny});
  ctx.tools.guard(coordinatorDenial);
}
const str = (description, required = true) => ({type: 'string', description, ...(required ? {required: true} : {})});
const output = {schema: {type: 'string'}, render: (_args, value) => [{type: 'text', text: value}]};
const parse = text => { if (text.length > 600000) throw new Error('任务图过大'); return JSON.parse(text); };
// 主模型只接收摘要，完整记录仍保存在检查点和面板中。
function summary(s) {
  const {tasks, events, ...run} = s;
  return {...run, calls: (run.calls ?? []).map(({output, input, ...call}) => ({...call, ...(output ? {outputPreview: output.slice(0, 1200), outputTruncated: output.length > 1200 || call.outputTruncated} : {})})), tasks: tasks.map(({prompt, history, output, ...t}) => ({...t,
    ...(output ? {outputPreview: output.slice(0, 1200), outputTruncated: output.length > 1200} : {})})), events: events.slice(-12)};
}
export const GUIDANCE = `你是多 Agent 编排的监控协调者。你负责理解用户目标、只读观察、监控执行、制定任务图及解释结果；修改、命令、业务操作和正式验收必须通过编排引擎执行。
先调用 orchestrator_providers 检查可用后端和模型别名。根据任务性质选择模型别名，不要固定写死 Codex→Claude→Codex。默认实现优先用 claude 系列别名，分析/测试/研究优先用 codex 系列别名；每项任务都要经过审核，执行与审核可以是同一后端甚至同一别名，有多个可用别名时优先换一个别名审核。只有一个后端可用时照常编排，不要因此停下。
后端模型和推理强度来自编排设置页的 models 配置，由适配器传入原生后端；不要用提示词假装切换模型或推理强度。主协调模型由 DSH 自带选择器控制。
你可以直接使用 read/read_image/glob/grep 查看项目、日志和证据，用 web_search/web_fetch 查询公开资料，并用已经安装的 dsh_browser_* 观察工具监控网页。浏览器可打开 HTTP/HTTPS 页面、滚动、前后导航、刷新、切换标签、读取页面与截图；链接可用 dsh_browser_scrape 的 a@href 提取后再 open。截图 savePath 仅用于监控证据，遵守浏览器下载目录及不覆盖规则；图片可用 read_image 查看。不要因“编排模式”声称浏览器或所有读取都被禁用。
监控不授权业务写入。禁止直接修改源码/业务数据、运行 Shell/测试、点击按钮、键盘输入、填表/提交、下载、执行任意页面脚本、改 cookies、重放操作或解除浏览器限制；也不能借打开 URL 触发删除、保存、退出登录等业务动作。网页需要点击、登录、输入或其他交互时交给有对应能力的执行后端或请用户操作，不为“看页面”绕过限制。监控观察不能代替编排引擎内的审核。
DSH 的浏览器属于 DSH 会话，不会自动传给 Codex/Claude CLI；后端只能用自己配置的浏览器/MCP/工具。不能没有工具调用证据就声称后端已操控浏览器。不要通过团队、PTC、Workflow、MCP 或其他执行入口绕过编排引擎完成修改或命令。
收到项目任务后，可以先快速查看用户给出的页面、日志和文件定位范围；随后先用会话提供的目录建立一个小型侦察任务，委派执行 Agent 核对真实目录、AGENTS.md、现有代码、未提交改动和需求边界；立刻调用 orchestrator_run。观察明确后再拆分或追加后续任务，不要长期只看不调度，也不要在未检查代码时编写庞大实现计划。目录不明确才提问。
任务字段：id、title、prompt、acceptance、dependsOn（id 数组）、role（plan/implement/test/research/review）、access（read/write）；可选 verification（pytest/typescript 数组，明确允许独立审核运行对应验证）、resources（例如 {gpu:true}，要求GPU任务在可访问显卡的执行环境中运行）、provider、reviewer、fallbackProviders、maxAttempts（1–3）。provider、reviewer、fallbackProviders 可填后端 id 或设置页配置的模型别名；新编排必须优先使用 orchestrator_providers 返回的模型别名（例如 codex-gpt-6-luna），别名同时决定真实后端、模型和推理强度。不能凭空猜模型 ID 或别名；reviewer 可以与 provider 相同。
验收条件应围绕可独立复查的当前结果；涉及历史更新范围时，执行前记录必要基线和脱敏操作证据，不把缺少历史证据当作重复写操作的理由。审核 blocked 表示等待补验，不能自动重做实现；优先补齐验证条件或证据，再仅重试审核。禁止为通过审核偷偷降低用户明确的验收要求。\n没有文件副作用才可标 read；测试若生成缓存/构建结果也用 write。verification 声明允许对应测试产生必要缓存或专用测试资源副作用，运行前必须核对实际测试配置，不能写业务数据；声明验证的任务也按写入互斥调度。共享工作目录采用写入互斥，read 是调度约定而非安全沙箱。严禁以任务提示词扩大用户授权范围。
创建后调用 orchestrator_run，调度器负责依赖、并发、审核和有限返工。程序状态才是任务是否完成的依据，不能把执行者的 completed 当成验收通过。中断或失败时先读取 orchestrator_status；需要改图时 orchestrator_revise 可以追加任务、修改未完成任务、取消任务。不能改写已完成节点。禁止无限重试、绕过审核或把失败说成完成。
宿主重启/暂停后保留检查点。retry_interrupted=true 可能重新执行未完成任务且不会回滚已有副作用，先检查状态和已修改文件，得到用户对重跑的明确许可；若仅审核中断，恢复只重试审核。整项预算耗尽时向用户说明。
同一任务执行返工、审核补验分别复用各自的原生会话；不能把 DSH childId 当作原生会话 ID。任务、后端或模型变化会建立新会话。上下文超限会停在检查点，显式恢复后先做独立计预算的压缩；压缩失败才携带已持久化事实换新会话，不能声称完整保留历史。原生历史丢失等恢复错误不得自动重放写入；用户明确同意换新上下文后可用 orchestrator_revise 的 reset_session_ids_json 重置未完成任务的会话，待审核任务保留执行结果。\n模型与调度配置在设置的“多 Agent 编排”，每个模型有独立别名和默认别名；当前会话的“高级AI记录”标签保存本会话每次启动、执行、返回、失败或中断的证据。没有调用记录就不能声称后端已经工作。历史运行只能在所属原会话恢复。最后根据持久化的审核证据汇报实际成果。`;

export function apply(ctx) {
  enforceCoordinator(ctx);
  const engine = ctx.orchestrator;
  ctx.systemPrompt.section({name: 'local-orchestrator-guidance', order: 85, text: GUIDANCE});
  const owner = exec => { if (!exec.agent) throw new Error('需要所属会话的活动 Agent'); return String(exec.agent.id); };
  function register(name, description, parameters, execute, safe = false) {
    ctx.tools.register(defineTool({name, description, parameters, output, isConcurrencySafe: () => safe,
      ...(name === 'orchestrator_run' ? {timeoutMs: 3600000} : {}),
      async execute(args, exec) { return JSON.stringify(await execute(args, exec)); }}));
  }
  register('orchestrator_providers', '列出可用于调度的后端、模型别名、默认别名及资源上限。', {}, async () => ({providers: engine.providers(), models: engine.modelAliases(), defaultAliases: engine.defaultAliases(), config: engine.config}), true);
  register('orchestrator_create', '校验并持久化任务 DAG，创建后尚未执行。', {
    goal: str('总目标'), cwd: str('会话提供的项目绝对路径，项目内容由执行后端核对'), tasks_json: str('任务数组的 JSON 字符串，含明确验收条件和依赖'),
    max_concurrency: {type: 'integer', description: '可选并发，默认 2，不能超过配置上限'},
  }, async (a, e) => summary(engine.create({owner: owner(e), goal: a.goal, cwd: a.cwd, tasks: parse(a.tasks_json), maxConcurrency: a.max_concurrency, coordinator: e.agent?.options})));
  register('orchestrator_run', '执行或恢复任务图，等待完成/阻塞/暂停；外部取消会停止子执行并保存状态。中断重跑需要用户明确许可。', {
    run_id: str('运行 id'), retry_interrupted: {type: 'boolean', description: '仅当用户明确同意重新执行中断任务时设 true'},
  }, async (a, e) => summary(await engine.run(a.run_id, owner(e), e.agent, {signal: e.signal, retryInterrupted: a.retry_interrupted ?? false})));
  register('orchestrator_status', '读取本会话运行摘要。指定 task_id 获取某一任务的完整结果和审核证据。', {run_id: str('省略则列出本会话运行摘要', false), task_id: str('可选任务 id，需要同时指定 run_id', false)}, async (a, e) => {
    if (!a.run_id) return engine.list(owner(e)).map(summary);
    const s = engine.snapshot(a.run_id, owner(e));
    if (!a.task_id) return summary(s);
    const task = s.tasks.find(t => t.id === a.task_id); if (!task) throw new Error('任务不存在'); return task;
  }, true);
  register('orchestrator_revise', '暂停后动态修改任务图：追加任务、修订失败任务或取消节点。已完成节点不可变；取消上游不会自动取消下游。', {
    run_id: str('运行 id'), tasks_json: str('完整的新任务数组 JSON；保留已有节点，省略则只取消指定项', false), cancel_ids_json: str('要取消的任务 id 数组 JSON', false),
    reset_session_ids_json: str('可选任务 id 数组；原生历史丢失或无法恢复且用户同意换新会话时使用。保留待审核执行结果，不删除原生历史', false),
  }, async (a, e) => summary(engine.revise(a.run_id, owner(e), {tasks: a.tasks_json ? parse(a.tasks_json) : undefined, cancelIds: a.cancel_ids_json ? parse(a.cancel_ids_json) : [], resetSessionIds: a.reset_session_ids_json ? parse(a.reset_session_ids_json) : []})));
  register('orchestrator_control', '按用户要求暂停或取消运行，停止活动子 Agent 并保留执行证据。', {
    run_id: str('运行 id'), action: {type: 'string', required: true, enum: ['pause', 'cancel'], description: '控制动作'},
  }, async (a, e) => summary(engine.control(a.run_id, owner(e), a.action)));
}
