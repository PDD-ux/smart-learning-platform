# §22.17 复习评分后的账号XP同步 · 2026-10-13

完成时间：2026-10-13 09:27（北京时间）。仅修复§22.16实际验收发现的壳层XP滞后，不处理其它编号。

## 改动

- src/services/profile-updates.ts：页面内无载荷失效通知及释放订阅。不传递XP、账号、token，不写存储。
- src/services/api.ts：review的真实apiRequest成功返回后通知；失败、会话变化或结果不确定不通知、不自动重放评分。
- src/components/app/AppShell.tsx：订阅后重读已有profile接口，顶部/侧栏XP和等级使用同一份服务器数据。刷新中或失败显示占位，保留最近成功角色与页面输入；独立重试读取，不再展示旧XP。effect清理忽略迟到响应；预览不订阅、不读取本人数据。
- tests/e2e/app-shell-states.test.tsx及tests/unit/services/profile-updates.test.ts：成功/待完成/失败/切换会话、迟到初始读取、卸载、预览、输入保留回归。
- DESIGN/ARCHITECTURE/TASKS/PROGRESS记录修复。未新增公开接口/数据库字段/依赖，不改变SM-2/XP算法、认证或原资料。

## 验证

- 定向24项通过；全量122文件931测试通过。TS严格检查、定向ESLint均退出0。
- Edge真实localhost临时账号密码登录，实际点击复习与熟练评分。服务端写入后，无刷新情况下顶部/侧栏/本页均10 XP、本次记录1/4。
- 数据库核对只有1条ReviewLog、rating3、xpTotal10。测试没有自动对其余卡评分，未调用AI/ASR/Ascend或摄像头。
- 初次浏览器连接发现网页已停止，核对3000无监听后恢复桌面主仓库Next开发服务，父PID3412，网页保留用于演示。没有停止其它进程或替换开发.next。
- 临时3账号及克隆资料已清理；originalUnchanged=true、sharedMediaNotDeleted=true。原用户127.0.0.1标签未操作；临时localhost标签关闭，没有修改视口。
- 证据：.taskbook-working/profile-sync-20261013下all-tests.log、typecheck.log、lint.log、browser.json、database.json、xp-synced.png、fixture/cleanup.json。测试凭据只在忽略的private-fixture.json，不分享或提交。

本次不重复生产快照或云端模型验收。上一轮生产证据属于当时版本，不冒充本次新代码生产部署。既有复习测试有异步act警告，未屏蔽/当作浏览器失败；本次新增服务与壳层定向测试通过。

## 剩余项

§22.16记录的来源页偶发失败提示仍待可靠复现；Ascend/人脸不可达、222页完整理解/安全补修、模型语义质量、B04环境加载/B05失败残留/R01生产资产及公网HTTPS保持原状态，不因XP修复被核销。

文档无TODO补全；本次修改非TODO的交互与客户端通知说明，是为了准确记录已确认的缺陷修复，不新增功能模块。
