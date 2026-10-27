# 协作开发

这是供朋友通过 Git 协作和本地安装的 DSH 插件，尚未选定开源许可证，未发布 npm。`package.json` 的 `private` 用于防止误发布，不影响本地打包安装。

## 开始

推荐 Node.js 24 和 npm。克隆仓库后执行：

```sh
npm ci --ignore-scripts
npm test
npm run check:share
```

单元测试不登录模型、不访问真实模型 API，不要求机器安装 Codex 或 Claude CLI。真实集成测试需要各自账号授权，不能以禁用工具的测试代替实际工具调用证据。

## 目录

- `src/`：正式插件、编排引擎、CLI 适配和浏览器界面。
- `tests/`：离线单元测试及接口测试。
- `.AAAtoool/`：仓库只保留可共享的安装、维护、导出工具。
- `.AAAdooc/SHARING.md`、`.AAAdooc/COMPATIBILITY.md`：共享和适配说明。
- `work/`、其他 `.AAAdooc/` 内容：本机产物，不提交。

根目录的 Git 忽略规则使用明确清单。新增正式文件或目录时，同时检查 `.gitignore` 和共享导出清单；不要使用 `git add -f` 将本机记录强行加入。

## 修改要求

保持执行、独立审核、有限重试和中断恢复的语义。修改不能把“CLI 返回了消息”当作“任务审核通过”。不自动重放中断的写任务，不通过放宽权限解决兼容问题。

真实 CLI/DSH 协议有变化时，核对接口和资源释放行为；不根据屏幕静默推断完成。新增兼容设置应限定到对应子进程，避免修改用户全局账号或 CLI 配置。

提交前运行相关测试、`npm run check:share`，检查 `git diff --cached`。不要提交 API 密钥、Cookie、带 token 的 URL、会话历史、终端屏幕或真实项目数据。
