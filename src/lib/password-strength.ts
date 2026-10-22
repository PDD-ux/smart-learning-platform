/**
 * 密码强度计算（4 档：弱 / 中 / 强 / 极强）
 * ------------------------------------------------------------
 * 设计文档 §3.7 要求实时计算强度条。
 * 生产环境建议换成 zxcvbn（能识别常见弱密码与字典词），
 * 这里用轻量规则实现，避免为了一个输入框引入 800KB 依赖。
 */

/** 常见弱密码黑名单（命中直接判为最弱） */
const WEAK_LIST = [
  '12345678',
  '123456789',
  '87654321',
  'password',
  'abc12345',
  'qwertyui',
  '11111111',
  '00000000',
  'zhiliao123',
];

export type PasswordStrength = {
  /** 0 弱 / 1 中 / 2 强 / 3 极强 */
  level: 0 | 1 | 2 | 3;
  label: string;
  /** 进度条宽度百分比 */
  percent: number;
  /** 进度条颜色（Tailwind 类名） */
  barClass: string;
  /** 文字颜色（Tailwind 类名） */
  textClass: string;
};

export function calcStrength(pwd: string): PasswordStrength {
  if (!pwd) {
    return { level: 0, label: '未输入', percent: 0, barClass: 'bg-textMute', textClass: 'text-textMute' };
  }

  if (WEAK_LIST.includes(pwd.toLowerCase())) {
    return { level: 0, label: '弱', percent: 25, barClass: 'bg-rose', textClass: 'text-rose' };
  }

  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

  // 5 分制映射到 4 档
  if (score <= 1) {
    return { level: 0, label: '弱', percent: 25, barClass: 'bg-rose', textClass: 'text-rose' };
  }
  if (score === 2) {
    return { level: 1, label: '中', percent: 50, barClass: 'bg-amber', textClass: 'text-amber' };
  }
  if (score === 3 || score === 4) {
    return { level: 2, label: '强', percent: 75, barClass: 'bg-teal', textClass: 'text-teal' };
  }
  return { level: 3, label: '极强', percent: 100, barClass: 'bg-brand', textClass: 'text-brand-ink' };
}
