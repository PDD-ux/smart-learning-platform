'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';

const steps = [
  { title: '学习中心：导入与笔记', description: '导入有权使用的视频、书籍或公开文章，选段阅读并保存带出处的笔记。', href: '/import', action: '打开学习中心' },
  { title: '班级课程：任务与反馈', description: '学生用邀请码加入班级、提交作业并查看负责人的批阅；负责人在管理中心创建班级与发布任务。', href: '/classes', action: '打开班级课程' },
  { title: '智能批改：校对与订正', description: '导入本人作业并逐题核对依据，再明确发起AI建议；错因与订正只供本人学习，正式成绩由负责人批阅。', href: '/homework', action: '打开智能批改' },
];

export function LearningGuide({ initiallyOpen = false }: { initiallyOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(initiallyOpen);
  return <section className="learning-guide" aria-label="新手学习指引">
    <div className="learning-guide-heading"><div><h2>第一次使用，从这里开始</h2><p>三条主线分别是资料学习、班级课程和本人作业的辅助批改。</p></div><button type="button" className="learner-text-action" aria-expanded={open} aria-controls="learning-guide-steps" onClick={(): void => setOpen((value): boolean => !value)}>{open ? '收起新手指引' : '打开新手指引'}</button></div>
    {open && <ol id="learning-guide-steps" className="learning-guide-steps">{steps.map((step, index): ReactElement => <li key={step.title}><span className="learning-guide-number" aria-hidden="true">{index + 1}</span><div><h3>{step.title}</h3><p>{step.description}</p><Link className="learner-text-action" href={step.href}>{step.action} →</Link></div></li>)}</ol>}
    <Link className="learner-text-action" href="/help#start">查看完整使用指南 →</Link>
  </section>;
}
