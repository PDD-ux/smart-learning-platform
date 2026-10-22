import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

const features = [
  ['01', '端侧视觉理解', 'MindSpore 识别照片、板书与教材文字'],
  ['02', '云端深度抽取', '自动生成知识点、闪卡和练习题'],
  ['03', '遗忘曲线复习', '用 SM-2 把看过的内容变成长期记忆'],
];

export function AuthShell({ children, title, hint }: { children: ReactNode; title: string; hint: string }): ReactElement {
  return <main className="auth-page"><div className="auth-aurora auth-aurora-one" aria-hidden="true" /><div className="auth-aurora auth-aurora-two" aria-hidden="true" /><section className="auth-story"><Link href="/" className="auth-brand"><span className="brand-mark">知</span><span><strong>文豪</strong><small>学习小宇宙</small></span></Link><div className="auth-story-copy"><p className="eyebrow">WELCOME TO YOUR STUDY DESK</p><h1>给自己的大脑，<em>一个好玩的学习角落。</em></h1><p>把视频、图文和拍照笔记放进来。我们帮你把它们变成会复习、会成长的知识卡片。</p></div><div className="auth-features">{features.map(([number, featureTitle, description]) => <div className="auth-feature" key={number}><span>{number}</span><div><strong>{featureTitle}</strong><p>{description}</p></div></div>)}</div><div className="auth-metrics"><span><b>3</b><small>步完成知识沉淀</small></span><span><b>SM-2</b><small>刚刚好的复习</small></span><span><b>∞</b><small>你的学习可能</small></span></div></section><section className="auth-panel"><div className="auth-panel-top"><span className="auth-panel-label">YOUR STUDY DESK</span><span className="auth-status"><i /> 今天也能学一点</span></div><div className="auth-card"><div className="auth-card-heading"><span className="auth-card-kicker">欢迎来到学习桌</span><h2>{title}</h2><p>{hint}</p></div>{children}</div><p className="auth-footer">文豪智能学习平台 <span>·</span> 让理解发生，让记忆留下</p></section></main>;
}
