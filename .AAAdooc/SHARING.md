# 放进 Git 与朋友共享

## 已整理的范围

正式源代码、测试、锁定的开发依赖、README、协作说明以及可参数化的维护脚本可以共享。历史产物仍在原位置，Git 默认忽略；共享导出只复制明确清单，不会复制本机运行记录。

```sh
npm run check:share
npm run share
```

第二条命令在 `work/` 中创建新的干净源码目录；终端会输出实际完整路径。也可指定一个尚不存在的目标：

```sh
node .AAAtoool/share-project.mjs --out "$HOME/dsh-orchestrator-shared"
```

目标已存在时脚本拒绝覆盖，不删除旧产物。导出目录不包含原项目的 `.git`、依赖、截图、日志、安装备份、旧压缩包或凭据。

## 创建或连接仓库

原项目已可作为本地 Git 仓库使用。先核对待提交列表，再由维护者使用自己的 Git 身份提交，并添加自己的远端地址：

```sh
git status --short
git diff --cached
git add .
git commit -m "Prepare shared DSH orchestrator"
```

尚未添加远端或推送。不要把本机历史目录强行加入 Git。当前是朋友协作的共享项目，没有替维护者选定开源许可证，也没有发布到公共包注册表。

## 朋友使用

朋友克隆后按 README 安装自己的依赖、DSH、CLI 和插件。他们使用自己的 CLI 登录、模型路由、DSH 数据目录，不能复用维护者本机的登录 URL 或会话历史。

## 维护脚本

这些脚本是可选工具，常规使用优先直接调用 DSH CLI。先用 `--help` 或 `--dry-run` 查看行为：

```sh
node .AAAtoool/install.mjs --dry-run --profile web --home "$HOME/.dsh"
node .AAAtoool/start-dsh.mjs --dry-run --port 3080 --home "$HOME/.dsh"
node .AAAtoool/restart-dsh.mjs --help
```

安装器支持 `--dsh-bin` 或 `DSH_BIN` 指定已有 DSH 入口，否则使用 PATH 中的 DSH，再回退到固定已验证版本的 npx。安装默认联网，离线环境可加 `--offline`；升级需显式 `--upgrade`。启动器只接受回环地址，后台启动后将登录 URL 存在权限受限日志中，不打印 token。

重启脚本仅支持 Linux `/proc`，必须给出真实 DSH 主进程 PID 和两个尚未使用的绝对日志/报告路径。保持原启动参数，检测活动调用和子进程，不强制杀进程。配置了自定义编排 `dataDir` 时必须同时传入绝对 `--state-dir`。macOS/Windows 请手动正常退出、重新启动。
