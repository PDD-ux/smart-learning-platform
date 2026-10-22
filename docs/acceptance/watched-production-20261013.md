# §23.4 随看笔记生产产物验收

2026-10-13 18:51，桌面主仓库。隔离系统临时快照复制源码/实体依赖，生产next build与standalone/server.js监听127.0.0.1:3100，不替换原3000/.next。新增production-demo-smoke.cjs的--watched-notes验证分支，测试子进程清空星火/智谱/百炼模型Key，不修改本机env文件；网关在缺Key时先于网络请求失败，不调用ASR或云模型。

## 发现及修复

前三轮构建/启动通过，HTTP验收失败。首轮只记录通用AssertionError，不补造定位；第二轮逐步stage定位到watched-retired-entry。第三轮记录307、目标URL字段缺失：headers.get(location)为空，没有正常Location目标。学习页与随看接口前置检查均已完成才进入此处。

旧/live-notes为纯redirect服务器页面，被静态预渲染后的standalone响应出现此问题。页面增加dynamic=force-dynamic，第四轮同套生产复验通过：307，正常Location解析为http://127.0.0.1:3100/import，无查询参数。验收允许307/308与测试base/显式APP_URL两个已知origin，不接收任意外站；最终通过仍为原测试base，不是放宽后接受错误目标。

## 第四轮真实检查

- next build完成、部署文件跟踪无缺失、standalone实际启动；新/api/contents/[id]/ai/watched-note编译文件存在。
- 实际PostgreSQL临时学习者登录200、HttpOnly/Secure标志、本人资料读取200，匿名401、学生管理接口403、退出200。
- 临时复制已有视频一段真实转写：新接口匿名401、非本人资料403、未结束来源400、外国来源400；完整合法来源但模型Key已禁用时503/AI_UNAVAILABLE，Note与GeneratedNote均未写入。
- 学习页HTTP200，旧/live-notes正常跳/import；只验证HTTP加载，不把它当成生产浏览器真实播放。模型成功生成仍沿用§23.2/23.3开发环境真实证据，不伪报本轮调用模型。
- 历史内部ASR脚本与public worklet打包哈希一致；未执行原录音功能或本地ASR。
- 本次临时用户/内容/转写、3100服务、系统快照清理成功，原学习数据/.env/.env.local指纹一致，原开发.next未替换、未轮换密钥。

构建含既有字体、复习rate Hook依赖及学习页img性能warning，非本编号扩展修复项，不宣称零告警。新版本生产构建/基本接口已补验，Docker/Linux/公网HTTPS、生产浏览器播放、整课覆盖和普遍语义准确仍未验。本轮不重复1011项历史Vitest；生产构建含编译/类型/lint，脚本node --check通过，旧实现失败与修复成功为实际回归证据。

## 复现

在桌面主仓库执行：node scripts/acceptance/production-demo-smoke.cjs --watched-notes --output-dir .taskbook-working/watched-production-repeat

使用新忽略输出目录，3100空闲、现有依赖及PostgreSQL可用。脚本只对临时账号写入，失败仍清理其账号/进程/快照。不要加--repair-local-secrets，不需要--runtime-assets；后者会做原PDF/ASR资产验收，超出本次范围。证据在.taskbook-working/watched-production-20261013/run至run-4，run-4/production.json包含最终清理标志，retired-entry.json记录安全URL组成，protection.json记录原数据保护；没有凭据正文。
