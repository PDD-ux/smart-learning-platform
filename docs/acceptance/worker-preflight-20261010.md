# §10.4 部署前置预检与本地演示范围

2026-10-10 10:42，完成只读入口scripts/acceptance/worker-preflight.ts，实际status=blocked/exit=1；随后用户明确没有网站服务器、优先完成本地毕设演示。因此本轮保留生产部署阻塞，继续使用现有memory演示，不安装WSL、不升级/替换用户Redis、不启动消费者或重放遗留任务。

## 实际结果

- Redis INFO server返回3.0.504。当前安装的BullMQ源码redis-connection.js要求最低5.0.0、推荐6.2.0；项目DEPLOY约定Redis 7，入口按项目约定要求7及以上。它不把Redis 5或6判断为本项目部署准备完成。
- docker version无法连接dockerDesktopLinuxEngine命名管道；Docker CLI存在，Linux引擎不可用。wsl --status返回50，明确提示未安装适用于Linux的Windows子系统。
- 真实Ascend预检通过：health=ok/device=ascend/modelsLoaded=true/mindsporeAvailable=true/mock=false/ocrFallbackAvailable=false。
- 入口只执行Redis INFO、Docker版本及推理health读取，连接与请求预算均有界，结束释放连接；不记录Redis URL、凭据、token或原始异常，不启动worker、不写队列/数据库。ready也只代表这些前提通过，不代表生产worker、容器、数据库、对象存储或网站验收通过。
- TypeScript和入口ESLint通过；已有业务代码未修改，不重复568项业务回归或生产构建。本机真实Redis版本不足及Docker不可达路径已经实际验证，没有为低影响只读入口添加实现镜像测试。

## 浏览器补查

原学习页视频1800.032秒，4:07暂停、readyState=4/error=null，导航包含工作台、学习中心、计划、题库、助手、复习及图谱。后台新页打开工作台后跳至登录，记录为需要重新登录，不能把短暂加载占位的0资产当作真实统计。未提取会话、修改密码、播放/保存笔记或改变原进度，临时页已关闭。

本轮仅完成预检入口、阻塞证据及[本地演示操作单](../demo-local-20261010.md)，不标记当前账号全部菜单已重新复验。用户重新登录后按操作单演练；功能历史验收与当前登录状态分开记录。

## 复现

```powershell
Set-Location 'C:\Users\qwh76\Desktop\智能学习平台'
node --import tsx scripts/acceptance/worker-preflight.ts .taskbook-working/worker-preflight-20261010/result-next.json http://127.0.0.1:8001
```

输出blocked时退出1，ready时退出0；第二个参数是推理地址，默认读取ASCEND_INFER_URL。使用新输出文件保留失败，不以生产队列模式直接接入本机旧Redis。

[预检结果](worker-preflight-20261010/result.json)、[WSL证据](worker-preflight-20261010/wsl-status.json)、[证据哈希](worker-preflight-20261010/manifest.json)。仅更新§10.4验收非TODO文档，无新增依赖、页面、接口、数据库字段或架构改动。
