/**
 * 设计 Token（TypeScript 版）
 * ------------------------------------------------------------
 * 与 tailwind.config.ts、UI 设计文档附录 A 完全一致的单一数据源。
 * 图表（ECharts / SVG）等无法用 class 的场景，直接 import 这里的常量。
 */

/** 颜色 */
export const colors = {
  /** 全站底色（深空黑） */
  bg: '#05060A',
  /** 二级容器 / 卡片表层 */
  surface: '#0C1018',
  /** 主色 翡翠绿 */
  brand: '#3ECF8E',
  /** 辅色 琥珀（待复习 / 重点高亮） */
  amber: '#FFB454',
  /** 辅色 青碧（信息 / 数据可视化） */
  teal: '#2DD4BF',
  /** 辅色 玫红（警示 / 弱项） */
  rose: '#FB7185',
  /** 主文字 */
  text: '#F2F5F7',
  /** 次文字 */
  textSub: '#9AA3B2',
  /** 微弱文字（占位 / 禁用） */
  textMute: '#5A6473',
} as const;

/** 间距（基础单位 8px） */
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 80,
} as const;

/** 圆角：按钮 12 / 卡片 16 / 大容器 24 / 全屏模态 32 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

/** 字体 */
export const font = {
  sans: 'Noto Sans SC',
  mono: 'JetBrains Mono',
} as const;

/**
 * 玻璃拟态三档强度（设计文档 §2.4）
 * weak   → 顶部导航栏
 * medium → 卡片容器
 * strong → 浮层 / 弹窗
 */
export const glassLevel = {
  weak: { fill: 0.03, blur: 16, stroke: 0.08 },
  medium: { fill: 0.04, blur: 24, stroke: 0.1 },
  strong: { fill: 0.07, blur: 32, stroke: 0.14 },
} as const;

/** 知识图谱节点掌握度色阶：绿（掌握）→ 黄（薄弱）→ 红（未知） */
export const masteryColor = (score: number) => {
  if (score >= 0.75) return colors.brand;
  if (score >= 0.6) return colors.teal;
  if (score >= 0.3) return colors.amber;
  return colors.rose;
};
