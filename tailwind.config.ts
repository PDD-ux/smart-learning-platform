import type { Config } from 'tailwindcss';

/**
 * 文豪 · 纸张学习桌设计系统
 * 所有色值 / 间距 / 圆角统一服务于轻松、有趣的学习体验，
 * 任何页面都不要写死十六进制颜色，统一用这里的语义名，方便后续换肤。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** 全站底色（奶油纸张） */
        bg: '#FFF9F0',
        /** 二级容器 / 卡片表层 */
        surface: '#FFFDF8',
        /** 主色 海蓝：主操作、学习状态、进度 */
        brand: {
          DEFAULT: '#4D7CFE',
          soft: 'rgba(77, 124, 254, 0.12)',
          hover: '#3768EA',
          /** 浅底上的主色文字：满足 WCAG 4.5:1 对比度（DEFAULT 在奶油底仅 ~2.9:1） */
          ink: '#2C54C9',
        },
        /** 辅色 蜜桃：重点高亮 / 待复习 */
        amber: {
          DEFAULT: '#F49B54',
          soft: 'rgba(244, 155, 84, 0.15)',
        },
        /** 辅色 薄荷：信息提示 / 数据可视化 */
        teal: {
          DEFAULT: '#27B89A',
          soft: 'rgba(39, 184, 154, 0.14)',
        },
        /** 辅色 珊瑚：警示 / 弱项标识 */
        rose: {
          DEFAULT: '#EC6D66',
          soft: 'rgba(236, 109, 102, 0.14)',
        },
        /** 文字三级 */
        text: '#20304A',
        textSub: '#647089',
        textMute: '#98A1B2',
        /** 纸张卡片描边 */
        glass: {
          line: '#E8E1D5',
          lineStrong: '#D6CCBD',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', 'system-ui', '-apple-system', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      /** 基础间距单位 8px，所有 margin/padding 取 8 的倍数 */
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        '2xl': '48px',
        '3xl': '80px',
      },
      /** 圆角：按钮 14 / 卡片 22 / 大容器 30 / 全屏模态 36 */
      borderRadius: {
        sm: '10px',
        md: '14px',
        lg: '22px',
        xl: '30px',
        '2xl': '36px',
      },
      boxShadow: {
        /** 纸张卡片阴影，模拟贴纸浮起 */
        glass: '0 8px 0 rgba(32, 48, 74, 0.05), 0 18px 40px rgba(101, 81, 52, 0.10)',
        'glass-lg': '0 10px 0 rgba(32, 48, 74, 0.06), 0 28px 70px rgba(101, 81, 52, 0.14)',
        /** 主色按钮阴影 */
        glow: '0 8px 0 rgba(46, 72, 170, 0.18), 0 16px 30px rgba(77, 124, 254, 0.22)',
      },
      backdropBlur: {
        glass: '24px',
      },
      keyframes: {
        /** 光斑缓慢呼吸，营造流动感 */
        breathe: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '0.85', transform: 'scale(1.08)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        breathe: 'breathe 9s ease-in-out infinite',
        float: 'float 7s ease-in-out infinite',
        'fade-up': 'fade-up 0.6s ease-out both',
        shimmer: 'shimmer 2s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
