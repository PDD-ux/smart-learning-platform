# §19.1 本机人脸识别恢复与复验

时间：2026-10-13 19:29。桌面主仓库，本地毕设演示。

## 原因与恢复

首次npm run face:status退出1，fetch failed：现有回环服务未运行。执行已有npm run face:start后真实模型健康通过，CPU、固定yunet2023-sface2021-mp1-c045-action-v1版本、loginMode=scan。没有重新安装、换阈值、换模式、轮换密钥或改.env。服务保持运行供本人扫描；关闭电脑或停止进程后须再次启动。

## 实际验收

使用已有公开照片与独立临时学习者，实际HTTP、SFace模型及PostgreSQL：录入201、匹配登录200、HttpOnly会话、自动face打卡通过；重复登录只保留一天一条记录及首次时间。不同人401与票据重放401均无会话Cookie。公开静态照片在scan模式可认证，这属于身份匹配，不代表活体或防伪成功。

临时模板/私有录入照片清理函数成功完成，再删除临时账号，cleanup.json确认账号不存在。没有操作原模板；原模板字节本轮未单独做前后指纹，不宣称该项独立验证通过。learningDataUnchanged、envUnchanged、localEnvUnchanged均true，保护检查仅覆盖原学习资料/关联记录和配置。

6文件51项人脸回归、type-check和验收脚本lint通过；业务代码未变，只为face-scan-local.ts增加可选输出目录及finally清理报告，避免再次运行覆盖2026-10-09证据。未重复全站1023项历史测试，不沿用它作为本轮结果。

独立打开127.0.0.1:3000/login并选中“人脸登录”，确认扫描按钮、自动打卡与便捷扫描说明显示。没有启动摄像头、输入凭据、执行本人登录或录入；原视频学习页及临时笔记保留。截图为.taskbook-working/face-recheck-20261013/login.png，不包含摄像头画面。

## 复现

```powershell
npm run face:start
npm run face:status
npx tsx scripts/acceptance/face-scan-local.ts .taskbook-working/face-repeat/scan
```

最后一行使用已有公开样本/配置，创建并清理自己的测试账号，输出到新目录；不应改成原用户账号。证据在.taskbook-working/face-recheck-20261013：health.log、scan.log、scan/report.json、scan/cleanup.json、tests.log、types.log、lint.log、protection.json和login.png。没有输出密钥、画面、向量或相似度。

## 本人补验（19:34）

用户明确反馈“可以登录”，独立登录标签现已进入工作台，页面显示2026-10-13普通打卡10:28、今日已打卡。只读数据库核对原视频所属学习者当日恰好1条SELF_CHECK_IN，首次时间为02:28:09.843Z（上海10:28）。当天先普通打卡再人脸登录保留第一条方式/时间，符合writeDailyCheckIn的upsert update={}，不应强制改为人脸或新增记录。

本人扫描登录成功按用户反馈记录；页面进入工作台及当天唯一打卡另有只读证据personal.json。AI没有操作摄像头、读取生物数据、重放登录、退出或修改打卡，不宣称独立抓取本人登录请求/画面。当天原本已有打卡，所以本次本人路径不证明首次人脸自动新增记录；该分支由前述隔离真实样本验证。无公网/Linux/生产安全验收。

本编号无TODO补全，TASKS/PROGRESS新增非TODO复验记录；不新增页面、接口、依赖、数据字段或架构。
