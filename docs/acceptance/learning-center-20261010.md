# §20.4 学习中心资料优先验收

时间：2026-10-10 16:19（北京时间）。工作目录：桌面主仓库。

## 完成范围

学习中心先展示本人资料和搜索/筛选。导入区默认隐藏，按钮可展开/收起；隐藏不卸载文件输入，不清理选择。上传忙碌时不能收起，AI后台处理时收起仍展示状态摘要，轮询保持直到终态。卡片显示资料状态、真实时长/页数、AI状态及本人有效历史位置；未知元数据明确未知，失败位置独立重试。保留原进入学习、改名、删除确认和上传服务封装。

没有新增接口、字段或依赖，没有修改账号、实际学习记录或三份演示资料，没有调用模型。§20.5–20.8未执行；展开区尚未开始的1/5显示留待§20.7。

## 自动回归

```powershell
npx vitest run tests/e2e/learning-center.test.tsx tests/e2e/content-management.test.tsx tests/e2e/learner-main-path.test.tsx tests/integration/content-import-flow.test.ts tests/unit/domain/content-format.test.ts
npm run type-check
npx eslint src/app/import/page.tsx src/components/app/ContentStudyMeta.tsx tests/e2e/content-management.test.tsx tests/e2e/learning-center.test.tsx scripts/acceptance/learning-center.ts
```

5文件32用例、类型检查、ESLint通过。新增13用例覆盖资料优先/文件保留、空库与筛选空态、无历史与零秒历史、独立重试及改名草稿、文档页码/AI失败仍可学习、未就绪不可续学、无效类型/数值/日期、未知时长、迟到结果隔离、收起后AI轮询完成。上传/解析流程集成回归使用模拟服务，其ffprobe不可用提示属于模拟降级分支，不能视作真实上传验收。

## 真实只读数据

```powershell
npx tsx scripts/acceptance/learning-center.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/learning-center-20261010/read-only.json
```

本地开发服务必须运行，脚本从本机环境读取配置，仅在内存生成该资料所属账号的测试鉴权，不输出密钥或token。读取本人全部列表和已就绪进度，匿名进度请求必须401；仅结果JSON写入本机。

- 资料总数3，均已就绪、AI completed。
- 30分钟视频1800秒，上次247秒（页面应为30:00及4:07）。
- 30秒视频30秒，无历史，不应显示“上次看到0:00”。
- 图片按文档读取第1页，无历史，pageCount为空，显示页数未知。
- 匿名进度读取401，模型未调用、用户数据未写入。

原始结果：`.taskbook-working/learning-center-20261010/read-only.json`。

## 浏览器限制

通过临时浏览器页访问`http://localhost:3000/import`，实际跳转`/login`，不能确认已登录真实布局及宽窄屏表现。证据：`.taskbook-working/learning-center-20261010/browser-login-block.txt`。没有绕过登录或注入会话；临时页已关闭。登录后可在学习中心核对默认列表、三个卡片元数据和展开/收起；本轮未上传/删除真实文件。页面行为由组件测试验证，不声明真实浏览器交互已通过。
