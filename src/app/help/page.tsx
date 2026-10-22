'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { AppShell } from '@/components/app/AppShell';
import { LearningGuide } from '@/components/app/LearningGuide';
import { SharedInteractionGuide } from '@/components/app/SharedInteractionGuide';

const modules = [
  { title: '智能批改与订正', href: '/homework', action: '打开智能批改', description: '粘贴本人作业或选择4MiB以内TXT/MD/PDF/PNG/JPEG；PDF最多20页。也可从本人班级已交版本校对正文或附件。逐题核对题目、答案和本人提供的参考依据，确认冻结后明确选择最多8题发起AI建议。报告展示逐字依据、规则比对和待核验项，可追加订正。AI建议不改变班级正式成绩，图片识别失败时可手工补录；请保留原文件。' },
  { title: '班级课程', href: '/classes', action: '打开我的班级', description: '学生用邀请码确认加入班级，按章节阅读授权资料，查看任务和截止时间。负责人在管理中心创建班级、管理成员并发布章节和任务；私人资料不会自动共享。学生保存草稿、上传允许的附件并明确提交，负责人可批阅或退回；学生在截止前修改重交并查看本人历史反馈。智能批改是独立的本人学习建议，不代替负责人批阅。' },
  { title: '学习资料', href: '/import', action: '进入学习中心', description: '选择已有资料继续阅读，或上传视频、图片、PDF、EPUB、Markdown/TXT，也可预览公开文章/PDF链接或粘贴本人正文后确认保存。书籍按目录选段提取，章节原文笔记、摘录批注和专题提问都在学习中心内；引用按真实时间点、页码或段号回看。局部提取不代表整本已理解，个人资料不会自动公开。' },
  { title: '我的笔记', href: '/notes', action: '查找已保存笔记', description: '学习中心顶部切换“我的笔记”，按资料或关键词查询、编辑和导出。预解析重点与未保存随看草稿不计入个人笔记，先在学习页保存。' },
  { title: 'AI 学习助手', href: '/assistant', action: '核对资料原文', description: '学习中心顶部切换“AI 学习助手”，选择已解析资料，手动发送问题并核对出处。练习/复习建议收在“更多学习工具”中；关闭面板不会自动发送请求。' },
  { title: '练习与复习', href: '/question-bank', action: '查看练习题库', description: '学习中心顶部进入“练习与复习”，内部切换“练习题库、复习巩固、知识图谱”。作答后看来源，复习先回忆再自评；知识图谱直接选点回看。历史错题包含后来答对的题，自评不等于客观测验。' },
  { title: '学习计划', href: '/study-plans', action: '打开学习计划', description: '工作台集中续学和提醒，顶部切换“学习计划”安排学习时间。完成与撤销由本人确认，目标分钟和每日打卡都不代表实际学习时长。人脸登录设置保留在顶栏。' },
];

export default function HelpPage(): ReactElement {
  return <AppShell title="使用指南"><div className="learner-help">
    <header><h1>使用指南</h1><p>从工作台选择资料学习、班级课程或智能批改；具体步骤和辅助工具在各主线内。随时从顶栏回到这里查看。</p></header>
    <div id="start"><LearningGuide initiallyOpen /></div>
    <SharedInteractionGuide />
    <section aria-labelledby="help-modules-title"><h2 id="help-modules-title">各个功能在哪里</h2><div className="learner-help-modules">{modules.map((module): ReactElement => <article key={module.title}><h3>{module.title}</h3><p>{module.description}</p><Link className="learner-text-action" href={module.href}>{module.action} →</Link></article>)}</div></section>
    <section className="learner-help-notes" aria-labelledby="help-notes-title"><h2 id="help-notes-title">使用前知道这几件事</h2><ul><li>已有解析资料可以直接阅读和播放。视频页“随播放AI整理”默认开启，使用在线AI额度；只看已有重点时可取消勾选。</li><li>随看笔记暂存在本页，点击“保存到我的笔记”才会落库；离开前确认已保存或导出。预解析笔记、原文转写与个人补充是不同内容。</li><li>AI回答、摘要和出题依赖在线服务；失败时保留输入并手动重试，已有资料阅读和个人笔记仍可使用。模型生成的内容需要与原文核对。</li><li>密码登录后需手动打卡。人脸登录是可选设置，先用密码登录并主动授权录入；管理员使用密码。</li><li>遇到加载失败，先点击页面对应的重试；连接失败时检查本地网页服务是否仍在运行。请勿为了一次读取失败重复上传或提交。</li></ul><Link href="/attendance" className="learner-text-action">打开打卡与人脸设置 →</Link></section>
  </div></AppShell>;
}
