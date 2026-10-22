# §24.4 学习助手场景引导验收

完成：2026-10-13 23:52，北京时间。仅加强既有助手交互，不改学习中心、模型、公开API、数据库或依赖。

修改src/app/assistant/page.tsx：三个Agent入口分别核对原文、诊断练习、安排复习，说明结果边界并只填写草稿。请求及计划保存忙碌期间禁用入口；手动发送、范围切换清空、模型失败保留原问题继续使用既有流程。资料问答模式保留问题建议。回答没有引用时明确提示回看所选资料，不把复习建议称为原文证明。

修改src/components/assistant/AgentActions.tsx：没有推荐题时进入当前资料题库；方案区显示预览尚未保存、保存状态待核对或已保存计划。既有显式保存/状态核对/练习隐藏不卸载保护不变。

修改tests/e2e/assistant.test.tsx，新增三个入口无请求/无保存、忙碌锁与模型失败保留草稿、无引用/资料限定入口及方案预览状态测试。命令：

- npx vitest run tests/e2e/assistant.test.tsx tests/unit/api/learning-agent.test.ts：24项/2文件通过。
- npm run type-check：通过。
- npx next lint --file src/app/assistant/page.tsx --file src/components/assistant/AgentActions.tsx：无warning/error。

首次新增JSX缺闭合div导致组件编译失败；补齐后最终回归通过，tests.log与tests-final.log分别保留。Vite CJS弃用提示与负向接口的安全错误码日志为既有测试输出。

实际内置浏览器：临时学习者/原媒体只读副本，三个入口分别填入对应草稿，没有点击发送；资料问答切换草稿清空、问答建议可填，返回Agent草稿再次清空。1280px视口、1272px文档宽，无横向溢出，三张卡288×114px。电脑端截图page.png及drafts.json/agent.txt/qa.txt/layout.json留证；没有提交模型问题、练习答案或计划保存。

临时退出登录、关闭标签并清理账号级联记录，共享媒体仍存在且大小一致；原学习数据/.env/.env.local指纹一致。初始verify脚本误用userId（真实ExerciseRecord字段为learnerId），未取得清理前计数；保留verification-initial-failure.json，修正后verification-after-cleanup.json只证明清理后0计划/笔记/作答和账号不存在，不作为清理前无写入证据。

忽略目录.taskbook-working/assistant-guidance-20261013含setup/verify/cleanup/protect脚本和上述证据。private.json为已清理临时账号凭据，不提交。DESIGN/VISUAL更新非TODO交互与呈现要求，无TODO补全；TASKS/PROGRESS/LEARNINGS同步。

本轮没有新真实模型回答、手机、新生产或全量复验；引用和方案保存状态通过组件/接口替身回归，不能冒充新语义质量或供应商可用性验证。24.5及后续留待下一轮。
