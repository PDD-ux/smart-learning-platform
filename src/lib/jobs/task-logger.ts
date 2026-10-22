/**
 * 结构化任务日志 TaskLogger（tasks.md 2.3）
 * ------------------------------------------------------------
 * 任务标识、阶段、耗时、traceId 统一结构化输出，traceId 向下游透传
 * （MindSpore / ASR / 大模型请求头 X-Trace-Id）。
 */

export function createTraceId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

type TaskLogFields = {
  jobId?: string;
  contentId?: string;
  stage?: string;
  traceId?: string;
  durationMs?: number;
  [k: string]: unknown;
};

export const taskLogger = {
  info(message: string, fields: TaskLogFields = {}) {
    // 生产可替换为结构化日志管道（如 pino / winston JSON），此处 console 兜底
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', message, ...fields }));
  },
  warn(message: string, fields: TaskLogFields = {}) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', message, ...fields }));
  },
  error(message: string, fields: TaskLogFields = {}) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', message, ...fields }));
  },
};