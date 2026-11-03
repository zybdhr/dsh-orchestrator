/** 文件读取与状态检查不需要写权限；测试工具按任务声明追加。 */
export const CLAUDE_READ_TOOLS = Object.freeze([
  'Read', 'Glob', 'Grep', 'Bash(git status:*)', 'Bash(git diff:*)',
  'Bash(docker ps:*)', 'Bash(docker compose ps:*)', 'Bash(docker-compose ps:*)',
]);
export const CLAUDE_WRITE_TOOLS = Object.freeze([
  ...CLAUDE_READ_TOOLS, 'Edit', 'Write',
  'Bash(uv run pytest:*)', 'Bash(uv run python:*)', 'Bash(uv --version)',
  'Bash(npx tsc:*)', 'Bash(npx oxlint:*)',
]);
export const VERIFICATION_TOOLS = Object.freeze({
  pytest: ['Bash(uv run pytest:*)'],
  typescript: ['Bash(npx tsc:*)'],
});
export function withClaudeTools(spec, {writeAccess = false, verification = []} = {}) {
  const index = spec.argv?.indexOf('--permission-mode') ?? -1;
  if (index < 0 || (writeAccess && !['acceptEdits', 'default', 'bypassPermissions'].includes(spec.argv[index + 1]))) throw new Error('Claude Code 参数接口发生变化，拒绝忽略权限设置');
  if (spec.argv.includes('--allowedTools') || spec.argv.includes('--allowed-tools')) throw new Error('Claude Code 已设置工具许可，需要核对原生接口后合并');
  if (!Array.isArray(verification) || verification.some(v => !Object.hasOwn(VERIFICATION_TOOLS, v))) throw new Error('未知验证工具');
  const tools = [...new Set([...(writeAccess ? CLAUDE_WRITE_TOOLS : CLAUDE_READ_TOOLS), ...verification.flatMap(v => VERIFICATION_TOOLS[v])])];
  return {...spec, argv: [...spec.argv, '--allowedTools', tools.join(',')]};
}
export const withClaudeWriteTools = spec => withClaudeTools(spec, {writeAccess:true});
