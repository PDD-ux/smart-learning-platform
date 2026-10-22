# §25.3 学习页功能显露与下一步

完成：2026-10-14 09:21，北京时间，桌面主仓库。本编号保留原私有权限；无新API/数据表/依赖、云服务启动/模型请求或本人学习操作。

学习页标题下直接提供随看笔记/我的笔记/预解析重点，文档无视频随看。点击只打开原details/切原笔记面板并滚动；播放器、WatchedNotes与PlaybackNotes保持原key和实例，正文/草稿/保存状态不重挂载。底部StudyNextSteps带contentId到题库、计划、助手。计划/助手新增客户端导航预选，在本人列表校验，显式无效/重复值不回退首项；目标query变化workspace重挂载使旧active守卫拒绝迟到回答，同范围重读保留手动选择。未上线讨论不显示。

永久代码：study/[id]/page、StudyNextSteps、content-selection、study-plans/page、assistant/page、globals.css。相应测试和PRD/DESIGN/ARCH/DATA/VISUAL/07、TASKS/PROGRESS/LEARNINGS同步。无TODO补全，非TODO修正当前入口及历史“无播放生成AI”陈述以匹配§23.2。

最终8文件78项相关回归退出0，TS/完整lint通过。覆盖播放器实例/时间和两种草稿、已生成随看批次及保存标记、文档不出现视频工具、原读取/失败/定位/轮询、计划与助手预选/非法参数，以及换query后拒收旧回答。随看生成与保存标记为替身服务回归，不冒充本轮真实模型质量验收。

首次测试68项通过，但新增Testing Library role选项误用exact导致后续TS两错误；保留types-first-tests.log并修正。初始文档iframe样例请求测试宿主有连接警告，改图片样例后最终相关回归无该网络警告。没有隐藏失败或放宽判断。

真实浏览器只对临时学生操作：复制既有30分钟媒体键、510段转写/5原点与历史笔记只读副本，另有第二份干扰资料，避免误把“默认首项”当正确预选。视频t=247保持暂停，禁用随播放AI整理；预解析补充草稿和编辑中的个人笔记经过三快捷入口切换仍保留，时间247。实际保存修改及补充，DB分别为ref12/version2和ref247/version1；按个人笔记0:12回看实际time12，随后暂停。首次开关在hydration未完成时未变，读状态后重试成功；没有播放到模型整理阈值。

从底部链接实际进入计划、助手、题库，三选择器均选当前资料而非列表第一份干扰资料；未提交计划/提问/作答。真实无效助手query未选择且无提问框。浏览器局部标签定位/动态题数等待超时后以当前AX及可见select核对成功，未将工具等待失败当业务错误。桌面1280/1272px、窄窗口900/892px无横向溢出，三快捷按钮/三下一步链接均44px；视口已reset。

DB最终2笔记、0计划/作答/复习日志、XP0，选择器和保留状态证据核对一致。退出/关闭临时会话，归属检查后删除临时学生及两份内容，原共享媒体保留，原学习数据/.env/.env.local指纹一致。证据：.taskbook-working/study-discovery-20261014下tests/types-first-tests/types-final/lint日志、retained/player-before/jump/desktop/narrow/plan-selection/assistant-selection/bank-selection/invalid-selection/verification/cleanup/protection.json及study-final.png。private凭据不输出，账号已清理。

本人摄像头、手机全尺寸、新生产/公网、新模型语义或完整30分钟播放未验；文档工具为组件回归，未再上传PDF。个人资料列表超过当前已加载范围的目标会明确不可用，不绕过列表查询权限。25.4笔记聚合、共享/讨论/消息等后续编号尚未实施。
