import { randomInt } from 'node:crypto';
import { ExerciseType } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { checkContent } from '@/lib/ai/content-guard';
import { AiError, extractJson, modelProvider, type ModelProvider } from '@/lib/ai/spark';
import { schemaDiagnostic, type QualityRule } from '@/lib/ai/schema-diagnostics';
import { ErrorCode } from '@/lib/api/errors';
import { rateLimit, RateLimitPolicy } from '@/lib/api/rate-limit';
import { fail, HttpStatus, ok } from '@/lib/api/response';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/prisma';
import { createTraceId, taskLogger } from '@/lib/jobs/task-logger';

/**
 * AI 练习生成（tasks.md §7.4）
 * ------------------------------------------------------------
 * POST /api/exercises/generate
 * 未传 pointIds 时优先选择当前学习者最薄弱的知识点。
 */

const bodySchema = z.object({
  pointIds: z.array(z.string().min(1)).max(20).optional(),
  count: z.number().int().min(1).max(10).default(5),
  type: z.enum(['single_choice', 'true_false', 'short_answer']).optional(),
});

function optionContent(value: string): string {
  return value.normalize('NFKC').trim().replace(/^(?:[A-F]\s*[.、:)\]]|\([A-F]\)|\[[A-F]\])\s*/i, '').replace(/\s+/g, '').toLocaleLowerCase();
}

function explanationMatchesChoice(explanation: string, answerIndex: number): boolean {
  const expected = String.fromCharCode(65 + answerIndex);
  const text = explanation.normalize('NFKC');
  for (const match of text.matchAll(/(?:选项)?([A-F](?:\s*[、,，和及]\s*[A-F])*)\s*(?:项)?\s*(?:是|为|均|都)?\s*(不正确|错误|正确)/g)) {
    const labels: string[] = match[1].match(/[A-F]/g) ?? [];
    if (match[2] === '正确' ? labels.some((label) => label !== expected) : labels.includes(expected)) return false;
  }
  for (const match of text.matchAll(/(?:正确(?:选项|答案)|答案)\s*(?:应为|应选|是|为|选)\s*(?:选项)?\s*([A-F])(?=$|[\s.,，。；;:：)\]])/g)) {
    if (match[1] !== expected) return false;
  }
  for (const match of text.matchAll(/(?:选项|第)([一二三四五六1-6])(?:个)?(?:选项|项)?\s*(?:是|为)?\s*(不正确|错误|正确)/g)) {
    const index = /^[1-6]$/.test(match[1]) ? Number(match[1]) - 1 : '一二三四五六'.indexOf(match[1]);
    if (match[2] === '正确' ? index !== answerIndex : index === answerIndex) return false;
  }
  return true;
}

const optionSchema = z.string().trim().min(1).max(300).refine((value): boolean => {
  const content = optionContent(value);
  const metaOnly = /^(?:表述|描述|说法)(?:错误|有误|不正确|混淆)(?:[，,。]|.*(?:规则|要求).*(?:不符|不一致))/.test(content);
  return content.length > 0 && !metaOnly && !/^(?:[a-f]|(?:字母|编号|选项|答案|option)[a-f1-6]|[a-f1-6](?:选项|答案)|todo|tbd|待补充|待生成|待填写|选项内容|占位内容|\.{2,}|…+)$/.test(content);
}, { message: '选项必须有实际答案内容，不能仅写A/B、字母A、选项A等编号或占位词，也不能只写表述错误/混淆规则不符等元评价；请把每项具体事实写在options里，不要只写在解析里', params: { rule: 'OPTION_CONTENT' } });

const questionBaseSchema = z.object({
  pointIndex: z.number().int().min(0),
  question: z.string().trim().min(1).max(1000),
  options: z.array(optionSchema).max(6).default([]),
  correctAnswer: z.string().trim().min(1).max(500),
  explanation: z.string().trim().min(1).max(2000),
});

const typeMap = {
  single_choice: ExerciseType.SINGLE_CHOICE,
  true_false: ExerciseType.TRUE_FALSE,
  short_answer: ExerciseType.SHORT_ANSWER,
} as const;

