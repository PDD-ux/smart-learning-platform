# §24.7 账号与管理员演示收尾

完成2026-10-14 08:00，北京时间；真实HTTP/浏览器/人脸检查于同日凌晨完成，最后工具退出复跑07:59正常结束。范围限现有登录/打卡及最小管理员功能，没有新班级/教学评分/生物数据管理。

修改src/app/admin/users/page.tsx与attendance/page.tsx：列表请求版本/mounted同时保护成功、失败及finally，越界分页回退；用户保存与删除ref同步锁，忙碌禁用筛选及冲突操作，失败保留编辑草稿并在弹层内显示，成功status反馈。补可读筛选名称和44px编辑/删除/关闭按钮。服务器角色/自删自降级规则不变，无公开API/字段/表/依赖新增。

新增相关回归验证用户列表迟到成功、签到迟到统计不覆盖、新增保存同步锁/字段禁用/失败草稿；保留现有CRUD、管理员壳层、空错状态、密码/人脸/每日首次时间/续期测试。首次CRLF替换未加锁，被测试复现2次写入后用定位补丁修复，首轮tests.log保留。tests-final.log首轮92通过；tests-confirmed.log随后92通过却线程退出报Failed to terminate worker，不能只凭用例通过记正常结束。最终命令：

- npx vitest run tests/e2e/admin-users-pages.test.tsx tests/e2e/admin-list-states.test.tsx tests/e2e/admin-center-pages.test.tsx tests/e2e/face-login-panel.test.tsx tests/e2e/face-attendance-pages.test.tsx tests/unit/api/admin-users.test.ts tests/unit/api/admin-overview.test.ts tests/unit/api/face-login.test.ts tests/unit/api/face-attendance.test.ts tests/unit/api/auth-refresh.test.ts --pool=forks --maxWorkers=1 --minWorkers=1：92项/10文件通过，退出0。
- npm run type-check：通过。
- npx next lint --file src/app/admin/users/page.tsx --file src/app/admin/attendance/page.tsx：无warning/error。

真实HTTP和PostgreSQL临时管理员/新学习者：密码登录分别/admin、/dashboard；管理员POST创建201、GET搜索唯一结果、PATCH昵称200、DELETE删除200。自删/自降级403，学习者GET用户/总览/签到三个管理API403。密码登录后签到0，普通打卡两次都200但signedAt相同且DB仅1条/XP0。内置浏览器临时管理员导航仅总览/用户/签到，查询隔离用户、编辑昵称成功，并按临时ID查询到普通打卡，不改密码或提升角色。等待签到普通打卡文本同时匹配隐藏option与可见span，读实际DOM确认，不作为产品失败。

face:status初次fetch failed；使用已有face:start恢复CPU服务，无模型下载/训练或环境修改。npx tsx scripts/acceptance/face-scan-local.ts .taskbook-working/admin-finish-20261014/face-real使用已存公开样本完成真实录入、匹配登录/HttpOnly、自动face打卡、重复仅1条首次时间保持、异人/重放401。face-real/report.json与cleanup.json证明临时模板/照片/账号已清理。最终face-status-final.log为在线scan。公开静态照片可登录，不等于活体防伪或本人摄像头验收。

真实删除前限定目标email/ID和零资料，校验页面编辑昵称；HTTP删除清理其签到，再删除本次临时管理员。cleanup.json、http.json记录CRUD/清理；protection.json原学习数据/.env/.env.local指纹一致。没有原账号密码/角色/模板更改，没有读取本人摄像头。脸服务和原3000网页保留运行供演示。

证据目录.taskbook-working/admin-finish-20261014含setup/cleanup/protect可复现脚本、users.txt、attendance.txt、desktop.png、HTTP/人脸/测试/类型/lint记录。private.json是已删除的临时账号凭据，不提交。截图为页面编辑完成，最后44px按钮微调通过最终回归/TS/lint，未重新拍该低风险尺寸变更。

DESIGN/ARCH/VISUAL非TODO更新保护与反馈，TASKS/PROGRESS/LEARNINGS同步，无TODO补全。Phase24逐项完成；本人真人摄像头、手机、新生产/公网、全量本轮未重新验收，不称全项目无缺陷。后续可另项安排完整毕设路径演练。
