const PREFIX = '/dsh-orchestrator/api';
const send = (res, code, data) => { res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(data)); };

export async function jsonBody(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new Error('只接受 JSON 请求');
  let text = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new Error('请求过大'); text += chunk.toString('utf8'); }
  return JSON.parse(text);
}

/** 复用宿主的认证/Origin gate；宿主不提供 gate 时拒绝访问，不能静默放行。 */
export function mountRoutes(ctx, engine) {
  return ctx.webServer.register({kind: 'prefix', path: PREFIX, handler: async (req, res) => {
    const connection = ctx.get('connection');
    if (typeof connection?.requestRejection !== 'function') return send(res, 503, {error: 'DSH 认证服务尚未就绪'});
    try {
      const rejection = connection.requestRejection(req);
      if (rejection !== undefined) return send(res, rejection, {error: '需要 DSH 登录或请求来源不受信任'});
      const url = new URL(req.url, 'http://localhost'), path = url.pathname;
      if (req.method === 'GET' && path === `${PREFIX}/state`) return send(res, 200, {
        config: engine.config, providers: engine.providers(), modelCatalog: engine.modelCatalog(), root: engine.store.root,
        runs: engine.list().map(({tasks, events, ...run}) => ({...run, tasks: tasks.map(({prompt, ...task}) => task), events: events.slice(-30)})),
      });
      if (req.method === 'GET' && path === `${PREFIX}/terminals`) {
        const owner = url.searchParams.get('owner');
        if (!owner || owner.length > 200) return send(res, 400, {error: '缺少有效会话标识'});
        return send(res, 200, {terminals: engine.adapter.terminals?.list(owner, url.searchParams.get('id')) ?? []});
      }
      // 除宿主认证外，浏览器写入再要求同源 Origin 与专有请求头，防止表单 CSRF。
      if (req.method !== 'POST') return send(res, 405, {error: '方法不支持'});
      if (req.headers['x-dsh-orchestrator'] !== '1') return send(res, 403, {error: '缺少同源请求标记'});
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, {error: '跨域请求已拒绝'});
      const body = await jsonBody(req);
      if (path === `${PREFIX}/models/refresh`) return send(res, 200, await engine.refreshModels());
      if (path === `${PREFIX}/terminal/control`) {
        const pool = engine.adapter.terminals;
        if (!pool) throw new Error('可见子代理终端未启用');
        const entry = pool.owned(body.id, body.owner), state = engine.snapshot(entry.meta.runId, body.owner);
        if (state.owner !== body.owner) throw new Error('只能操作当前会话的终端');
        if (body.action === 'takeover') {
          try {return send(res, 200, await pool.takeover(body.id, body.owner));}
          finally {if (engine.active?.state.id === state.id) engine.control(state.id, body.owner, 'pause');}
        }
        if (body.action === 'input') {await pool.input(body.id, body.owner, body.data, body.lease); return send(res, 200, {ok: true});}
        if (body.action === 'release') {
          if (body.resume === true && ['completed', 'cancelled'].includes(state.status)) throw new Error('运行已结束，请交还并保持暂停；不会重新执行已结束任务');
          const snapshot = await pool.release(body.id, body.owner, body.lease);
          const until = Date.now() + 5000;
          while (engine.active?.state.id === state.id && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
          if (engine.active?.state.id === state.id) throw new Error('编排仍在停止，请稍后显式恢复');
          const latest = engine.snapshot(state.id, body.owner), task = latest.tasks.find(task => task.id === entry.meta.taskId);
          const slot = entry.meta.phase === '审核' ? 'review' : 'execution';
          if (entry.sessionId && task?.state === 'interrupted' && latest.calls?.findLast(call => call.taskId === task.id)?.terminalId === entry.id) {
            task.sessions ??= {};
            if (!task.sessions[slot] || task.sessions[slot].binding === entry.binding) {
              task.sessions[slot] = {...task.sessions[slot], id: entry.sessionId, provider: entry.provider, binding: entry.binding, profileKey: entry.profileKey, turns: entry.turns};
              engine.record(latest, 'terminal-returned', '人工终端已交还，原生会话历史保留', task.id);
            }
          }
          if (body.resume === true) {
            if (engine.active) throw new Error('编排仍在停止或另一项运行仍活动，请稍后显式恢复');
            let earlyError;
            engine.run(state.id, body.owner, entry.parent, {retryInterrupted: true}).catch(error => {
              earlyError = error;
              const latest = engine.snapshot(state.id, body.owner); engine.record(latest, 'terminal-resume-failed', error.message, entry.meta.taskId);
            });
            await new Promise(resolve => setImmediate(resolve));
            if (earlyError) throw earlyError;
          }
          return send(res, 200, snapshot);
        }
        if (body.action === 'close') {
          if (entry.job) throw new Error('请先接管暂停正在执行的终端');
          if (entry.control === 'human' && entry.lease !== body.lease) throw new Error('请先接管此终端的控制权');
          await pool.stop(entry); return send(res, 200, {ok: true});
        }
        throw new Error('无效终端操作');
      }
      if (path === `${PREFIX}/control`) {
        const state = engine.snapshot(body.runId);
        return send(res, 200, engine.control(body.runId, state.owner, body.action));
      }
      if (path === `${PREFIX}/config`) {
        if (engine.active) throw new Error('请先结束或暂停当前运行，再修改配置');
        return send(res, 200, engine.updateConfig(body));
      }
      return send(res, 404, {error: '接口不存在'});
    } catch (error) { if (!res.headersSent) send(res, 400, {error: error.message}); }
  }});
}
