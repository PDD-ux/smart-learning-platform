# §25.5 共享课程发布与只读学习

2026-10-14 14:41，桌面主仓库，只执行25.5。07边界先补08具体契约后实现。SharedCourse独立表/迁移，原source/publisher删除SetNull；不复制个人Note、QA、成绩、进度或人脸。新准备的独立媒体/全部PDF页图及白名单snapshot成功后才可预览并明确发布；原三份资料未公开，没有正式素材传播授权推断。

## 修改文件与职责

prisma/schema.prisma及20261014060000_shared_course/migration.sql；src/lib/courses/contracts.ts/service.ts/routes.ts负责DTO/快照/准备/清理/权限/CAS及无缓存鉴权流，八个新API路由仅编排；storage.ts仅增S3流写内部contentLength。auth/middleware.ts修原Cookie格式兼容及固定异常日志。services/api.ts封装新调用；CourseLibrary/CourseReader、/admin/courses、/courses/[id]及import/AdminShell/help/globals.css负责入口和纸张样式。对应API/页面测试和架构委托测试同步。PRD/DESIGN/ARCH/DATA/VISUAL/07/08/DEPLOY及进度/踩坑同步非TODO状态/契约；无TODO补全/新依赖。

## 工程结果

validate/migrate deploy/generate成功，新增一张表，原数据不reset。因Windows客户端需生成，停止本次自己管理的Next后恢复demo:start，保留face服务。最终TS/lint退出0、1119项/141文件全量通过（regression-complete.log）。之前静态路由测试只允许字面withAuth/response，改为只对新课程薄路由严格检查sharedRoute真实委托链；原鉴权契约与实际401/404测试仍保留。帮助模块同href重复key修正；新文件保留测试在选择区/状态区有重复文本，校正断言后通过。最终小范围文案同步不改行为。

## 真实隔离验收

accept.cjs两次各33项HTTP：三秒自建无音视频、手写两页PDF及自写TXT夹具；手工解析样例只用于功能验证，不是模型真实生成效果。管理员和两学生均新隔离账号。准备必须本人READY/rightsConfirmed及授权说明，学生403/他人来源404/缺授权400；准备草稿学生详情/媒体404；同requestId同payload相同ID、不同payload409；发布版本1→2、旧版本动作409。学生DTO无私有笔记标记/源ID/存储键/发布者账号/授权说明。

视频Range206/正确字节和Content-Range，HEAD无正文、非法多Range416、匿名401、无302；复制媒体与原夹具字节完全一致。修改/删除原夹具后副本及快照仍可读，来源ID置null。下架旧详情、HEAD、后续Range与PDF页图404，恢复仍是独立副本。PDF全两页预生成、真实PNG成功及越界400；TXT以text/plain/nosniff输出，包含script字样也不按HTML执行。分页pageSize2在3课程中2+1，活跃管理员角色降级后旧JWT403。

partial-failure.ts真实本地存储注入“写完媒体后异常”，准备失败，所写私有前缀及预留草稿已删除，原TXT指纹不变。final.cjs状态并发同版本：一200一409且只增一次版本，学生Note/进度/计划/XP仍0；删除发布者后source/publisher SetNull、媒体仍206，删号旧管理员401。orphan.cjs补验另一当前管理员能看到已公开副本并下架、不能重新发布（403），未发布外来/中断草稿列表不可见且详情404；旧学生Range404。此范围先调整08契约再编码，不授予他人原私有资料访问。

真实浏览器：自建管理员从专属导航进入表单，选择PDF/OCR及授权说明，准备后核对真实PNG625px，再确认发布；用户从学习中心共享标签发现4门临时课程。Cookie媒体首轮401：原Cookie是raw JWT，旧parseBearer不接受，修原有兼容后同页重试正常，不降低签名/用途/期限校验。显式无效Authorization不会回退Cookie；单测Happy DOM不保留构造Cookie头，用cookies.set建立Cookie值。

学生视频真实duration=3、来源按钮定位currentTime=1且paused=true；PDF第2/2页complete/naturalWidth625，HMR变更key重挂后在最新页面重新核对。1280/1272、900/892无横向溢出；学生可见笔记/媒体按钮最小44px，管理员900无溢出。库页/只读页截图library-final.png/course-final.png；未把手工样例当真实AI/原课堂质量。退出关闭临时标签、viewport reset，未操作原用户标签。原生MD/TXT iframe只读，文件字节/MIME由HTTP验证；图片类型/S3/长资料未另做真实专项。

## 清理与复现

临时课程和账号最终均0，actor审计清理；只删除经root前缀及具体fixture id验证的shared-courses/UUID与contents/shared-source-UUID目录，不碰原三份。原学习数据/.env/.env.local哈希一致（protection.json），网站3000和face8002保留。正式共享素材没有选择，最终共享列表为空。

本地复现：demo:start运行网页；protect.cjs before（demo-walkthrough目录）；accept.cjs setup生成隔离账号/自建源及33项验证；用其本机private.json登录核对页面（勿公开临时凭据）。可运行tsx partial-failure.ts、final.cjs和orphan.cjs；顺序后者依赖前者已删除发布者。清理前private.json的courses必须包含本次所有副本（final.cjs收集；若另从页面创建副本，应先收集本人course id），accept.cjs cleanup再protect.cjs after检查三项true。本轮清理脚本按已记录唯一课程ID处理，已验证prefix与来源夹具前缀；重复setup前先完成前次cleanup，避免遗留隔离数据。

S3真实服务/公网HTTPS/新生产构建、长PDF准备与压力、真实素材传播授权未验；复制进程被强制结束会留下preparedAt=null的不可发布草稿，存储删除故障可遗留私有对象并记录UUID，需维护人员核对独立前缀，不能声称任意外部环境无故障。未调用模型、ASR、云端或训练，也未实现25.6讨论/25.7管理/25.8消息。
