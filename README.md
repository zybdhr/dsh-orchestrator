# DSH 多 Agent 编排

供朋友通过 Git 协作、本地安装的 DSH 插件。按任务依赖调度 Codex 和 Claude Code，提供独立审核、有限返工、原生会话复用以及可观看、可接管的 CLI 终端。

当前共享版为 **0.12.8**，DSH 适配版本为 **0.2.1-rc.2**。项目尚未选定开源许可证；不发布 npm，`private: true` 防止误发布。各人使用自己的账号和本机配置。

## 能做什么

- **任务编排**：校验依赖图，前置任务审核通过后再启动下游。
- **独立审核**：完成声明不等于验收通过；缺陷可有限返工，证据不足则暂停补验。
- **原生上下文**：按任务阶段保存 CLI 会话，执行和审核互不混用。
- **常驻终端**：在分支行点击“进入终端”弹窗观看，可接管输入、交还并继续。
- **直观界面**：调用记录使用向下延展的分支图，角色配置使用职责树。
- **多模型**：统一配置 Codex / Claude Code 模型、别名和推理强度；账号和权限沿用原生 CLI。
- **有限资源**：默认并发 2、最多 4 个活跃 PTY、整项默认 40 次调用、单次默认 10 分钟。

不修改 DSH 内核，不包含可共用的账号、API 密钥或登录 URL。

## 环境

建议 Node.js 24、npm、DSH 0.2.1-rc.2，以及分别安装并登录的 Codex / Claude Code CLI。DSH 的启动 PATH 应能找到 `codex` 和 `claude`，Shell 中的 `cc` 等别名不能代替底层可执行文件。

真实终端目前在 Linux 验证；macOS / Windows 尚未完成原生集成验收。CLI 和 DSH 的更高版本需要重新验证，不保证接口完全兼容。

详见 [适配范围](.AAAdooc/COMPATIBILITY.md)。

## 安装

克隆或下载源码后，在项目根目录执行：

```sh
npm ci --ignore-scripts
npm test
npm run check:share
npm pack --ignore-scripts
```

首次使用 DSH 时，先启动一次并正常退出，以完成自己的 web profile 初始化：

```sh
npx @deepseek-ai/dsh@0.2.1-rc.2 web --no-open
```

使用 DSH 原生插件入口安装生成的包，然后正常启动：

```sh
npx @deepseek-ai/dsh@0.2.1-rc.2 plugin --profile web add ./dsh-local-orchestrator-0.12.8.tgz --save-exact
npx @deepseek-ai/dsh@0.2.1-rc.2 web
```

也可在 Linux 等 POSIX 环境使用带备份的可选安装器：

```sh
node .AAAtoool/install.mjs --profile web
# 更新已有安装时：
node .AAAtoool/install.mjs --profile web --upgrade
```

安装器支持 `--home`、`--dsh-bin`、`--archive` 和 `--offline`；先加 `--dry-run` 可以只检查命令，不修改 profile。不要把开发目录整体复制进 DSH 安装目录。

DSH 登录入口以启动时实际打印的完整 URL 为准。内置浏览器与系统浏览器可能不共享 Cookie；看到 authentication required 时，重新在目标浏览器打开该次启动的登录 URL。不要将带 token 的地址提交到仓库。

## 使用

1. 安装后完整重启 DSH，新建会话，选择“多 Agent 编排”模式。
2. 在“设置 → 多 Agent 编排”添加自己的模型，选择推理强度，并配置各角色路由。
3. 在会话中给出目标、真实项目位置和验收条件。协调者通过编排工具委派执行与审核。
4. 在“高级AI记录”查看分支、调用正文、状态和失败原因；点击对应调用的“进入终端”打开弹窗。

职责树顶部是主协调 Agent，其模型在 DSH 会话底部选择；下方是规划与研究、执行任务、独立审核。连线表示委派关系，实际顺序由任务依赖决定。五个角色的默认模型可以分别选择，具体任务也可指定别名。

