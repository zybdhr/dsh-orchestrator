import {spawn} from 'node:child_process';
import {openSync, closeSync, readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {resolveDshCommand, resolveProfile, localOrigin} from './shared-runtime.mjs';

// 无现存实例时后台启动；不安装包、不改配置、不恢复任务、不打印认证 URL。
// 参数：DSH node_modules 路径、DSH_HOME；可加 --open 打开本机浏览器认证入口。
const {values, positionals} = parseArgs({allowPositionals: true, options: {'dsh-bin': {type: 'string'}, home: {type: 'string'}, profile: {type: 'string', default: 'web'}, port: {type: 'string', default: '3080'}, host: {type: 'string', default: '127.0.0.1'}, open: {type: 'boolean'}, 'dry-run': {type: 'boolean'}, help: {type: 'boolean'}}});
if (values.help) {console.log('node .AAAtoool/start-dsh.mjs [--home 数据目录] [--profile web] [--port 3080] [--host 127.0.0.1] [--dsh-bin DSH入口] [--open] [--dry-run]'); process.exit(0);}
if (process.platform === 'win32') throw new Error('维护脚本未验证 Windows，请使用 DSH 原生启动命令');
if (positionals.length && positionals.length !== 2) throw new Error('旧接口需要 node_modules、DSH_HOME 两个位置参数');
const target = resolveProfile({home: values.home || positionals[1], profile: values.profile}), home = target.home;
const executable = resolveDshCommand({runtime: positionals[0], bin: values['dsh-bin']});
const origin = localOrigin(values.port, values.host), port = Number(values.port);
const args = [...executable.args, '--profile', target.profile, '--no-open', '--host', values.host, '--port', String(port)];
if (values['dry-run']) {console.log(JSON.stringify({command: executable.command, args, home, origin})); process.exit(0);}
if (!existsSync(join(target.directory, 'package.json'))) throw new Error('profile 不存在，请先使用 DSH 初始化');
const project = fileURLToPath(new URL('../', import.meta.url));
await new Promise((resolve, reject) => {
  const probe = createServer(); probe.once('error', () => reject(new Error('目标端口已被占用，拒绝启动重复服务')));
  probe.listen(port, values.host, () => probe.close(resolve));
});
const batch = join(project, '.AAAdooc', `startup-${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(batch, {recursive: true, mode: 0o700});
const logPath = join(batch, 'server.log'), reportPath = join(batch, 'report.json');
const fd = openSync(logPath, 'wx', 0o600);
const child = spawn(executable.command, args, {cwd: project,
  env: {...process.env, DSH_HOME: home}, detached: true, stdio: ['ignore', fd, fd]});
await new Promise((resolve, reject) => {child.once('spawn', resolve); child.once('error', reject);});
closeSync(fd); child.unref();
const report = {ok: false, launcherPid: child.pid, port, origin, logPath, reportPath, startedAt: new Date().toISOString()};
let startup;
for (let attempt = 0; attempt < 120; attempt++) {
  startup = readFileSync(logPath, 'utf8').match(/dsh web: (http:\/\/[^\s]+)/)?.[1];
  if (startup) {
    try {
      const url = new URL(startup);
      if (url.origin !== origin) throw new Error('启动地址与预期不一致');
      const login = await fetch(startup, {redirect: 'manual', signal: AbortSignal.timeout(1500)});
      const cookie = login.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
      if (cookie) {
        const state = await fetch(`${url.origin}/dsh-orchestrator/api/state`, {headers: {cookie}, signal: AbortSignal.timeout(1500)});
        if (state.status === 200) {
          const body = await state.json();
          report.ok = true; report.authenticatedStateStatus = 200;
          report.runningRuns = body.runs.filter(run => run.status === 'running').length;
          report.runCount = body.runs.length;
          report.pluginVersion = JSON.parse(readFileSync(join(target.directory, 'node_modules/dsh-local-orchestrator/package.json'))).version;
          break;
        }
      }
    } catch { /* 等待宿主认证和插件就绪，不输出可能含凭据的错误。 */ }
  }
  try {process.kill(child.pid, 0);} catch {break;}
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (report.ok && values.open) {
  const browser = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [startup], {detached: true, stdio: 'ignore'});
  browser.on('error', () => {}); browser.unref(); report.browserOpenRequested = true;
}
writeFileSync(reportPath, JSON.stringify(report, null, 2), {mode: 0o600});
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
