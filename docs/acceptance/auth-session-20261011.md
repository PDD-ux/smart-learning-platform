# §22.1 登录续期与会话保护验收

2026-10-11 21:40，在桌面主仓库完成用户确认的单个任务。此前客户端只有15分钟access，没有利用已有HttpOnly refresh续期，长时间演练会跳回登录。新增同源续期、用途校验及共享客户端恢复；不新增学习模块、表、依赖或AI调用。

## 实现及使用

- 业务请求发现access临近过期时先续期；已发出的读取请求明确返回UNAUTHENTICATED时最多重读一次。续期更新令牌，保留页面实例、会话和未提交输入。
- 同页并发共享一次续期，单次最多15秒；取消一名等待者不取消其它请求。退出、重新登录及跨标签存储变化使旧响应失效。身份不同不能把旧请求交给新账号。
- 已发出的作答、保存、生成、删除等写请求遇到401不自动重放；续期成功提示本人核对状态后手动重试。请求前成功续期后，尚未发出的写请求只发送一次。
- 网络/503/429/来源403保留本地会话与输入；确认refresh失效才清除并回登录。旧版无用途标记的refresh不可续期，升级后旧会话可能需本人登录一次。
- 未勾记住我：refresh签名和Cookie均最长min(2小时,配置期限)；勾选后使用原配置期限，默认30天。只续access且不超过refresh剩余期限，不延长原登录截止时间。
- refresh仅HttpOnly Cookie，POST要求同源Origin、固定自定义头及非cross-site请求，30次/分钟/IP；HS256及access/refresh用途分离；每次读数据库当前账号/角色并复核私有密码版本。账号删除或密码修改拒绝旧refresh。成功不返回刷新令牌、密码哈希或版本摘要，no-store；临时数据库错误不清Cookie。
- logout改为同源幂等清除Cookie，access过期仍可退出。保持无状态JWT边界：没有全设备服务端撤销，已签access仍在其短期限内有效；客户端竞争保护不等于服务器撤销所有被复制的JWT。

## 修改文件

认证实现：`src/lib/auth/jwt.ts`、`session.ts`、新增`same-origin.ts`；新增`src/app/api/auth/refresh/route.ts`，更新login/register/logout/face登录路由及`src/lib/face/login.ts`的私有签发资料。统一客户端在`src/services/api.ts`，没有将fetch散落到页面。

新增`tests/unit/api/auth-refresh.test.ts`、`client-session.test.ts`及`tests/e2e/session-page.test.tsx`；同步旧auth-helpers与架构鉴权契约测试。新增可复现入口`scripts/acceptance/auth-session.ts`。同步PRD、DESIGN、ARCHITECTURE、DATA-MODEL、TASKS、PROGRESS及LEARNINGS；本轮没有TODO补全，修改非TODO内容是为了明确已授权的续期行为、实际认证接口数和验收结果。

## 验证结果

- 21:33真实Next.js HTTP + PostgreSQL隔离验收23/23通过：真实密码登录、HttpOnly、固定期限、过期access 401→refresh 200→profile 200、学生管理入口403、用途错用/过期/缺失/旧refresh 401、跨站403、75秒剩余期限上限、数据库当前角色、密码变更/删号拒绝及过期退出清Cookie。临时账号XP=0、无内容/笔记/掌握/计划/打卡，最后已清理。
- 21:37认证/客户端/壳层/助手/计划相关15文件149项通过。新增页面集成使用真实AssistantPage、AppShell和共享客户端，仅HTTP响应为替身：证明成功续期保持问答、草稿、选中资料和输入节点；暂时失败保留Agent目标及37分钟预算，不发Agent写请求。这是组件回归，不是真实模型或浏览器等待到期。
- 最终全量单进程114文件838/838通过，记录于`.taskbook-working/auth-session-20261011-checks-2/vitest.json`。TypeScript strict、定向16文件ESLint及范围内CRLF-aware差异检查通过。随后只调整JWT类型收窄及注释，类型/对应ESLint再通过，运行行为不变。
- 并行全量21:33最初836项中两项失败：新迟到401测试的前后模拟令牌相同，改成600秒旧令牌后19项客户端测试通过；另一工作台测试在统计仍加载时断言0。第二轮838项中仅计划测试在列表仍加载时找“标记完成”失败。两个原页面测试均模拟整个API、不走本轮共享客户端；单独及最终串行通过。本轮没有修改这些页面/测试，不将复测通过写成偶发性已消除；并行报告保留在checks-1。
- 实际浏览器从本人已登录的工作台进入助手，真实资料选择、学习者22 XP、模式及输入区正常加载。截图：`.taskbook-working/auth-session-20261011-http-2/assistant-loaded.png`。没有重启网页、注入浏览器凭据、代填密码、发起模型问答、作答或保存计划；没有在真人浏览器强制修改期限/等待15分钟，真实过期恢复由隔离HTTP验证，草稿保持由页面集成验证。
- 原30分钟资料`cmuqhyf7h00027q29tijy4uer`的十类保护指纹，前后均为`41f1b98ec505ddb505257d89f2ef6ff21cf6c18535e72903268334bfb425e444`。原三份演示资料及XP、笔记、作答、计划等未改；指纹不包含缓存播放进度与登录元数据。只读结果在auth-session-20261011-before-1/after-1，modelCalled=false。

## 复现

先启动桌面主仓库本地网页与原PostgreSQL，变量仍在本机，固定目标`http://localhost:3000`。使用新的结果目录：

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
npx tsx scripts/acceptance/auth-session.ts .taskbook-working/auth-session-repeat-1
npx vitest run tests/unit/api/auth-refresh.test.ts tests/unit/api/client-session.test.ts tests/e2e/session-page.test.tsx
npm run type-check
npx vitest run --maxWorkers=1 --minWorkers=1
```

入口只创建自身随机账号；密码、JWT、Cookie和版本摘要只留内存，不写报告或控制台。结果目录须为.taskbook-working的新直接子目录，现有目录/越界路径拒绝；本次实测拒绝两者、旧报告哈希不变、没有创建越界目录。退出码0表示检查与清理通过，1表示失败；失败报告保留已执行的检查及清理状态，清理未通过时需要先核对本轮账号，不能批量清理其它账号。第一轮因验收脚本把Cookie Expires的逗号当分隔而失败，已清理；改用getSetCookie逐Cookie解析后新目录http-2全部通过，http-1失败证据保留。

收尾复核将验收Schema的data/user设为passthrough，保留原始未知字段后再检查私有字段；不能依赖校验器自动删除字段的结果证明响应没有泄露。新目录`.taskbook-working/auth-session-20261011-http-3`再次真实23/23通过、临时账号清理完成，TS strict与入口ESLint再通过；此前HTTP成功报告和失败证据均保留，产品代码没有因此改动。

§22.1没有剩余必需实现/验收。并行页面测试偶发性和未来生产部署属于后续工作；本轮没有执行其它建议或改变模型配置。