Claude 选择器优先展示用户配置的主模型入口；别名、解析后 ID 和辅助模型通过“其他候选”展开，搜索仍覆盖完整目录。候选清单不等于账号权限。

## 执行权限与审批

在“设置 → 多 Agent 编排 → 子代理执行权限与审批”分别配置 Codex 和 Claude Code。Codex 提供工作目录写入或完全访问权限，以及自动执行或按需审批；Claude Code 写任务支持 `acceptEdits`、`default` 与 `bypassPermissions`。读取与独立审核始终使用受限权限。

- 原生协议模式：Codex App Server 的命令、文件修改及额外资源请求，以及 Claude Agent SDK 的工具授权请求，均可通过 DSH 选项服务进行单次审批。没有可用审批服务、拒绝或者等待超时时，操作不会获得授权。
- 可见终端模式：Claude 继续使用原生 PermissionRequest Hook 转发授权；Codex 使用原生交互提示，需要用户在终端弹窗中接管处理。终端模式保持可观看和手动接管能力。
- 完全访问权限需由使用者明确选择。此权限会扩大文件系统和命令访问范围，应当配合专用操作系统用户或隔离的执行环境使用。
- GPU任务可以在任务定义中声明 `"resources":{"gpu":true}`。Codex在工作目录沙盒下拒绝执行此类任务，并提示配置完全访问权限。任务提示要求执行前检查NVIDIA设备与CUDA环境；GPU不可用时应报告错误。

权限配置保存在当前用户的编排设置中，不会修改Codex或Claude Code的全局设置。认证仍使用用户本机已经登录的CLI账号。

## 终端与恢复

默认只读观看，点击“接管并暂停编排”后才允许输入。交还可保持暂停，或明确继续编排；人工消息不会直接替代独立审核。关闭弹窗不会终止 CLI 或交还控制权。

同一任务阶段复用原生会话；自动终端空闲 30 分钟后回收，人工终端不被自动挤掉。中断后的写任务必须先核对已有修改再明确恢复；审核中断只重复审核。不会回滚已有文件修改和外部副作用。

原生 CLI 负责自动压缩；手动压缩需要接管。完成由 CLI 通知和调用标记确认，Claude 还需核对原生 session 空闲状态，不按屏幕静默判定。

第三方 Claude 网关会使用原生预先加载工具开关，避开部分网关不支持的动态工具消息，并关闭后台结构化标题请求。只影响本次子 CLI，保留思考和权限，不修改全局配置。

## 数据与权限

默认编排数据在当前用户 DSH 数据目录的 `orchestrator` 子目录。支持 `DSH_HOME`、插件 `dataDir`、`CODEX_HOME` 和 `CLAUDE_CONFIG_DIR`。正式插件不绑定维护者的用户名、账号、网关端口或项目路径。

任务记录和屏幕可能包含源码、业务数据及命令结果。不要共享本机运行目录、原始日志、安装备份、凭据或会话历史。只读任务约定不等于操作系统沙箱；未授权命令仍可能被拒绝，不能通过扩大权限来掩盖兼容问题。

当前声明式验证主要支持 uv / pytest 和 TypeScript，未覆盖所有技术栈。没有自动 Git worktree 合并或精确模型费用统计。

## 协作与打包共享

```sh
npm run check:share
npm run share
```

导出工具会创建一份仅含共享清单的干净源码目录，拒绝覆盖旧目录。Git 忽略规则同时排除本机产物；历史文件仍保留在原位置。

- [Git 共享说明](.AAAdooc/SHARING.md)
- [协作开发](CONTRIBUTING.md)
- [数据与故障报告](SECURITY.md)
- [兼容范围和限制](.AAAdooc/COMPATIBILITY.md)

本项目是独立的 DSH 插件，不代表 DSH、OpenAI 或 Anthropic 官方产品。
