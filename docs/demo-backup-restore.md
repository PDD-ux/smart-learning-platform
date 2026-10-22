# 本地演示备份与新库恢复

§26.3，2026-10-15。仅适用于本机PostgreSQL16、local存储、memory队列。实际验证了31张public表全部行一致、12个媒体文件共1,857,318,829字节副本哈希一致；数据库恢复到新建临时库后已删除，原库/文件/env未改。见 [验收记录](acceptance/delivery-20261015.md)。不是生产S3/Redis/异机灾备验收。

## 创建新备份

关闭AI整理与保存/作答等写入，等运行中任务结束；稳妥做法是停止自己启动的网页后备份，不杀未知端口进程或数据库。memory任务不持久化，不能期待恢复后继续执行中任务。

在桌面主仓库PowerShell逐段执行，任何一步失败就停，不覆盖旧备份。数据库密码由原生工具交互输入，不放参数/聊天/录屏。当前PostgreSQL工具路径如下，换机器须核对。

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
$demoPgBin = 'C:\Program Files\PostgreSQL\16\bin'
$demoDb = node -e "require('@next/env').loadEnvConfig(process.cwd(),true); const u=new URL(process.env.DATABASE_URL); console.log(JSON.stringify({host:u.hostname,port:u.port||'5432',user:decodeURIComponent(u.username),name:decodeURIComponent(u.pathname.slice(1))}));" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $demoDb.host -notin @('localhost','127.0.0.1')) { throw '仅供已核对的本地数据库' }
$demoBackupRoot = Join-Path (Get-Location).Path ('.taskbook-working\backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $demoBackupRoot -ErrorAction Stop | Out-Null
& "$demoPgBin\pg_dump.exe" --host $demoDb.host --port $demoDb.port --username $demoDb.user --password --format=custom --file "$demoBackupRoot\database.dump" --dbname $demoDb.name
if ($LASTEXITCODE -ne 0) { throw '导出失败，不能标记备份成功' }
& "$demoPgBin\pg_restore.exe" --list "$demoBackupRoot\database.dump" | Out-Null
if ($LASTEXITCODE -ne 0) { throw '归档不可读取' }
```

复制当前实际local目录和匹配配置，不凭uploads名字猜路径；隐藏文件也必须复制和枚举。

```powershell
$demoStorage = node -e "require('@next/env').loadEnvConfig(process.cwd(),true); if((process.env.STORAGE_DRIVER||'local')!=='local')process.exit(1); console.log(require('node:path').resolve(process.env.UPLOAD_DIR||'uploads'));"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $demoStorage -PathType Container)) { throw '仅适用存在的local目录' }
$demoResolvedSource = (Resolve-Path -LiteralPath $demoStorage).Path.TrimEnd('\')
if ($demoBackupRoot.StartsWith($demoResolvedSource + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw '备份不能在源媒体内' }
Copy-Item -LiteralPath $demoStorage -Destination "$demoBackupRoot\uploads" -Recurse -Force -ErrorAction Stop
Copy-Item -LiteralPath '.env','.env.local' -Destination $demoBackupRoot -ErrorAction Stop
$demoManifest = Get-ChildItem -LiteralPath "$demoBackupRoot\uploads" -Force -Recurse -File | ForEach-Object {
  [pscustomobject]@{ Path = $_.FullName.Substring(("$demoBackupRoot\uploads").Length + 1); Bytes = $_.Length; Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
}
$demoManifest | ConvertTo-Json | Set-Content -LiteralPath "$demoBackupRoot\media-manifest.json" -Encoding UTF8
```

`--list`只证明归档能读，副本清单只记录副本，均不等于已恢复。还需与源目录逐文件比数量/大小/哈希，并完成新库验证；空文件夹也保留。复制时若仍有写入，数据库和媒体可能不一致，应停止写入后另做新备份。

数据库、环境文件和人脸加密媒体均是私有备份，不能发老师或上传Git。加密密钥须配套，否则模板无法解密；私有备份访问受控，并遵守原照片30天保留期，不因备份延长。模型/venv不在uploads，另按DEPLOY准备；代码及全部迁移另留同版本快照。

本次已验证的私有副本在`.taskbook-working/delivery-20261015/private-backup/`。它在本机磁盘，不是异盘灾备；需要时另复制到本人受控加密存储，不能混入公开交付包。

## 只恢复到新库

同一PowerShell会话保留上述变量；新会话先重新读取连接配置，并指定准确备份目录。不能使用当前库名或添加`--clean`覆盖旧库。createdb遇到同名库失败就停。

```powershell
$demoRestoreName = 'slp_restore_' + [guid]::NewGuid().ToString('N')
if ($demoRestoreName -eq $demoDb.name -or $demoRestoreName -notmatch '^slp_restore_[a-f0-9]{32}$') { throw '拒绝不安全目标库' }
& "$demoPgBin\createdb.exe" --host $demoDb.host --port $demoDb.port --username $demoDb.user --password --template=template0 $demoRestoreName
if ($LASTEXITCODE -ne 0) { throw '新库创建失败，停止恢复' }
& "$demoPgBin\pg_restore.exe" --host $demoDb.host --port $demoDb.port --username $demoDb.user --password --exit-on-error --no-owner --no-acl --dbname $demoRestoreName "$demoBackupRoot\database.dump"
if ($LASTEXITCODE -ne 0) { throw '恢复失败，保留新库排查，不切换网页' }
```

核对表/迁移、用户/内容/笔记/作答等全部行以及媒体；本轮使用只读Prisma逐表哈希比对，报告不打印内容。若要试恢复后的网页，停止原网页，在隔离配置中同时指向新DATABASE_URL和新UPLOAD_DIR，并保留匹配加密配置；不能只换库仍用原uploads。先核对登录、媒体Range/PDF阅读、笔记和记录，再考虑人工切换。不直接覆盖当前.env.local或当前库，本任务没有把网页切到恢复库或验证另一台机器恢复。

若仅检查能力，确认没有网页连接该库、目标名仍是本次随机新库后，只删这个临时库：

```powershell
if ($demoRestoreName -eq $demoDb.name -or $demoRestoreName -notmatch '^slp_restore_[a-f0-9]{32}$') { throw '拒绝删除该库' }
& "$demoPgBin\dropdb.exe" --host $demoDb.host --port $demoDb.port --username $demoDb.user --password $demoRestoreName
if ($LASTEXITCODE -ne 0) { throw '临时库仍存在，先核对连接，不强制踢掉会话' }
```

不把`prisma migrate reset`、`db push`或`docker compose down -v`当恢复入口。真正故障时保留坏库和旧媒体，从备份恢复到新位置；本单不提供一键覆盖当前库。
