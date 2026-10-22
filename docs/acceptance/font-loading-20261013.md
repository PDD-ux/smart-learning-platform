# §23.10 全局字体加载补修

完成：2026-10-13 20:41，桌面主仓库。

根layout中的Google字体stylesheet link触发Next的no-page-custom-font规则。App Router根布局本来覆盖全站，不以该警告推断曾有页面字体必然缺失。字体引用改为globals.css最前面的远程@import（先于本地React Flow样式及Tailwind），保留完整Noto Sans SC 400/500/600/700、JetBrains Mono 400/500、display=swap和既有font-family回退。根布局保留两个预连接，补显式ReactElement返回类型。没有关闭lint规则或改字体/字号/布局。

浏览器仍需访问Google Fonts；CSS @import并非离线自托管，也不保证快于原link。不新增构建时字体下载、依赖或文件；没有测外网字体请求耗时或证明实际命中字形来自Noto，而非系统回退。

## 保护与页面核对

修改全局文件前，本地备份原视频页7批正文及全部原文/时间到user-note-backup.json/.md（仅页面可读内容，非重新生成或数据库保存）。修改后原页7批/17标题/1已保存仍在，未刷新、播放、提交或触发AI。原工作台保留旧已挂载head，不以它证明新样式生效；另开无提交的登录页核对新版本，0个外部字体stylesheet link、2个预连接、计算font-family保持Noto/苹方/微软雅黑、正文及两标题可读。字体加载状态loaded不能证明首选字体实际使用。验收标签已关闭，原用户页保留。

## 构建与结果

type-check和根layout定向lint通过，无字体warning。现有隔离production-demo-smoke --watched-notes也通过next build（含CSS编译/类型/lint）、standalone3100及真实HTTP/DB登录/权限/来源/缺模型503不写笔记/旧入口307目标检查。构建日志已无字体或复习Hook警告，仅剩学习页两处img性能warning。未独立保留生产CSS字节或做生产浏览器字体验收，不将编译通过外推为外网字体加载保证。

测试子进程模型Key禁用，无AI/ASR调用。临时服务/账号/资料/快照清理true，原学习数据及.env/.env.local指纹保持一致，原3000/.next未替换。没有新业务接口/数据字段/架构/依赖，无需重复历史全量回归或为低风险样式写实现镜像测试。

证据：.taskbook-working/font-loading-20261013/types.log、lint.log、run/build.log、run/production.json、run/retired-entry.json、protection.json、ui.json、page.png以及原笔记文本备份。

复现：npm run type-check；npx next lint --file src/app/layout.tsx；node scripts/acceptance/production-demo-smoke.cjs --watched-notes --output-dir .taskbook-working/font-production-repeat（须不存在的新目录，3100空闲，现有依赖/数据库可用，不加修复密钥或runtime-assets选项）。

无TODO补全，VISUAL非TODO补充实际加载/回退边界，TASKS/PROGRESS新增完成记录。图片警告、生产字体真实命中、离线字体与首屏性能量化不在本编号核销范围。
