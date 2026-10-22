# §26.5/26.6 收尾修复方案

2026-10-15，先于实现。用户明确要求“解决最后两个问题”，本次按该最新授权顺序完成两个已有编号，只有此轮覆盖单项执行限制；不新增业务功能或公开资料。

## 安全升级

官方registry核对当前稳定Next16.4.1、React/ReactDOM19.3.1、类型19.3.0、ESLint9.39.5及同版eslint-config-next16.4.1；Node最低要求随最终测试工具统一为22.13+（22系）、24系或26+，本机24。升级package/lock，postcss8.5.30及source-map-js1.2.2消除当前告警，后者必要时使用明确override，不audit fix --force，不改全局registry。

实施核对补充：运行依赖审计已为0，但完整开发工具审计发现Vitest2/UI/HappyDOM旧版本告警，ESLint9也已结束维护。继续将测试工具升级Vitest/UI5.0.4、HappyDOM21.0.1、Vite React插件6.1.2、ESLint10.12.0；工具最低Node统一22.13+（支持22系、24系或26+，本机24，Docker改24-alpine）。保留Tailwind3；若上游glob/braces等开发工具依赖没有可用补丁，按真实可达范围记录残余，不用强制跨主版本override或删规则伪造审计全零。

兼容修正：官方eslint-plugin-react最新peer只到9，不能用legacy-peer-deps假装支持10，故ESLint仍锁9.39.5并记录上游维护限制；显式Vite8.3.4和Node24类型与Vitest5/React插件配套。npm旧peer树冲突先按完整package声明重新解析，不force。React Compiler未启，新增compiler的set-state-in-effect/refs建议关闭，保留rules-of-hooks/exhaustive-deps及其余Next规则；认证服务的清空旧会话硬跳转有单行说明，不改成跨账号保留页面。

保留Webpack开发/生产模式，命令显式--webpack，追踪PDF/ASR资产的配置移至稳定顶层，serverComponentsExternalPackages迁移serverExternalPackages。ESLint改官方flat config与独立CLI，保留原Next core-web-vitals规则语义；不做无关组件重构。

Next16参数必须异步：统一鉴权包装器在调用原领域handler前await params，外部路由签名适配Promise，保留直接同步测试调用的兼容重载；业务owner/当前角色校验仍先于读写/模型。客户端页面通过React.use解包Next传入的Promise参数，保留直接传入同步props的测试工作区及既有useSearchParams/useParams，Suspense边界用于静态页面；切资料/时间定位/共享thread/草稿隔离不能回退。无公开API字段、表或迁移变更。

先保护数据/env和保存旧依赖/配置，停止经归属确认的本仓库网页再安装；只清理或移动已确认的本机构建缓存，不动用户资料/数据库。依赖升级后全量测试、类型/lint、官方运行依赖审计、隔离生产构建/standalone、登录/续期/权限/媒体及随看错误路径验证。外部AI/ASR/Ascend禁用，不因升级消费额度。

## 总图谱正确率

当前仅以复习次数加权的正确率会漏掉只有作答的节点。改为查询本人实际ExerciseRecord，按pointId统计总作答和正确次数；聚合别名知识点时累加实际作答数作分母，总正确数作分子。没有作答返回null，零正确返回0。复习次数只反映真实ReviewLog，不作答不补造；掌握度score/isWeak沿用现有Mastery，单资料图谱继续使用同一实际作答口径。

保持现有DTO字段。查询受本人learnerId和本人contentId/pointId白名单约束，空知识点不查作答。覆盖仅作答/仅复习/零正确/别名不同题量/空记录及数据隔离，并通过真实隔离作答后查看总图谱/掌握画像，最终清理夹具、核对原表/媒体/env。

参考：[Next16迁移](https://nextjs.org/docs/app/guides/upgrading/version-16)、[Windows安全公告](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)。版本选择以本轮官方registry与完整审计为证据，公告某一修复版本不当作全部风险清除。

## §26.7 开发依赖处置补充（实现前，2026-10-15）

用户点选剩余9项告警并要求继续，本轮仅执行26.7。官方核对braces最新3.0.3仍无补丁；postcss-selector-parser已发布7.1.6安全补丁，当前Tailwind3.4.19和postcss-nested6.2.0共同依赖6.1.4。先保存原依赖/数据/env/媒体及现有完整CSS编译结果，再评估限定这两条路径override7.1.6，不升级Tailwind4、不删规则、不改运行接口或视觉设计。

这是对上一轮“暂不强制跨主版本覆盖parser”的有界后续评估，不以审计数字作为兼容性证据。官方7.0.0说明主要变化为遍历期间插入安全性，需要核对Tailwind/postcss-nested实际API使用，补嵌套&、多选择器、group/peer/任意值等生产样式编译对比；现有完整CSS与补充样式前后必须逐字一致，并通过全量测试、TS/lint、隔离生产/打包资产验证。失败回退本轮override与lock，不回退上一轮已完成修复。

braces链覆盖fast-glob/micromatch/chokidar/Tailwind/Next ESLint，当前只扫描仓库受控src/配置，不把上传目录或用户自定义glob纳入构建。保留告警，不自造修复版本或关闭审计；未发补丁阻塞须留证。ESLint9维护限制继续保留，不force安装peer尚不支持的10。
