# §25.2 用户导航、使用指南与新手指引

完成：2026-10-14 09:03，北京时间。桌面主仓库；仅此编号，无模型请求/账号字段/数据库迁移/新依赖。

AppShell七个可用学习入口按三组呈现，“工作台”改“我的学习”，顶栏增加/help使用指南与既有打卡/人脸设置，退出可见。attendance当前态移到顶栏设置，不把计划标为当前；原学生管理权限/AdminShell不改变。未上线notes/messages/courses无链接。

LearningGuide四步为导入→看内容记笔记→练习→复习，可点击或Enter收起重开，不清页面输入或记录学习成绩；成功空库默认展开，已有资料默认收起，失败/未知不称空库。Dashboard空库主按钮导入第一份资料，其他账号保留真实待办。/help默认展开，可从帮助重新打开，七模块说明/入口及AI额度、临时笔记保存、打卡和连接失败边界清楚。只复用原profile/资料读取，不新增fetch或写业务记录。

代码：AppShell、LearningGuide、help/page、dashboard/page、globals.css；attendance、study-plans及FaceLoginPanel仅同步“我的学习”名称。DESIGN/ARCH/VISUAL/07非TODO同步已上线呈现，TASKS/PROGRESS/LEARNINGS更新，无TODO补全。

首轮6文件38项中37通过、1失败：原主流程要求attendance高亮学习计划，与新顶栏设置当前态冲突；更新为计划不高亮/顶栏aria-current=page，原失败日志保留。最终9文件66项相关回归退出0，TS/完整lint通过。覆盖新指引开关/帮助入口/空库与失败、AppShell读取、主流程、计划、人脸页面及管理员壳。未重复历史全量，不称新生产构建通过。

真实浏览器隔离空库学生：导入主入口、四步默认展开、Enter关闭重开、帮助/学习中心/打卡跳转成功；已有资料学生默认收起，再打开帮助成功。桌面1280/文档1272px无横向溢出；900/892px单列指引及模块。初次900px隐藏搜索按钮但容器仍占宽导致退出换行，修隐藏容器后指南/设置/退出同一top=15且height=44，保留初次与最终证据；临时视口已reset，不让用户页面保留窄尺寸。

DB两个临时账号XP0，0笔记/作答/复习日志/计划/签到，原共享媒体只读；旧测试账号1资料，新账号0。会话退出/标签关闭，临时账号及归属资料清理，原学习数据与两env指纹一致、共享媒体保留。证据在.taskbook-working/learner-navigation-20261014：tests.log/tests-final.log、types/lint.log、new-dashboard/existing-dashboard/help.txt、help-final.png、desktop/narrow/narrow-final/verification/cleanup/second-cleanup/protection.json。私有凭据不输出，临时账号已删除。

本轮未测试手机全尺寸、生产构建/公网、真人摄像头或新模型质量，未实际导入或本人打卡；管理员独立导航通过相关组件回归，本轮无新管理员浏览器登录。25.3学习页显露尚未实施，讨论/消息/共享及笔记聚合仍待对应编号。