const typeLabelMap = {
  SINGLE_CHOICE: 'single_choice',
  TRUE_FALSE: 'true_false',
  SHORT_ANSWER: 'short_answer',
} as const;

const SYSTEM_PROMPT =
  '你是学习出题助手。只依据给定知识点出一道题，只输出一个合法JSON对象，不要Markdown。' +
  '题干独立可读，写明考查对象和必要条件，一题只考一个明确事实或定义，不用“上述”“这个”等无对象指代。比较变化必须写清固定量。题干尽量不超过60字，不能为压缩长度省略必要条件；解析不超过120字。' +
  '选择题只有一个正确选项，干扰选项必须明确错误且不等价，不用“以上都对/都不对”。解析说明知识点中的正确依据及干扰项错误原因。' +
  '每个选项必须写完整的可选答案内容，不能只有A/B/C/D、字母A、选项A、待补充等编号或占位词，不能给编号加前缀冒充内容，不能把选项内容只放在解析里。' +
  '解析直接解释正确答案的实际内容与依据，尽量不用A/B/C/D编号；若明确使用编号，其正确或错误判断必须与answerIndex和实际选项顺序一致。' +
  '选项写具体事实或具体错误结论，不得使用“表述错误，与规则不符”“表述混淆”等仅评价选项的套话。' +
  '资料不足或无法确保唯一答案时，改考知识点中有依据的另一明确事实，不补造条件、数值或原文没有的结论。若知识点自相矛盾、概念混淆或确实没有可靠事实，只输出{"insufficientEvidence":true}，不要为了凑题编造。讲解材料只考明确结论，不把例子的条件或讲师反问当成通用事实。禁止占位内容。';
