import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {resolveProfile, localOrigin, resolveDshCommand} from '../.AAAtoool/shared-runtime.mjs';
import {sharedFiles, inspectSharedFiles} from '../.AAAtoool/share-project.mjs';

test('共享工具采用指定数据目录、profile 和端口，不绑定本机', () => {
  const root = join(tmpdir(), 'friends data');
  assert.equal(resolveProfile({home: root, profile: 'friends'}).directory, join(root, 'profiles', 'friends'));
  assert.equal(resolveProfile({env: {DSH_HOME: root}}).home, root);
  assert.throws(() => resolveProfile({profile: '../invalid'}));
  assert.equal(localOrigin(4080), 'http://127.0.0.1:4080');
  assert.throws(() => localOrigin(0)); assert.throws(() => localOrigin(3080, '0.0.0.0'));
  assert.deepEqual(resolveDshCommand({env: {PATH: ''}}).args, ['--yes', '@deepseek-ai/dsh@0.2.1-rc.2']);
});

test('安装和启动 dry-run 不创建 profile、不启动服务', {skip: process.platform === 'win32'}, t => {
  const root = mkdtempSync(join(tmpdir(), 'share-dry-run-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const home = join(root, 'not-created');
  for (const file of ['install.mjs', 'start-dsh.mjs']) {
    const script = fileURLToPath(new URL(`../.AAAtoool/${file}`, import.meta.url));
    const output = JSON.parse(execFileSync(process.execPath, [script, '--dry-run', '--home', home, '--profile', 'friends'], {encoding: 'utf8', env: {...process.env, PATH: ''}}));
    assert.equal(output.home, home); assert(output.args.includes('friends')); assert.equal(existsSync(home), false);
  }
});

test('共享清单只包含可维护工程文件，排除历史产物与私有记录', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = sharedFiles(root);
  assert(files.includes('src/engine.js')); assert(files.includes('package-lock.json'));
  assert(!files.some(file => file.startsWith('work/') || file.endsWith('.tgz') || file.includes('install-backup')));
  assert(!files.includes('.AAAtoool/local-pty-context.mjs'));
  assert.deepEqual(inspectSharedFiles(root, files), []);
});

test('共享检查发现个人路径与常见凭据，只报告位置和类别', t => {
  const root = mkdtempSync(join(tmpdir(), 'share-scan-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const secret = 'sk-' + 'x'.repeat(32);
  writeFileSync(join(root, 'unsafe.txt'), '/' + 'home/' + 'example/private\n' + secret);
  const findings = inspectSharedFiles(root, ['unsafe.txt']);
  assert.equal(findings.length, 2); assert(!JSON.stringify(findings).includes(secret));
  assert.deepEqual(findings.map(row => row.line), [1, 2]);
});
