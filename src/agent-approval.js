import {randomUUID} from 'node:crypto';

/** 使用DSH所属会话的选项服务，回答只对当前工具请求有效。 */
export async function askAgentApproval({ctx, parent, signal, provider, title, toolName, toolInput, onPermissionWait, timeoutMs = 270000}) {
  const questions = parent?.ctx?.get?.('userQuestions') ?? ctx?.get?.('userQuestions');
  if (!parent || typeof questions?.ask !== 'function') return false;
  const detail = JSON.stringify(toolInput ?? {}, null, 2);
  if (!detail || Buffer.byteLength(detail, 'utf8') > 12000 || /[\u202a-\u202e\u2066-\u2069]/u.test(detail)) return false;
  const requestId = 'orchestrator-permission-' + randomUUID();
  const choices = ['允许本次', '拒绝'];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('授权等待超时')), Math.min(Math.max(1000, timeoutMs), 270000));
  const onAbort = () => controller.abort(signal?.reason ?? new Error('调用已结束'));
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, {once: true});
  const fence = String.fromCharCode(96).repeat(Math.max(3, ...[...detail.matchAll(/`+/g)].map(match => match[0].length + 1)));
  onPermissionWait?.(true);
  try {
    const response = await Promise.race([
      questions.ask({agent: parent, signal: controller.signal, questions: [{id: requestId,
        header: '子代理授权请求', question: title + '：是否允许' + provider + '使用' + toolName + '？',
        detail: '请求参数：\n\n' + fence + 'json\n' + detail + '\n' + fence,
        options: choices.map(label => ({label})), multiSelect: false}]}),
      new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {once: true})),
    ]);
    const item = response?.answers?.length === 1 ? response.answers[0] : undefined;
    return item?.id === requestId && item.custom !== true && Array.isArray(item.selected) && item.selected.length === 1 && item.selected[0] === choices[0];
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    onPermissionWait?.(false);
  }
}
