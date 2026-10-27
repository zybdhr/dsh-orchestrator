import {readdirSync, readFileSync, existsSync, lstatSync, mkdirSync, copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve, dirname} from 'node:path';
import {parseArgs} from 'node:util';

export const PUBLIC_ROOT_FILES = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'package.json', 'package-lock.json', 'cordis.patch.yml', '.gitignore', '.gitattributes', '.editorconfig'];
export const PUBLIC_TOOLS = ['install.mjs', 'start-dsh.mjs', 'restart-dsh.mjs', 'shared-runtime.mjs', 'share-project.mjs', 'package.json'];
export const PUBLIC_DOCS = ['SHARING.md', 'COMPATIBILITY.md'];

export function sharedFiles(root) {
  const result = [...PUBLIC_ROOT_FILES, ...PUBLIC_TOOLS.map(name => `.AAAtoool/${name}`), ...PUBLIC_DOCS.map(name => `.AAAdooc/${name}`)];
  const walk = relative => {
    for (const entry of readdirSync(join(root, relative), {withFileTypes: true})) {
      const path = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`共享源码禁止符号链接：${path}`);
      if (entry.isDirectory()) walk(path); else if (entry.isFile()) result.push(path);
    }
  };
  walk('src'); walk('tests');
  for (const path of result) if (!existsSync(join(root, path)) || !lstatSync(join(root, path)).isFile()) throw new Error(`共享文件缺失或类型异常：${path}`);
  return result.sort();
}

export function inspectSharedFiles(root, files) {
  const findings = [];
  const patterns = [
    ['本机用户名路径', /\/home\/[a-zA-Z0-9_-]+\//],
    ['macOS 用户路径', /\/Users\/[a-zA-Z0-9_-]+\//],
    ['密钥外形', /\b(?:sk-[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{24,})/],
    ['私钥内容', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['带登录凭据的地址', /[?&]token=[a-zA-Z0-9_-]{20,}/],
  ];
  for (const file of files) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    for (let index = 0; index < lines.length; index++) for (const [kind, pattern] of patterns) if (pattern.test(lines[index])) findings.push({file, line: index + 1, kind});
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options: {out: {type: 'string'}, check: {type: 'boolean'}, help: {type: 'boolean'}}});
  if (values.help) {console.log('node .AAAtoool/share-project.mjs [--check] [--out 新目录]'); process.exit(0);}
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = sharedFiles(root), findings = inspectSharedFiles(root, files);
  if (findings.length) {console.error(JSON.stringify({ok: false, findings})); process.exit(1);}
  if (values.check) {console.log(JSON.stringify({ok: true, files: files.length})); process.exit(0);}
  const output = resolve(values.out || join(root, 'work', 'shared-source-' + new Date().toISOString().replaceAll(':', '-')));
  if (existsSync(output)) throw new Error('目标目录已存在，拒绝覆盖；请选择新目录');
  if (!values.out) mkdirSync(join(root, 'work'), {recursive: true});
  mkdirSync(output, {recursive: false, mode: 0o700});
  for (const relative of files) {const target = join(output, relative); mkdirSync(dirname(target), {recursive: true}); copyFileSync(join(root, relative), target);}
  console.log(JSON.stringify({ok: true, output, files: files.length, note: '仅复制共享清单，不含本机日志、数据、截图、备份、依赖或 Git 历史'}));
}
