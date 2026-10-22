'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { api, ApiClientError } from '@/services/api';
export function SharedInteractionGuide(): ReactElement {
  const [state, setState] = useState<'loading' | 'open' | 'closed' | 'error'>('loading'), [revision, setRevision] = useState(0);
  useEffect((): (() => void) => { let active = true; setState('loading'); void api.messages().then((): void => { if (active) setState('open'); }).catch((cause: unknown): void => { if (active) setState(cause instanceof ApiClientError && cause.status === 404 ? 'closed' : 'error'); }); return (): void => { active = false; }; }, [revision]);
  return <section className="learner-help-notes" aria-label="课程交流与消息指南"><h2>课程交流与消息怎么用</h2><ol><li>在学习中心切换“共享课程”，打开管理员已授权发布的课程；原来的“我的资料”仍是私人空间。</li><li>课程交流开放时选择“课程讨论”，发提问或心得、回复同学，可附实际秒数或页码回看。个人笔记仍在“我的资料”学习页保存。</li><li>顶栏“消息”查看主题新回复和本人举报处理结果，切换“我参与的讨论”回到主题；点击回看不自动标已读。</li><li>遇到不合适的内容，在主题详情展开“举报当前讨论内容”；处理和隐藏是管理员分别确认的动作，作者已解决不等于标准答案。</li><li>课程关闭讨论后仍能阅读已有主题和提交举报；下架、隐藏或删除的目标不能通过旧消息继续访问。</li></ol>{state === 'loading' ? <p role="status">正在核对共享交流入口…</p> : state === 'open' ? <Link className="learner-text-action" href="/messages">打开消息与参与记录 →</Link> : state === 'closed' ? <p>共享交流当前未开放，个人学习功能可以继续使用。当前没有共享课程时，也不代表你的私人资料丢失。</p> : <div role="alert"><p>共享交流状态暂不可用，请重试核对。</p><button className="learner-text-action" onClick={(): void => setRevision((value): number => value + 1)}>重试交流入口</button></div>}<p><Link className="learner-text-action" href="/import">到学习中心查看两种资料空间 →</Link></p></section>;
}