const qualityMessages: Record<QualityRule, string> = {
  DUPLICATE_FACT: '原文精选中同一答案事实重复考查，请尝试减少出题数量',
  OPTION_CONTENT: '选项缺少实际内容', OPTION_UNIQUE: '选项数量不符或内容重复', ANSWER_RANGE: '答案编号超出选项范围', ANSWER_VALUE: '答案不匹配实际选项', EXPLANATION_CONFLICT: '答案与解析结论矛盾', QUESTION_STATEMENT: '判断题不是明确陈述句', ANSWER_BOOLEAN: '判断题答案格式不符', OPTIONS_UNEXPECTED: '题型与选项结构不符', DUPLICATE_QUESTION: '本批出现重复题干', POINT_SCOPE: '题目关联知识点不符', TYPE_SCOPE: '题型不符合当前选择',
};
export const POST = withAuth(async (request: NextRequest, { user }) => {
  const limited = await rateLimit(`ai:exercise:${user.id}`, RateLimitPolicy.ai.limit, RateLimitPolicy.ai.windowMs);
  if (!limited.allowed) {
    const response = fail(ErrorCode.RATE_LIMITED, 'AI 请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS, { retryAfter: limited.retryAfter });
    response.headers.set('Retry-After', String(limited.retryAfter));
    return response;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION_FAILED,
      '练习参数校验未通过',
      HttpStatus.BAD_REQUEST,
      parsed.error.flatten().fieldErrors,
    );
  }

  const { pointIds, count, type } = parsed.data;
  const points = pointIds
    ? await prisma.knowledgePoint.findMany({
        where: { id: { in: pointIds }, ownerId: user.id },
        orderBy: { createdAt: 'asc' },
        take: 20,
      })
    : await prisma.knowledgePoint.findMany({
        where: { ownerId: user.id, masteries: { some: { learnerId: user.id, isWeak: true } } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });

  if (points.length === 0) {
    return fail(ErrorCode.NO_WEAK_POINT, '暂无可生成练习的薄弱知识点', HttpStatus.CONFLICT);
  }

  const questionTypeSchema = type
    ? z.literal(type)
    : z.enum(['single_choice', 'true_false', 'short_answer']);
  const questionSchema = z.object({
    pointIndex: z.number().int().min(0).max(points.length - 1),
    type: questionTypeSchema,
    question: questionBaseSchema.shape.question,
    options: questionBaseSchema.shape.options,
    correctAnswer: questionBaseSchema.shape.correctAnswer,
    explanation: questionBaseSchema.shape.explanation,
  }).superRefine((question, context) => {
    if (question.type === 'single_choice') {
      const normalized = question.options.map(optionContent);
      if (question.options.length < 2 || new Set(normalized).size !== normalized.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '单选题需要 2-6 个互不重复的选项', params: { rule: 'OPTION_UNIQUE' } });
      }
      if (!question.options.includes(question.correctAnswer)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['correctAnswer'], message: '正确答案必须逐字匹配一个选项', params: { rule: 'ANSWER_VALUE' } });
      }
      if (!explanationMatchesChoice(question.explanation, question.options.indexOf(question.correctAnswer))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['explanation'], message: '解析中的正确/错误选项编号与正确答案矛盾，请解释实际答案内容并与选项顺序保持一致', params: { rule: 'EXPLANATION_CONFLICT' } });
      }
    } else if (question.options.length !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '判断题和简答题不能包含选项', params: { rule: 'OPTIONS_UNEXPECTED' } });
    }
    if (question.type === 'true_false' && !['true', 'false'].includes(question.correctAnswer)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['correctAnswer'], message: '判断题答案必须是 true 或 false', params: { rule: 'ANSWER_BOOLEAN' } });
    }
    if (question.type === 'true_false') {
      if (/[?？]|什么|如何|是否|为什么/.test(question.question)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['question'], message: '判断题必须是可判定真假的陈述句，不能提问', params: { rule: 'QUESTION_STATEMENT' } });
      }
      const opposite = question.correctAnswer === 'true' ? /^(?:该|此|这)(?:论述|说法|描述|判断|结论)(?:是)?(?:错误|不正确|不成立)/ : /^(?:该|此|这)(?:论述|说法|描述|判断|结论)(?:是)?(?:正确|成立)/;
      if (opposite.test(question.explanation)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['explanation'], message: '解析的明确结论不能与判断答案相反', params: { rule: 'EXPLANATION_CONFLICT' } });
      }
    }
  });
  type Question = z.infer<typeof questionSchema>;
  const repeatsExtractAnswer = (previous: Question[], current: Question): boolean => {
    if (current.type !== 'single_choice' || !points[current.pointIndex]?.tags?.includes('原文精选')) return false;
    const key = (answer: string): string => optionContent(answer).replace(/[。.!！?？；;]+$/u, '');
    return previous.some((question): boolean => question.type === 'single_choice' && question.pointIndex === current.pointIndex
      && key(question.correctAnswer) === key(current.correctAnswer));
  };
  const responseSchema = z.object({ questions: z.array(questionSchema).length(count) }).superRefine((response, context) => {
    const normalized = response.questions.map((question) => question.question.trim().toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: '同批题干不能重复', params: { rule: 'DUPLICATE_QUESTION' } });
    }
    if (response.questions.some((question, index): boolean => repeatsExtractAnswer(response.questions.slice(0, index), question))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: '原文精选的同一标准答案本批最多考一次；请减少题数或补充依据。', params: { rule: 'DUPLICATE_FACT' } });
    }
  });

  let generated: z.infer<typeof responseSchema>;
  const traceId = createTraceId();
  let failedQuestion = 0;
  let selectedProvider: ModelProvider | undefined;
  try {
    const provider = modelProvider();
    selectedProvider = provider;
    const questions: z.infer<typeof questionSchema>[] = [];
    for (let offset = 0; offset < count; offset += 1) {
      failedQuestion = offset + 1;
      const batchCount = 1;
      const selectedType = type ?? 'single_choice';
      const batchIndices = Array.from({ length: batchCount }, (_, index) => (offset + index) % points.length);
      const pointText = [...new Set(batchIndices)].map((index) => `${index}. ${points[index].title}：${points[index].summary}`).join('\n');
      const batchSchema = z.object({ questions: z.array(questionSchema).length(batchCount) });
      const common = { question: questionBaseSchema.shape.question, explanation: questionBaseSchema.shape.explanation };
      // Choose once per question, so schema retries keep the same mapping and never assume A is correct.
      const correctPosition = randomInt(2);
      const pairSchema = z.object({ ...common, correctOption: optionSchema, wrongOption: optionSchema }).strict()
        .transform((question): { questions: z.infer<typeof questionSchema>[] } => {
          const options = correctPosition === 0 ? [question.correctOption, question.wrongOption] : [question.wrongOption, question.correctOption];
          return { questions: [{ pointIndex: batchIndices[0], type: 'single_choice', question: question.question,
            options, correctAnswer: question.correctOption, explanation: question.explanation }] };
        });
      const singleSchema = selectedType === 'single_choice'
        ? z.object({ ...common, options: questionBaseSchema.shape.options, answerIndex: z.union([
            z.number().int().min(0).max(5),
            z.tuple([z.number().int().min(0).max(5)]).transform(([index]) => index),
          ]) })
          .superRefine((question, context) => {
            if (question.answerIndex >= question.options.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['answerIndex'], message: '答案编号必须在选项范围内', params: { rule: 'ANSWER_RANGE' } });
          }).transform((question) => ({ questions: [{ pointIndex: batchIndices[0], type: selectedType, question: question.question, options: question.options, correctAnswer: question.options[question.answerIndex], explanation: question.explanation }] }))
        : z.object({ ...common, answer: selectedType === 'true_false' ? z.union([
            z.boolean().transform(String), z.enum(['true', 'false']),
            z.tuple([z.boolean()]).transform(([answer]) => String(answer)),
          ]) : questionBaseSchema.shape.correctAnswer })
          .transform((question) => ({ questions: [{ pointIndex: batchIndices[0], type: selectedType, question: question.question, options: [], correctAnswer: question.answer, explanation: question.explanation }] }));
      const modelSchema = z.union(selectedType === 'single_choice' ? [singleSchema, pairSchema, batchSchema] : [singleSchema, batchSchema], {
        errorMap: (issue, context): { message: string } => {
          const optionIssue = issue.code === z.ZodIssueCode.invalid_union
            ? issue.unionErrors.flatMap((error) => error.issues).find((error) => error.message.startsWith('选项必须有实际答案内容')) : undefined;
          return { message: optionIssue?.message ?? context.defaultError };
        },
      }).pipe(batchSchema).superRefine((batch, context) => {
        if (batch.questions.some((question): boolean => repeatsExtractAnswer(questions, question))) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: '原文精选的同一标准答案本批最多考一次，不能仅换题干重复；没有新依据请返回insufficientEvidence:true。', params: { rule: 'DUPLICATE_FACT' } });
        }
        const stems = [...questions, ...batch.questions].map((question) => question.question.trim().toLocaleLowerCase());
        if (new Set(stems).size !== stems.length) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: '题干不能与本批或此前批次重复', params: { rule: 'DUPLICATE_QUESTION' } });
        }
        if (batch.questions.some((question) => !batchIndices.includes(question.pointIndex))) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: '知识点编号必须属于本批输入', params: { rule: 'POINT_SCOPE' } });
        }
        if (batch.questions.some((question) => question.type !== selectedType)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: '题型必须符合本次指定题型', params: { rule: 'TYPE_SCOPE' } });
        }
      });
      const generationSchema = z.preprocess((value: unknown): unknown => {
        if (value && typeof value === 'object' && 'insufficientEvidence' in value && (value.insufficientEvidence !== true || Object.keys(value).length !== 1)) return null;
        return value;
      }, z.union([modelSchema, z.object({ insufficientEvidence: z.literal(true) }).strict()], {
        errorMap: (issue, context): { message: string } => ({ message: issue.code === 'invalid_union' ? issue.unionErrors[0]?.issues[0]?.message ?? context.defaultError : context.defaultError }),
      }));
      const result = await extractJson<z.infer<typeof generationSchema>>(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `只生成1道${{ single_choice: '单选题', true_false: '判断题', short_answer: '简答题' }[selectedType]}。` +
              '\nJSON字段：question为题干字符串，explanation为解析字符串。' +
              (selectedType === 'single_choice' ? '只用四个字段：question、correctOption、wrongOption、explanation。correctOption写资料明确支持的正确答案完整内容，wrongOption只写一个针对同一问题、明确错误且不等价的具体干扰答案。不要为了增加选项凑数。两项都必须独立可读、内容互不重复，不含A/B编号；不输出options或answerIndex，后端排列选项。解析解释实际内容，不出现选项字母、序号或“正确选项”等无内容评价。' : selectedType === 'true_false' ? '从摘要中选择一个明确事实，写成完整陈述句，不要评判原文分析过程。不能使用什么、如何、是否或问号。必须输出answer布尔值，解析结论与答案一致。格式：{"question":"陈述句","answer":true,"explanation":"资料依据"}，替换为实际内容。' : 'answer为一个简短标准答案字符串，只考一个术语、名称或确定数值，题干明确回答范围；数值题写明单位及是否需填写单位。当前按规范化文字完全匹配判分，不生成论述、举例、多项列举或开放式解释题，不提供多个备选答案。') +
              `\n知识点如下：\n${pointText}` +
              `\n本批请求${count}题，当前第${offset + 1}题。` +
              (offset >= points.length ? `\n以下是本批同知识点已出题干与答案事实，仅用于避重，不是新增资料。请考另一明确事实或条件；仅换说法不能增加资料信息量，无法可靠出新题就输出{"insufficientEvidence":true}：\n${JSON.stringify(questions.filter((question) => question.pointIndex === batchIndices[0]).map((question) => ({ question: question.question, answer: question.correctAnswer })))}` : ''),
          },
        ],
        generationSchema,
        { provider, timeoutMs: 60_000, maxTokens: 1200, temperature: 0.1, traceId },
      );
      if ('insufficientEvidence' in result.data) throw new AiError('资料依据不足，本批未保存', 'INSUFFICIENT_EVIDENCE', 503);
      questions.push(...result.data.questions);
    }
    generated = responseSchema.parse({ questions });
  } catch (error) {
    const diagnostic = error instanceof AiError ? error.diagnostic : selectedProvider && error instanceof z.ZodError ? schemaDiagnostic(error.issues, 0) : undefined;
    const qualityFailure = error instanceof AiError && error.code === 'SCHEMA_INVALID' || diagnostic !== undefined;
    const insufficient = error instanceof AiError && error.code === 'INSUFFICIENT_EVIDENCE';
    const reason = insufficient ? 'INSUFFICIENT_EVIDENCE' : diagnostic?.kind === 'invalid_json' ? 'INVALID_JSON' : diagnostic?.rules[0] ?? (qualityFailure ? 'SCHEMA_INVALID' : undefined);
    const explanation = diagnostic?.kind === 'invalid_json' ? '返回内容不是完整JSON' : diagnostic?.rules[0] ? qualityMessages[diagnostic.rules[0]] : '返回结构或字段不符合要求';
    const details = { traceId, reason, failedQuestion, requestedCount: count, diagnostic };
    taskLogger.warn('exercise: AI request failed', { ...details, provider: selectedProvider, code: qualityFailure ? 'SCHEMA_INVALID' : error instanceof AiError ? error.code : 'UNKNOWN' });
    return fail(
      ErrorCode.AI_UNAVAILABLE,
      error instanceof AiError && error.code === 'TIMEOUT' ? 'AI 服务响应超时' :
        insufficient ? '当前知识点依据不足或存在概念歧义，请先核对资料与知识点；本批题目未保存' : qualityFailure ? `AI 生成的题目未通过质量校验：${explanation}；本批题目未保存` : 'AI 服务暂时不可用，请稍后重试',
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }

  const questions = generated.questions;
  const blocked = questions.some((question) => !checkContent(
    `${question.question}\n${question.options.join('\n')}\n${question.correctAnswer}\n${question.explanation}`,
  ).safe);
  if (blocked) {
    return fail(ErrorCode.CONTENT_BLOCKED, '生成内容未通过安全检查', HttpStatus.FORBIDDEN);
  }

  const created = await prisma.$transaction(
    questions.map((question) => prisma.exercise.create({
      data: {
        contentId: points[question.pointIndex].contentId,
        pointId: points[question.pointIndex].id,
        type: typeMap[question.type],
        question: question.question,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
      },
    })),
  );

  return ok({
    questions: created.map((exercise, index) => ({
      exerciseId: exercise.id,
      pointId: exercise.pointId,
      type: typeLabelMap[exercise.type],
      question: exercise.question,
      options: exercise.options,
      index,
    })),
  }, '练习已生成');
});
