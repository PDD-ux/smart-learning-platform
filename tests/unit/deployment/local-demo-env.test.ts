import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
const execute = promisify(execFile);
const entry = path.resolve('scripts/demo/local-demo.ts');
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

async function runPreflight(action: 'check' | 'start', inherited = false, developmentOverride = false): Promise<{ localWins: boolean; inheritedWins: boolean; defaultLoaded: boolean; filesUntouched: boolean }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskbook-demo-env-'));
  const common = 'QUEUE_DRIVER=memory\nSTORAGE_DRIVER=local\n';
  const defaults = common + 'ASR_PROVIDER=mock\n';
  const local = 'ASR_PROVIDER=funasr-local\nASR_LOCAL_PYTHON=synthetic-python\nASR_LOCAL_MODEL_DIR=synthetic-model\nFEATURE_ASR=true\n';
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV:'development', DATABASE_URL:'postgresql://test:test@127.0.0.1:1/test', FACE_INFER_URL:'', ASCEND_INFER_URL:'', FFMPEG_PATH:'missing-fixture-tool', FFPROBE_PATH:'missing-fixture-tool' };
  for (const name of ['ASR_PROVIDER','ASR_LOCAL_PYTHON','ASR_LOCAL_MODEL_DIR','FEATURE_ASR','QUEUE_DRIVER','STORAGE_DRIVER','__NEXT_PROCESSED_ENV']) delete env[name];
  if (inherited) env.ASR_PROVIDER='mock';
  let output='';
  try {
    await writeFile(path.join(root,'.env'),defaults); await writeFile(path.join(root,'.env.local'),local);
    if (developmentOverride) await writeFile(path.join(root,'.env.development.local'),'ASR_PROVIDER=mock\n');
    try { const result = await execute(process.execPath, ['--import',loader,entry,action,...(action === 'check' ? ['--import'] : [])], {cwd:root,env,windowsHide:true,timeout:20000}); output=result.stdout; }
    catch (reason: unknown) {
      const failure=reason as {code?:unknown;stdout?:unknown;stderr?:unknown};
      if (failure.code !== 1 || typeof failure.stdout !== 'string') throw new Error('Isolated CLI failed unexpectedly (no raw output)');
      if (!failure.stdout.includes('asr:')) throw new Error('CLI bootstrap: ' + (typeof failure.stderr === 'string' ? failure.stderr.match(/ERR_[A-Z_]+/)?.[0] ?? 'no diagnostic' : 'no diagnostic')); output=failure.stdout;
    }
    return { localWins:output.includes('asr: configured'), inheritedWins:output.includes('asr: blocked'), defaultLoaded:output.includes('queue: ready') && output.includes('storage: ready'), filesUntouched:await readFile(path.join(root,'.env'),'utf8') === defaults && await readFile(path.join(root,'.env.local'),'utf8') === local };
  } finally {
    const relative=path.relative(os.tmpdir(),root);
    if (relative.startsWith('taskbook-demo-env-') && !relative.includes(path.sep)) await rm(root,{recursive:true,force:true});
  }
}

it.each(['check','start'] as const)('loads local environment before Prisma for ordinary %s', async (action): Promise<void> => {
  const result=await runPreflight(action);
  expect(result.localWins).toBe(true); expect(result.defaultLoaded).toBe(true); expect(result.filesUntouched).toBe(true);
},25000);
it('preserves explicitly inherited process configuration', async (): Promise<void> => {
  const result=await runPreflight('check',true);
  expect(result.inheritedWins).toBe(true); expect(result.localWins).toBe(false); expect(result.filesUntouched).toBe(true);
},25000);
it('uses Next development-specific local configuration before generic local configuration', async (): Promise<void> => {
  const result=await runPreflight('check',false,true);
  expect(result.inheritedWins).toBe(true); expect(result.localWins).toBe(false); expect(result.filesUntouched).toBe(true);
},25000);
