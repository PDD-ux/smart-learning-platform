/**
 * AI 输出内容安全过滤
 * ------------------------------------------------------------
 * PRD §7.2 要求：所有 LLM 输出做「违规词 / 涉政词 / 涉黄词」三层过滤后再写入 DB。
 * 这里实现的是第一层（本地关键词 + 正则）；
 * 生产环境应在 ai-gateway 里再叠加阿里云内容安全 / 自部署 moderation 模型做二次审核。
 */

/** 违规词表（示例，生产环境换成完整词库 + 定期更新） */
const BLOCK_WORDS = [
  '赌博',
  '毒品',
  '走私',
  '诈骗',
  '洗钱',
  '枪支',
  '爆炸物',
  '色情',
  '淫秽',
];

/** 涉政敏感模式（正则，命中即拦截） */
const POLITICAL_PATTERNS = [
  /台独/g,
  /藏独/g,
  /疆独/g,
  /港独/g,
  /法轮/g,
];

/** 输出控制类攻击：试图让模型忽略指令 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /忽略(上面|之前|以上)(的)?(所有)?指令/i,
];

export type GuardResult = {
  safe: boolean;
  /** 命中的分类，便于写审计日志 */
  categories: string[];
  /** 命中的具体词（脱敏后，只保留首字符） */
  hits: string[];
};

/** 单条文本脱敏：只保留首字符，避免敏感词二次扩散到日志 */
function mask(word: string) {
  return word.length <= 1 ? '*' : `${word[0]}${'*'.repeat(Math.min(word.length - 1, 4))}`;
}

/**
 * 对一段 LLM 输出做内容安全检查
 * 命中任意一类即判定为不安全，调用方应丢弃输出并走人工兜底。
 */
export function checkContent(text: string): GuardResult {
  const categories: string[] = [];
  const hits: string[] = [];

  for (const w of BLOCK_WORDS) {
    if (text.includes(w)) {
      if (!categories.includes('illegal')) categories.push('illegal');
      hits.push(mask(w));
    }
  }

  for (const p of POLITICAL_PATTERNS) {
    const m = text.match(p);
    if (m) {
      if (!categories.includes('political')) categories.push('political');
      hits.push(mask(m[0]));
    }
  }

  for (const p of INJECTION_PATTERNS) {
    if (p.test(text)) {
      if (!categories.includes('injection')) categories.push('injection');
      hits.push('prompt-injection');
    }
  }

  return { safe: categories.length === 0, categories, hits };
}

/**
 * 输入侧清洗：用户粘贴的视频文本可能含超长内容或控制字符，
 * 入库前先截断，防止 token 失控（全栈路线 §4.3）
 */
export function sanitizeInput(text: string, maxChars = 12000) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // 去控制字符
    .slice(0, maxChars);
}
