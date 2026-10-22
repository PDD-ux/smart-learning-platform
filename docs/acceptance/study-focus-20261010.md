# §20.6 学习页重点收敛验收

时间：2026-10-10 16:37（北京时间）。工作目录：桌面主仓库。

## 实现范围

视频页宽屏第一行为播放器与同步笔记，第二行为完整笔记和辅助区；窄窗口依次是播放器、同步笔记、完整笔记、辅助区。列宽允许收缩，保持已有换行规则。转写列表、文本/OCR和处理详情使用默认收起的原生details/summary，折叠不卸载内容；当前转写原文仍展示在同步笔记内。AI失败原因及降级提示直接可见。

保留原AI/个人笔记切换、输入、首次定位、自动保存、失败重试、引用跳转、PDF页码、播放进度及后台状态轮询。没有新增接口、字段、依赖或模型调用；不实现§20.7状态口径和§20.8题目质量。原阶段示意条不视作真实精确进度。

## 自动验证

```powershell
npx vitest run tests/e2e/study-focus.test.tsx tests/e2e/playback-notes.test.tsx tests/e2e/note-save-reliability.test.tsx tests/e2e/study-text-blocks.test.tsx tests/e2e/learner-main-path.test.tsx tests/unit/domain/study-location.test.ts tests/unit/domain/playback-notes.test.ts
npm run type-check
npx eslint 'src/app/study/[id]/page.tsx' tests/e2e/study-focus.test.tsx scripts/acceptance/study-focus.ts
```

7文件25项通过。新增6项覆盖主区顺序、默认折叠、展开定位保留媒体实例、续播、同步草稿和绑定时间、保存失败重试、折叠期间后台轮询/故障外显、资源重读保留手动输入、引用优先、文档页码定位。原笔记保存/同步笔记/文字过滤/主流程及定位回归保持通过。

TypeScript通过，ESLint0错误，2个既有PDF/图片原生img优化提示保留。未执行生产构建以免覆盖运行中的开发.next。组件测试验证行为，不代替实际浏览器CSS/媒体播放验收。

## 真实只读核对

```powershell
npx tsx scripts/acceptance/study-focus.ts cmuqhyf7h00027q29tijy4uer .taskbook-working/study-focus-20261010/read-only.json
```

本机开发服务运行时，用环境配置及数据库资料所有者在内存签发测试鉴权，读取原资料/资源信息、理解产物、阶段、进度、AI笔记及个人笔记数量，不输出凭据、签名资源地址或笔记正文；只写本机报告。

- MP4，1800秒，已就绪，理解completed，进度247秒（4:07）。
- 5知识点、17个类型/范围有效的引用。
- 510转写段落、1383文本块，AI笔记存在，个人笔记0。
- 匿名理解读取401，未调用模型或写入用户数据。

证据：`.taskbook-working/study-focus-20261010/read-only.json`。

## 浏览器限制

读取现有用户标签页，实际处于`http://localhost:3000/login`；没有填入凭据、导航播放器、播放视频或保存本人笔记。证据：`.taskbook-working/study-focus-20261010/browser-login-block.txt`。本轮没有新建浏览器页，用户页面保持原样；不声明已登录真实宽窄屏布局或媒体播放已通过。

本人登录后可打开原30分钟学习页，分别核对宽屏并列和窄屏先播放器再同步重点的顺序；展开/收起三类详情检查视频不重载、草稿不消失，点真实时间/页码核对定位。实际播放会按原规则更新进度；保存笔记应由本人决定。
