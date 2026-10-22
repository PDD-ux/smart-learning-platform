# §22.16 复习巩固中心验收 · 2026-10-13

完成时间：09:10（北京时间）。桌面主仓库本地演示，不是公网部署或整个项目零缺陷声明。

## 实现

/review 已替换旧翻卡/稀有度/即时出题界面：真实课程与知识点清单、按卡保留本页回忆草稿、先查看要点再四档自评、服务端实际复习时间与 XP、真实来源、按知识点筛选已有练习。熟悉度自评不等同题目判分。导航及工作台入口统一为复习巩固/待复习自测项，数据库表、旧卡ID、SM-2、掌握度、旧成绩均保留。

修改：src/app/review/page.tsx，src/app/question-bank/page.tsx，src/app/api/flashcards/route.ts，src/app/api/exercises/route.ts，src/lib/domain/flashcard-mapper.ts，src/services/api.ts，AppShell、dashboard、TodayLearningTasks及相关测试；新增scripts/acceptance/review-center.ts。同步PRD/DESIGN/ARCHITECTURE/DATA/VISUAL/TASKS/PROGRESS。没有引入依赖或迁移。文档无TODO补全，本次非TODO内容用于落实用户确认的新交互与接口边界。

## 完成的验证

- 最终全量回归：121文件、924测试通过（含旧任务回归）。TS严格类型检查通过；定向ESLint通过。全站next lint退出0，仍有layout字体及study原生img的3条既有警告，未隐藏警告。
- 复习模块真实HTTP/PostgreSQL：32/32检查。临时账号克隆原30分钟视频与222页PDF的已有解析产物，保留实际引用；不重新生成、不重跑OCR/ASR。四档评分0/1/2/3各一条真实日志，XP=0+2+5+10=17，两知识点掌握记录、下次日期与未来卡排除验证通过。非法评分400、外来卡/题目为空、外来评分与来源403；未作答答案不返回。
- 全站system-test：86/86通过，覆盖登录/续期/权限、资料访问、个人笔记增改删和冲突、每日打卡幂等、复习/掌握度、管理员增改删、隔离短文档上传与真实模型链路、Agent依据模式和页面HTTP。接口/HTML不替代所有页面逐控件浏览器验证，短讲义不等于222页全量理解。
- study-plans-bank：26项真实数据库与接口验证通过；session-origin：16/16通过、临时账号清理。Agent原课堂检索tools模式通过、原记录指纹相同；未调用生成式解释模型，不核销语义质量。
- 最后代码版本隔离生产build/standalone服务、真实登录、Secure+HttpOnly Cookie、本人资料、匿名401、学生管理员403、同源退出均通过（09:06:16）。未替换运行中.next，未旋转密钥；临时快照、服务器与账号已清理。不是公网HTTPS或完整生产导入资源验收。
- 本地ASR：原课堂535–565秒真实30秒WAV经固定hash本地模型执行完成，3条有效时间区间、无网络请求、无数据库写入。只证明有界样本可执行，不宣称长课转写准确率或整片新导入成功。

## 浏览器证据

Edge临时账号在localhost源验收，用户原127.0.0.1标签与账号未操作。宽屏1560px、窄窗口768px无横向溢出，结束恢复默认视口。核对答案初始隐藏/评分禁用、回忆草稿切换保留、写入中控件禁用、真实成功反馈及完成状态；实际题库深链接显示本知识点1题，未作答答案隐藏。取消范围和切换资料由组件及接口回归验证，未将即时加载中的计数断言为完成。

视频实际定位42秒、总长1800.032秒、readyState4/error=null且暂停；PDF实际第209/222页图片加载完成，naturalWidth1241。PDF暂无已有题目时明确空状态，未生成占位题。

浏览器发现来源与练习面板使用相同兄弟key，造成重复DOM，已给练习面板独立key；新增重复展开/收起/评分后的唯一性回归，刷新后单一来源面板。最终截图：.taskbook-working/review-center-20261013/review-completed.png；PDF截图pdf-source.png。早期宽窄截图为发现问题前记录，不用作最终无重复证明。

## 仍未通过或待后续处理

1. Ascend推理服务、人脸服务当前不可达。runtime预检明确blocked，现场新视频/图片导入预检未通过；已有资料可以展示。未启动计费Notebook或替本人用摄像头，不用历史推理结果冒充本次在线通过。
2. §22.15的222页知识点+闪卡完整质量验收和旧PDF安全补修仍未完成；保留原失败。星火Lite已知主体解释错误，AGENT_REVIEW_READY=false，维持证据模式；模型连接成功不证明解释/题目语义可靠。百炼额度门禁false。
3. 既有B04普通启动命令环境加载顺序、B05失败导入残留、R01生产PDF worker/CMap和Python ASR资产打包仍待专项处理。本次使用node --env-file前置加载验收，不记为普通启动器已修好。
4. 浏览器复习正文XP即时更新到17，但壳层头像/顶部XP仍显示本页初次加载的0，需后续统一账号统计刷新；未改真实积分。视频来源页曾同时显示资料失败提示与实际可播放视频，手动重新加载后消失，尚未可靠复现根因；保留候选问题，不写成已消除竞态。
5. 公网网站/HTTPS、真实摄像头登录及跨时段耐久性没有本次证据，不核销。

## 复现与清理

证据目录：.taskbook-working/review-center-20261013（忽略目录，private-fixture.json含测试凭据，不分享/提交）。

在桌面主仓库且本地服务运行时，用新的忽略输出目录执行：

```powershell
node --env-file=.env --env-file=.env.local --import tsx scripts/acceptance/review-center.ts setup .taskbook-working/review-repeat
node --env-file=.env --env-file=.env.local --import tsx scripts/acceptance/review-center.ts check .taskbook-working/review-repeat
node --env-file=.env --env-file=.env.local --import tsx scripts/acceptance/review-center.ts cleanup .taskbook-working/review-repeat
```

check会对临时卡评分，不操作本人。临时资料共享原媒体对象，cleanup只删除本轮数据库临时账号，绝不调用资料删除接口或删除共享storageKey。setup首轮因测试点缺importance失败已清理；补正后fixture-2成功。最终cleanup：cleaned=true、originalUnchanged=true、sharedMediaNotDeleted=true。system/生产/session自身账号也已清理。
