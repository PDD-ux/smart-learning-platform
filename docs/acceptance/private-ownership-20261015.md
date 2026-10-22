# §25.10 私人资产归属修复验收

完成时间：2026-10-15 15:46（北京时间）。工作目录：桌面主仓库。只执行25.10，25.9仍待完整复验。

根因：ownership.ts原先对JWT role=admin直接放行，旧单测还明确要求跨owner管理员通过。单条和批量校验现均严格按owner匹配，缺失用户标识失败关闭，403不返回resourceOwnerId。已检查所有调用点和私人聚合/计划/图谱查询，管理员专用管理接口保持各自角色边界。具体契约见spec/13-PRIVATE-OWNERSHIP.md。

验证结果：

- `npx vitest run tests/unit/auth/middleware.test.ts`：23项通过，含管理员本人/他人、批量所有角色及缺失标识。
- `npm test`：151文件、1184项通过；`npx tsc --noEmit`和`npm run lint`通过。第一次tsc与Next重生成类型并行出现TS6053，网页稳定后重跑通过，未修改编译设置。
- 自建三秒视频/两页PDF/TXT，两个学习者和临时管理员，33项共享准备HTTP通过；没有发布原资料。
- 98项权限HTTP通过：私人详情、笔记、资源、进度、图谱、生成笔记、理解与状态本人200；他人学习者及管理员403。跨owner改标题、删资料、增改删笔记、导出、写进度、完成上传、重试解析、重新整理、摘要、问答、作答和复习均403；计划跨owner改删404、创建403，聚合笔记404及题目/复习列表空集符合原契约。
- 阻断前后回读临时资料、笔记、知识点、整理笔记、任务、进度、复习卡和作答数一致，计划未被完成。没有触发模型、ASR、Ascend或新解析任务。
- 本人标题/笔记增改删、导出、128字节Range206、规则判断题、复习及计划成功；管理员本人资料改写/笔记增改删和删除自建TXT成功。管理员总览、用户、签到、课程、讨论200，学习者访问对应管理接口403。
- 临时账号、私人内容、笔记、练习、计划、课程、讨论、举报、事件、通知、审计回读0；仅删除已核实绝对根路径及临时ID的文件。临时凭据文件移除。原学习数据、.env/.env.local指纹一致，7条保留资料媒体SHA256一致。
- 普通demo:start运行，本地CPU人脸modelsLoaded=true、scan模式。正式交流默认关闭，无新依赖、迁移、生产构建或UI改动。

本地证据位于`.taskbook-working/private-ownership-20261015/`：targeted.log、regression.log、typecheck.log、lint.log、http.json、shared-preparation-http.json、cleanup.json、protection.json、media-protection.json。日志不保存密码、JWT、密钥、原笔记或签名URL。

复现入口（仅对临时自建数据运行，不能替换为真实用户ID）：

1. 启动普通网页，执行`node .taskbook-working/demo-walkthrough-20261014/protect.cjs before`与当前证据目录的`media-protect.cjs before`。
2. 执行`.taskbook-working/shared-course-20261014/accept.cjs`创建三个临时账号、媒体及共享副本；再执行当前目录`journey.cjs seed`。
3. 执行当前目录`accept.cjs`，期望98项HTTP通过。脚本含本人删除自建TXT，完整重跑需要先清理再重新建立夹具；不反复登录绕开限流。
4. 依次执行当前目录`cleanup.cjs private`、共享目录`accept.cjs cleanup`、当前目录`cleanup.cjs`，最后执行原数据与媒体保护脚本`after`并确认结果全true。任何失败均应完成本次夹具清理，不能删除原资料。

这次单项修复不追溯撤销此前已签发链接，其过期仍按现有签名契约。没有执行本轮浏览器全流程、新生产、公网、S3或陌生人访谈；下一项按25.9重新核销完整验收，再考虑正式开放。
