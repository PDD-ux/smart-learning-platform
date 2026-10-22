import type { AiError } from './spark';

/**
 * AI 失败原因 → 用户可见文案
 * ------------------------------------------------------------
 * 此前调用方把所有 AiError 统一呈现为「暂时无法完成分析，请稍后重试」，
 * 导致「没配密钥」这类重试一万次也不会好转的问题与「供应商抖动」无法区分。
 *
 * 本模块按错误码给出可区分的说明，让用户一眼判断该重试、该改配置还是该缩小输入。
 * 收录准则：
 * - 只输出固定文案，绝不透传上游报文、原始错误消息、请求体或凭据（见 spark.ts 的白名单原则）
 * - 文案必须能回答「我现在该做什么」，而不是描述内部发生了什么
 */

const AI_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  MISSING_API_KEY: '服务端未配置模型密钥，请在 .env.local 填写对应变量后重启服务；重试无效',
  QUOTA_NOT_CONFIRMED: '该模型的免费额度尚未确认，请先在云端确认额度与「用完即停」后再启用',
  MODEL_CONFIG_INVALID: '模型配置无效，请检查模型相关的环境变量',
  TIMEOUT: '本次分析超过了时间限制，请缩小问题范围后重试',
  SCHEMA_INVALID: '模型本次返回的内容格式不符合要求，可稍后重试；反复出现通常是模型能力不足，需更换更强的模型',
  OUTPUT_TRUNCATED: '模型输出达到长度上限，请缩短问题或减少一次处理的范围',
  EMPTY_RESPONSE: '模型本次返回了空内容，请稍后重试',
  UPSTREAM_ERROR: '模型服务暂时不可用或已达调用限额，请稍后重试',
  STEP_LIMIT: '未能在工具预算内完成必要的资料检索，请换用更明确的关键词',
  GROUNDING_FAILED: '这次解释未通过原文核对，请回看资料或缩小问题后重试',
  REVIEW_NOT_READY: '当前模型的原文解释核验尚未通过，请到学习页回看原文',
  INSUFFICIENT_EVIDENCE: '资料中的原文依据不足，无法据此生成，请补充资料或缩小范围',
  SOURCE_CHANGED: '资料内容已发生变化，请刷新页面后重试',
};

const GENERIC_AI_FAILURE = 'AI 服务暂时不可用，请稍后重试';

/**
 * 把 AI 失败转换为用户可见文案。
 * @param error 捕获到的 AiError，只读取其 code
 * @param suffix 追加在末尾的收尾说明，例如「；没有保存计划或提交答案」
 */
export function describeAiFailure(error: AiError, suffix = ''): string {
  return (AI_FAILURE_MESSAGES[error.code] ?? GENERIC_AI_FAILURE) + suffix;
}
