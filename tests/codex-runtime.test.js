import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PassThrough} from 'node:stream';
import {resolveCodexRuntime, withCodexRuntime, codexErrorDetail, observeCodexErrors} from '../src/codex-runtime.js';

test('从 PATH 选择用户 CLI，排除打包旧版本；保留所有原生参数与权限环境', t => {
  const root = mkdtempSync(join(tmpdir(), 'codex-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const oldDir=join(root,'old'),newDir=join(root,'new');mkdirSync(oldDir);mkdirSync(newDir);
  for(const dir of [oldDir,newDir]){writeFileSync(join(dir,'codex.js'),'#!/usr/bin/env node\n',{mode:0o755});symlinkSync(join(dir,'codex.js'),join(dir,'codex'));}
  const runtime=resolveCodexRuntime({pathEnv:`${oldDir}:${newDir}`,excluded:[join(oldDir,'codex.js')]});
  assert.equal(runtime.path,join(newDir,'codex.js'));
  const spec={argv:[process.execPath,join(oldDir,'codex.js'),'app-server','--stdio','-c','model_reasoning_effort="high"'],cwd:root,env:{KEEP:'value'},graceMs:3000,stdio:{stdout:'pipe'}};
  const next=withCodexRuntime(spec,()=>runtime);assert.deepEqual(next.argv.slice(0,2),[process.execPath,join(newDir,'codex.js')]);assert.deepEqual(next.argv.slice(2),spec.argv.slice(2));assert.equal(next.env,spec.env);assert.equal(next.cwd,spec.cwd);assert.equal(next.graceMs,spec.graceMs);
  assert.throws(()=>resolveCodexRuntime({pathEnv:oldDir,excluded:[join(oldDir,'codex.js')]}),/不会退回/);
});

test('安全投影原生模型错误并在取消订阅后移除监听，不泄漏未知远端文本', () => {
  const message=JSON.stringify({status:400,error:{message:"The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account."}});
  assert.match(codexErrorDetail({message}),/CLI.*gpt-6-luna/);
  assert.equal(codexErrorDetail({message:'unknown private-token https://private.invalid'}),undefined);
  const stream=new PassThrough();const observer=observeCodexErrors(stream);const frame=JSON.stringify({method:'error',params:{error:{message}}})+'\n';stream.write(frame.slice(0,18));stream.write(frame.slice(18));assert.match(observer.read(),/CLI.*gpt-6-luna/);observer.dispose();assert.equal(stream.listenerCount('data'),0);stream.destroy();
});
