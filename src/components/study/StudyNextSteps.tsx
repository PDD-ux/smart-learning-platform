import Link from 'next/link';
import type { ReactElement } from 'react';

export function StudyNextSteps({ contentId }: { contentId: string }): ReactElement {
  const query = `?contentId=${encodeURIComponent(contentId)}`;
  return <section aria-label="学习后的下一步" className="study-next-steps">
    <div><h2>学完这一段，接着做什么？</h2><p>以下入口会带上当前资料。创建计划、发送 AI 提问和开始作答仍由你确认。</p></div>
    <div className="study-next-links"><Link href={`/question-bank${query}`}>练习此资料 →</Link><Link href={`/study-plans${query}`}>安排学习计划 →</Link><Link href={`/assistant${query}`}>问 AI 助手 →</Link></div>
  </section>;
}
