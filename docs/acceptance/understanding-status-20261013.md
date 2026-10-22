# §22.22 理解空产物与模型失败状态验收

完成时间：2026-10-13 13:30（北京时间）。执行目录：桌面主仓库。

## 问题与修改

§22.21 的真实 standalone 回放发现：关闭大模型后短视频仍显示理解 COMPLETED，知识点为零。短内容抽取及单批闪卡生成将模型异常当作可跳过步骤，是此次确认原因。

deep-extract 和 product-gen 现在传播异常；无上下文、无知识点、无可用闪卡或全部输出被校验拒绝时，拒绝完成。安全候选检查发生在删除该阶段旧产物之前；闪卡失败前不重写整理笔记。长视频真正空窗仍允许跳过，但汇总须有有效产物；可选图谱失败仍独立降级。

沿用现有 FAILED、任务 errorReason 和接口 failureReason，无新字段、接口或依赖。各阶段仍独立提交：抽取成功、卡片失败时，新知识点可能已经保存，本次不提供跨阶段原子回滚。

## 验证

- 最终123文件954项回归、TypeScript和本次文件ESLint通过。增加空产物、全部拒绝、模型异常传播及真实阶段组合失败测试；正向、长视频空窗及文档批次保持通过。
- 独立快照构建和真正standalone服务通过，不覆盖开发.next。测试进程关闭付费模型凭据与真实视觉，队列重试为零，不修改原环境文件。
- 临时复制222页中文PDF，真实导入得到222个文本块；黑色合成帧搭配真实样例音频的30秒视频，经本地ASR产生3段合法时间转写。
- 两份资料均READY、理解FAILED、零知识点，数据库任务错误原因非空；实际认证状态接口均返回phase=failed和非空failureReason。未执行付费模型请求或自动重试，这是失败状态验收，不是语义质量通过。
- 临时账号、媒体快照及生产服务已清理；原资料、笔记、成绩、计划组合指纹一致，.env与.env.local哈希一致。

复现入口：node scripts/acceptance/production-demo-smoke.cjs --runtime-assets --output-dir .taskbook-working/understanding-status-replay-新时间。必须使用新目录；需要原样例PDF、30秒WAV、外置Python/模型、ffmpeg与PostgreSQL。脚本断言两份临时资料均FAILED且保存错误原因。

私有证据：.taskbook-working/understanding-status-20261013/ 下 full-final.log、types-final.log、lint-final.log、production/production.json、production/build.log、status-api.json、protection.json。初次定向测试的参数表/字段断言失败保留，修正测试后全量通过。

## 未验与边界

未执行真人浏览器点击重试、原视频完整重新理解、付费模型语义质量、真实Ascend、人脸、Docker/Linux及公网验收；已有重试接口回归不等于云模型可用。未批量修改旧资料状态或删除原数据。收尾预检发现开发网页已停止，已恢复本地演示启动入口；该问题不归因于流水线改动。
