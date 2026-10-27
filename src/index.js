import { homedir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from './engine.js';
import { DshAdapter } from './adapter.js';
import { mountRoutes } from './http.js';
import {VisibleTerminals} from './visible-terminals.js';

export const name = 'local-orchestrator';
export const inject = ['subagents', 'subprocess'];
export function apply(ctx, config = {}) {
  const root = config.dataDir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'orchestrator');
  const terminals = new VisibleTerminals(ctx, {root: join(root, 'terminals')});
  const engine = new Orchestrator({root, adapter: new DshAdapter(ctx, {terminals}), config});
  ctx.provide('orchestrator', engine);
  ctx.effect(() => async () => {try {await engine.close();} finally {await terminals.close();}}, 'orchestrator: 调度与子代理终端停止');
  ctx.inject(['webServer'], web => web.effect(() => mountRoutes(web, engine), 'orchestrator: 认证后的本地 API'));
}
