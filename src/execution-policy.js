export const DEFAULT_EXECUTION_POLICY = Object.freeze({
  codex: Object.freeze({sandbox: 'workspace-write', approval: 'never'}),
  claude: Object.freeze({readMode: 'dontAsk', writeMode: 'acceptEdits'}),
});

const SANDBOXES = new Set(['workspace-write', 'danger-full-access']);
const APPROVALS = new Set(['never', 'on-request']);
const READ_MODES = new Set(['dontAsk']);
const WRITE_MODES = new Set(['acceptEdits', 'default', 'bypassPermissions']);

export function normalizeExecutionPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('执行权限配置必须是对象');
  if (Object.keys(value).some(key => !['codex', 'claude'].includes(key))) throw new Error('未知的执行权限提供方');
  const codex = {...DEFAULT_EXECUTION_POLICY.codex, ...(value.codex ?? {})};
  const claude = {...DEFAULT_EXECUTION_POLICY.claude, ...(value.claude ?? {})};
  for (const [name, fields] of [['codex', ['sandbox', 'approval']], ['claude', ['readMode', 'writeMode']]]) {
    if (value[name] !== undefined && (!value[name] || typeof value[name] !== 'object' || Array.isArray(value[name]))) throw new Error(name + '权限配置必须是对象');
    if (value[name] && Object.keys(value[name]).some(key => !fields.includes(key))) throw new Error(name + '包含未知权限字段');
  }
  if (!SANDBOXES.has(codex.sandbox) || !APPROVALS.has(codex.approval)) throw new Error('Codex沙盒或审批策略无效');
  if (!READ_MODES.has(claude.readMode) || !WRITE_MODES.has(claude.writeMode)) throw new Error('Claude权限模式无效');
  return {codex, claude};
}

export function resolveExecutionPolicy(value, provider, access, resources = {}) {
  const policy = normalizeExecutionPolicy(value);
  if (!['read', 'write'].includes(access)) throw new Error('任务访问类型无效');
  if (resources && (typeof resources !== 'object' || Array.isArray(resources) || Object.keys(resources).some(key => key !== 'gpu') || (resources.gpu !== undefined && typeof resources.gpu !== 'boolean'))) throw new Error('任务资源配置无效');
  if (provider === 'codex') {
    const sandbox = access === 'read' ? 'read-only' : policy.codex.sandbox;
    if (resources?.gpu && sandbox !== 'danger-full-access') throw new Error('当前Codex沙盒可能无法访问GPU；请在设置中显式选择完全访问权限，并使用可写任务执行GPU操作');
    return {sandbox, approval: access === 'read' ? 'never' : policy.codex.approval};
  }
  if (provider === 'claude-code') {
    return {permissionMode: access === 'read' ? policy.claude.readMode : policy.claude.writeMode};
  }
  throw new Error('未知的执行后端');
}

export function codexApprovalPolicy(policy) {
  return {approvalPolicy: policy.approval, sandbox: policy.sandbox};
}
