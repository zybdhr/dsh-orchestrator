import test from 'node:test';
import assert from 'node:assert/strict';
import {withClaudeTools, withClaudeWriteTools, CLAUDE_WRITE_TOOLS} from '../src/claude-permissions.js';
import {configuredProvider} from '../src/native-models.js';
import {DshAdapter} from '../src/adapter.js';

test('Claude 写任务仅追加明确验证工具，接口不符则拒绝启动', () => {
  const spec = {argv:['node','cli.js','--permission-mode','acceptEdits'], env:{EXISTING:'keep'}};
  const next = withClaudeWriteTools(spec);
  assert.equal(next.env,spec.env); assert.equal(spec.argv.length,4);
  assert.equal(next.argv.at(-1),CLAUDE_WRITE_TOOLS.join(','));
  assert(!CLAUDE_WRITE_TOOLS.includes('Bash')); assert(!CLAUDE_WRITE_TOOLS.includes('Bash(*)'));
  assert.throws(()=>withClaudeWriteTools({argv:['--permission-mode','dontAsk']}),/接口发生变化/);
  assert.throws(()=>withClaudeWriteTools({argv:[...spec.argv,'--allowedTools','Read']}),/合并/);
});

test('Claude 写调用使用 acceptEdits，原始只读配置保持不变', async () => {
  const config={permissionMode:'dontAsk',model:'domestic',env:{}}; let supplied;
  const ctx={subagents:{getProvider:()=>({start(){},config}),registerProvider:()=>()=>{}},subprocess:{spawn:s=>s},logger:{}};
  const provider=await configuredProvider(ctx,'claude-code',{writeAccess:true},async()=>({apply(c,opts){supplied=opts;c.subagents.registerProvider({name:opts.providerName});}}));
  assert.equal(supplied.permissionMode,'acceptEdits');assert.equal(config.permissionMode,'dontAsk');provider.dispose();
});

test('适配器只为 Claude 写任务开启写权限，审核读取不升级', async () => {
  const seen=[];
  const adapter=new DshAdapter({subagents:{getProvider:()=>({}),async startActivation(){return{childId:'probe',result:Promise.resolve({stopReason:'completed',output:[]}),async dispose(){}};}}},{configureProvider:async(_c,_p,options)=>{seen.push(options);return{name:'scoped',dispose(){}};}});
  for(const access of ['write','read'])await adapter.execute({provider:'claude-code',access,modelOptions:{model:'domestic'},signal:new AbortController().signal});
  assert.equal(seen[0].writeAccess,true);assert.equal(seen[1].writeAccess,undefined);
});


test('审核保留 dontAsk 且只开放声明的测试工具，不开放编辑或通用 Bash',()=>{
  const spec={argv:['node','cli','--permission-mode','dontAsk']};
  const read=withClaudeTools(spec).argv.at(-1);
  assert(read.includes('Bash(git diff:*)'));assert(!read.includes('pytest'));assert(!read.includes('Edit'));
  const verify=withClaudeTools(spec,{verification:['typescript']});
  assert.equal(verify.argv[3],'dontAsk');assert(verify.argv.at(-1).includes('Bash(npx tsc:*)'));
  assert(!verify.argv.at(-1).includes('pytest'));assert(!verify.argv.at(-1).includes('Write'));
  assert.throws(()=>withClaudeTools(spec,{verification:['all']}),/未知/);
});
