# §22.20 上传失败恢复与残留核对 · 2026-10-13

完成：2026-10-13 09:58（北京时间）。只处理B05，不恢复云服务或生产资源。

## 修复

- src/app/import/page.tsx按当前File对象保留已返回contentId，传输失败后手动重试先核对原记录，再续签同ID；已解析/就绪恢复原轮询，不再次上传、创建或complete。请求用同步ref互斥，换文件/模式清空尝试；查询失败保留文件与ID，不猜状态。没有自动重放或跨会话File存储。
- POST upload-intent增加可选contentId：读取本人PENDING/NONE、无异步任务、完全匹配类型/文件名/大小的记录。外来403、不存在404、状态/文件/租期变化409；原updatedAt条件更新续签时间，不新建行，local同源相对路径/S3原签名规则保留。
- 首次新建但签名失败、地址和ID未返回时，仅清理本次空PENDING且无任务/学习关联的行；失败保留503，清理异常只记固定日志。续签失败不删除原行，避免丢失重试依据。不删除已上传媒体或原旧资料。
- src/services/api.ts增加可选参数；相关API和学习中心组件回归覆盖失败重试及不确定complete已开始时的恢复。无依赖/表/迁移。

## 原8条残留

维护入口scripts/maintenance/stale-upload-intents.ts默认preview。候选必须PENDING/NONE、无任何任务（包括历史任务）、无笔记/进度/知识点/卡/题/转写/OCR/计划/AI笔记，距updatedAt超过max(2小时,当前配置签名期限2倍)，存储stat实际不存在；服务异常不当作不存在。

原preview确认8/8满足，保留backup.json。apply必须提供之前preview，限定已核对ID/owner/key/updatedAt，再次核对状态/关联/文件；实际8条只改FAILED/failReason=UPLOAD_NOT_COMPLETED及更新时间。记录ID保留，删除行0、删除对象0。之后preview显示PENDING残留0。学习中心状态显示“失败”，未新增failReason前端字段或隐藏失败历史；可使用已有手动删除确认，但本次没有删除原8条。

备份与受控restore保留；restore仅允许本次标记且之后updatedAt未变、仍无任务的记录恢复PENDING/原failReason，不覆盖后续处理状态。恢复已在临时数据实测，不为演示把原8条恢复成假待导入。

原8条状态变化是预期修复，不能声称所有原数据库字节不变。其它资料及关联学习数据、用户XP和.env/.env.local保护指纹一致，原演示媒体保留。

## 验证

- 定向最初29项通过；补首次签名失败保护后，最终123文件946项回归、TS/定向ESLint均退出0。
- 隔离真实HTTP/数据库/文件验收7项通过（real与最后版本real-2）：续签同ID只有1行、不匹配文件409、外来403、续签地址实际PUT12字节成功、旧且空/无任务的临时记录标失败、新记录/有任务/有文件保持、备份恢复、READY拒绝续签。
- 临时两个账号及自己上传12字节文件已清理，原资料指纹不变。未调用模型、ASR、Ascend、摄像头或完整解析作业。
- 组件真实受控点击覆盖同页失败重试与服务器已经开始处理的恢复；本轮未让本人浏览器实际上传或注入网络故障，不将组件/API验收写成真实浏览器故障复演。
- 原apply有backup/changes及精确ID报告，之后PENDING=0、非候选数据保护通过。未删除演示资料/成绩，未批量停止或改动后台任务。

证据目录.taskbook-working/upload-recovery-20261013：focused.log、final-tests-2.log/tests.exit、types.log/exit、lint.log/exit、real-2/report.json、original-preview、original-apply、after-preview、protection.json。原始失败测试保留：%j格式化BigInt和测试Prisma缺少新读取mock是测试工具错误，不是产品模型故障；补清理代码时断言曾发现补丁未生效，最终修复与全量通过另存，不掩盖失败。

## 复现

桌面主仓库可在本地服务运行时执行：

```powershell
node --import tsx scripts/acceptance/upload-recovery.ts .taskbook-working/upload-repeat
node --import tsx scripts/maintenance/stale-upload-intents.ts preview .taskbook-working/stale-preview-repeat
```

apply必须明确指定之前preview目录且使用新输出目录。撤销本轮原状态修复的受控入口（按需使用，未对原数据执行）：

```powershell
node --import tsx scripts/maintenance/stale-upload-intents.ts restore .taskbook-working/stale-restore-repeat .taskbook-working/upload-recovery-20261013/original-apply
```

备份含私有对象键，保留忽略目录、不提交/分享；日志不含凭据、token或签名URL。

## 边界与文档

同步TASKS/DESIGN/ARCHITECTURE/DATA/PROGRESS/LEARNINGS；没有TODO补全，非TODO补重试、续签、状态/错误码及保护规则。没有新增产品模块。刷新/离页前未取得contentId、重新选择文件仍可能产生新尝试，过期残留需人工运行preview/apply，本次不新增后台回收/跨会话上传恢复。

B05本编号范围已处理；R01生产PDF/ASR资源、Ascend/人脸不可达、222页理解/模型语义及公网验收仍保留。不能因小文件上传通过宣称完整课堂导入通过。
