import { loadEnvConfig } from '@next/env';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { AiError } from '../../src/lib/ai/spark';
import { evaluateHomeworkQuestions } from '../../src/lib/homework/grading-ai';
import type { HomeworkQuestion } from '../../src/lib/homework/contracts';

loadEnvConfig(process.cwd(), true, { info: (): void => undefined, error: (): void => undefined });
Object.assign(process.env, parseEnv(readFileSync('.env.local', 'utf8')));

const directory = '.taskbook-working/homework-grading-20261020';
mkdirSync(directory, { recursive: true });
const question: HomeworkQuestion = {
  number: '1', type: 'choice', prompt: '有理数中，下列哪个是偶数？A. 3 B. 4 C. 5', answer: 'B',
  referenceAnswer: 'B', basis: '选项B对应4，4能被2整除。', reviewed: true,
};

async function main(): Promise<void> {
  const started = Date.now();
  try {
    const result = await evaluateHomeworkQuestions([question]);
    const item = result.items[0];
    writeFileSync(`${directory}/model-probe.json`, JSON.stringify({ status: 'READY', model: process.env.SPARK_MODEL ?? 'configured-default', elapsedMs: Date.now() - started, returnedCount: result.items.length, assessment: item?.assessment ?? null, objectiveMatch: item?.objectiveMatch ?? null, evidenceMatched: !!item && [question.referenceAnswer, question.basis].some((source): boolean => source.includes(item.evidenceQuote)), rawResponseSaved: false }, null, 2));
  } catch (error) {
    const diagnostic = error instanceof AiError ? error.diagnostic : undefined;
    writeFileSync(`${directory}/model-probe.json`, JSON.stringify({ status: 'FAILED', model: process.env.SPARK_MODEL ?? 'configured-default', elapsedMs: Date.now() - started, errorCode: error instanceof AiError ? error.code : 'UNKNOWN', diagnostic: diagnostic ? { kind: diagnostic.kind, attempts: diagnostic.attempts, fields: diagnostic.fields, issueCodes: diagnostic.issueCodes, rules: diagnostic.rules } : null, rawResponseSaved: false }, null, 2));
  }
  console.log(`${directory}/model-probe.json`);
}

void main();
