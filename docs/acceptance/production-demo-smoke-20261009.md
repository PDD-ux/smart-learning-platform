# 本地生产产物复验 · 2026-10-09

仅§10.4，桌面主仓库。最终standalone通过时间18:49:47，收尾18:50。结果见[JSON](production-demo-smoke-20261009.json)。

修复了本机生产登录不合格JWT配置和存储签名配置（独立随机值，仅.env.local）；生产同样拒绝已知开发默认JWT。public/.gitkeep补齐Docker复制目录，dockerignore排除本机验收凭据/上传资料/密钥与运行时数据。原账号密码、加密人脸模板与学习资料不变。密钥变化后的旧会话/预签名需要重新申请。

最终独立实体依赖快照next build退出0，standalone/server.js绑定127.0.0.1:3100，真实PostgreSQL临时账号：登录200、授权资料200、匿名401、学习者管理接口403、退出200，Cookie含Secure/HttpOnly。临时账号剩余0、3100释放、本次快照清理，3000原网页仍200。未替换原.next或关闭人脸服务。全量92文件548测试、type-check、lint通过；保留3条既有字体/img提示和构建BullMQ可选Valkey提示。

初次依赖junction导致standalone拷贝EPERM警告，只有next start成功，不算打包成功；改实体依赖后正式入口成功。后一次public不存在导致验收工具失败，已允许空静态目录，并给真实仓库补public/.gitkeep。Prisma早于Next env加载及初版环境修复正则转义造成的重复赋值已修复，最终JWT/STORAGE长度合格、互不相同且各一项，无密钥输出。

复现：本机PostgreSQL及项目依赖可用、3100空闲时执行：

```powershell
node scripts/acceptance/production-demo-smoke.cjs
# 仅确需修复不合格本机签名配置时：
node scripts/acceptance/production-demo-smoke.cjs --repair-local-secrets
```

入口仅操作其临时账号，关闭其启动服务，清理前核对临时快照绝对路径属于系统Temp且具有本次前缀。日志只放被忽略.taskbook-working。JSON不含账号、密码、token、数据库连接串或密钥。

未验证公网HTTPS、Docker运行、Ascend/ASR视频全链路及真人扫描。本次实测人脸health200，Ascend不可达；已有SSH域名与此前实测IP的31637均关闭连接，需启动/续期ModelArts并提供当前连接命令。自动续期不在既定MVP范围，本轮不新增认证接口。
