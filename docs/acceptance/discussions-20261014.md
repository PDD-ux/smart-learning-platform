# §25.6 课程讨论与回复验收

2026-10-14，本轮只实施25.6，桌面主仓库；具体字段与事务先落spec/09-DISCUSSIONS.md。仅自建三秒视频/两页PDF/文字及两个临时学习者，原三份私有演示资料不发布。无模型/ASR/Ascend请求、无新依赖、无私人学习记录写入。

## 已实现

- 共享课程内“课程内容 / 课程讨论”，切换隐藏保留播放器/输入，提问或心得、正文、可选实际整数秒/页码；引用回到共享媒体并暂停。
- 全部/我发布、最新/最早、分页、刷新、加载/真实为空/失败；单层回复，本人编辑/确认软删除，问题作者已解决/重开；失败保留正文与requestId，同步提交锁及迟到响应守卫。
- 两模型与20261014070000_discussions迁移，当前账号/课程published+prepared复查、纯文本/引用范围、作者权限（管理员也不能改他人正文）、幂等/CAS、10次/分钟限流、no-store；删号数据库触发器清正文及匿名化。隐藏/下架/删除的父链不能读到旧正文。
- 运行开关DISCUSSION_RELEASE_READY默认关闭；discussionAvailable决定入口，discussionEnabled决定写入。课程关闭仍可读已有讨论、本人可删除。管理/举报和消息尚未实现，正式开放须完成25.7–25.8。
- 最终补齐关闭门控优先于参数/JSON校验：已登录请求统一404，不因非法入参返回400；6项门控回归及最终全量已通过，不查询数据库或写入内容。

## 验证结果

- Prisma validate、migrate deploy、generate成功；没有reset/db push。
- 全量1145项/144文件通过（regression-final.log）；30项针对性检查通过；TypeScript严格检查、完整lint通过。
- 真实62项HTTP检查：双学生发帖/回复/编辑/软删除，匿名401、学生及管理员越权403、纯文本/额外字段/非法分页/错误引用400、幂等重复只一审计、旧版本409、并发一200一409、删除重试不复活、隐藏及下架404、我发布筛选和排序、文档第2页有效/第3页拒绝、关闭后读取/本人删除、第11次限流429。见http.json。
- 删号4项HTTP及数据库检查：B回复body空/authorId空/deletedAt非空，返回匿名占位；旧B token401；A全部公开主题标题/正文/ref清空，主题及子回复404。见author-deletion.json。
- 浏览器A提交主题、B真实回复、B无编辑A主题按钮且可编辑本人回复；A填写草稿→引用跳转→返回讨论后成功发布，视频currentTime=1、paused=true。1280及900宽均无横向溢出，可见功能按钮≥44px，视口重置、临时标签关闭。desktop.png为实际临时课程入口截图，不代表正式课程已开放；全页截图工具未成功，保存可用视口截图。
- 恢复普通demo:start，默认门控返回404、课程详情discussionAvailable=false，原媒体仍200；本机3000及真实CPU人脸8002已恢复。云端/ASR就绪和额度不由本任务验证。
- 临时账号/课程/主题/回复/审计/独立副本及源夹具清理为0；保护指纹envUnchanged/localEnvUnchanged/learningDataUnchanged均true，随机临时凭据文件移除。见cleanup.json/protection.json。

## 可复现入口与限制

在本仓库依赖/数据库/本地媒体工具已配置时，停止自己的演示进程，以进程环境DISCUSSION_RELEASE_READY=true启动npm run dev（不改.env）；运行node .taskbook-working/shared-course-20261014/accept.cjs setup创建自建隔离资料，再运行node .taskbook-working/discussions-20261014/accept.cjs。请求使用该次生成的临时账号，不使用真实账号/原资料。脚本中数据库直接改discussionEnabled/hidden/state仅作用自建UUID夹具，是25.7管理接口尚未上线时的权限状态验收方式，不是产品入口。

需人工浏览器完成双账号页面核对；之后运行accept.cjs final；恢复普通演示进程后运行accept.cjs off，再运行shared-course的accept.cjs cleanup及本目录cleanup-proof.cjs。保护脚本before须在创建临时资料前运行，after在全部清理后运行。验收脚本不可在已有未清理同名夹具时重复setup；先完成上一批cleanup。CPU/本地存储验收不代表生产/S3/公网或压力测试。未做新生产构建，不宣称全项目无bug。
