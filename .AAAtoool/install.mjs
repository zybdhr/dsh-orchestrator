import {readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve, basename, dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
import {resolveDshCommand, resolveProfile} from './shared-runtime.mjs';

const {values, positionals} = parseArgs({allowPositionals: true, options: {
  'dsh-bin': {type: 'string'}, home: {type: 'string'}, profile: {type: 'string'}, archive: {type: 'string'},
  upgrade: {type: 'boolean'}, offline: {type: 'boolean'}, online: {type: 'boolean'}, 'dry-run': {type: 'boolean'}, help: {type: 'boolean'},
}});
if (values.help) {
  console.log('node .AAAtoool/install.mjs [--dsh-bin DSH入口] [--home 数据目录] [--profile web] [--archive 安装包] [--upgrade] [--offline] [--dry-run]');
  process.exit(0);
}
if (process.platform === 'win32') throw new Error('维护脚本尚未验证 Windows；请按 README 使用 DSH 原生安装命令');
if (positionals.length !== 0 && positionals.length !== 2) throw new Error('旧接口需要同时提供 node_modules 和 profile 目录；新接口使用命名参数');
const project = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
const legacy = positionals[1] ? resolve(positionals[1]) : null;
const target = resolveProfile({home: values.home || (legacy ? dirname(dirname(legacy)) : undefined), profile: values.profile || (legacy ? basename(legacy) : 'web')});
if (legacy && target.directory !== legacy) throw new Error('旧 profile 路径须为 DSH_HOME/profiles/PROFILE，或使用命名参数');
const executable = resolveDshCommand({runtime: positionals[0], bin: values['dsh-bin']});
const archive = resolve(values.archive || join(project, manifest.name + '-' + manifest.version + '.tgz'));
const args = [...executable.args, 'plugin', '--profile', target.profile, 'add', archive, '--save-exact', ...(values.offline ? ['--offline'] : [])];
if (values['dry-run']) {console.log(JSON.stringify({command: executable.command, args, home: target.home, profileDir: target.directory})); process.exit(0);}
if (!existsSync(archive)) throw new Error('安装包不存在；请先 npm pack --ignore-scripts');
const profilePath = join(target.directory, 'package.json');
if (!existsSync(profilePath)) throw new Error('profile 不存在；请先使用 DSH 初始化对应 profile');
const existing = JSON.parse(readFileSync(profilePath, 'utf8'));
if (existing.dependencies?.[manifest.name] && !values.upgrade) throw new Error('已经安装，更新需传入 --upgrade');
const backup = join(project, '.AAAdooc', 'install-backup-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(backup, {recursive: true, mode: 0o700});
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) if (existsSync(join(target.directory, file))) copyFileSync(join(target.directory, file), join(backup, file));
const result = spawnSync(executable.command, args, {cwd: project, env: {...process.env, DSH_HOME: target.home}, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576});
writeFileSync(join(backup, 'install.log'), (result.stdout ?? '') + (result.stderr ?? ''), {mode: 0o600});
if (result.status !== 0) throw new Error('安装失败，诊断保存在 ' + join(backup, 'install.log') + '；退出码 ' + (result.status ?? result.error?.code));
const after = JSON.parse(readFileSync(profilePath, 'utf8'));
if (!after.dependencies?.[manifest.name] || !after.dsh?.profile?.bundles?.includes(manifest.name)) throw new Error('插件 Bundle 登记不完整');
const installed = JSON.parse(readFileSync(join(target.directory, 'node_modules', manifest.name, 'package.json'), 'utf8'));
if (installed.version !== manifest.version) throw new Error('安装版本不一致');
console.log(JSON.stringify({ok: true, version: installed.version, profileDir: target.directory, archive, backup}));
