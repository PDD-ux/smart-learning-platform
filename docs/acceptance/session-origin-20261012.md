# §22.13 登录续期与退出来源修复

2026-10-12 17:55，Asia/Shanghai。只修B01会话来源错误。

根因：旧isSessionRequest将浏览器Origin直接与服务端request.url.origin比较。本地127与localhost、反向代理公开HTTPS与内部HTTP可能不一致，误拒合法续期/退出，表现为多个页面读取失败。

修复：APP_URL明确可信公开origin；本地localhost/127.0.0.1仅同协议同端口互认。公网严格使用配置公开源，不信任Host/X-Forwarded-Host；生产缺APP_URL拒绝、开发无配置保留严格request.url同源回退。Origin必须是规范origin，不含路径/凭据/片段；X-Session-Refresh=1、cross-site拒绝保留。没有改变Cookie安全属性、刷新期限、密码/角色校验，没有关闭CSRF保护、轮换原密钥或自动重放业务写请求。

代码：src/lib/auth/same-origin.ts；新增tests/unit/auth/session-origin.test.ts；新增scripts/acceptance/session-origin.ts。真实验收只用服务端签发的临时账号令牌，不依赖CLI与网页的签名密钥一致，令牌元数据只用于期限比较，授权由真实接口验证。

55项相关回归全部通过（来源边界、公开HTTPS/内部代理URL、伪造Host、协议/端口、缺保护头、Cookie续期/过期/角色/客户端并发及页面）。TS/ESLint通过。真实HTTP 16/16通过：两个本地源续期200、profile200、logout200/清Cookie、固定原期限且不轮换refresh、外站/错误端口/缺头/cross-site403不清有效Cookie、改密码后原refresh401。临时账号清理完成；原账号密码、资料/学习记录未修改。

隔离生产快照构建/standalone启动通过，真实登录200/Secure+HttpOnly、授权内容200、匿名401、学习者管理403、退出200。没有改运行网页.next或原.env密钥；临时生产账号/快照/3100进程清理。未验公网HTTPS，公开源代理策略由边界回归验证。

真实Edge原已登录会话在新临时标签自动恢复，工作台资料/计划/打卡状态/22XP正常读取；题库5题正常显示。未代用户答题、打卡、生成题、修改计划或输入密码，未改变桌面viewport；原PDF标签保留，临时标签关闭。截图dashboard-restored.png、question-bank-restored.png及HTTP/生产报告在.taskbook-working/session-origin-20261012。

剩余：B02出题占位选项、B03长PDF章节覆盖、B04启动预检.env加载问题、B05失败上传残留、R01生产PDF/ASR资产缺失没有在本编号修复。截图asr blocked属于B04；face未启动属于环境阻塞。不能宣称全项目无bug。

复现（新输出目录，先启动网页）：
```powershell
npx tsx scripts/acceptance/session-origin.ts .taskbook-working/<新目录>
npx vitest run tests/unit/auth/session-origin.test.ts tests/unit/api/auth-refresh.test.ts tests/unit/api/client-session.test.ts tests/e2e/session-page.test.tsx
npx tsc --noEmit
```

同步TASKS/PROGRESS、ARCH/DATA、DEPLOY、LEARNINGS；无TODO补全，非TODO修改为可信来源契约与真实验收。没有依赖、表或页面交互变化。
