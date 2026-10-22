# §24.9 本地毕设主流程验收

后续更正（§24.10，2026-10-14 08:35）：下述疑似8 XP经真实DOM核对实际为0（字符48），是11px JetBrains Mono零字形误读，不是已证实DB不一致。已改善字形并核对实际评分/退出切换账号，见profile-consistency-20261014.md；保留本轮历史观察及失败证据。

完成：2026-10-14 08:28，北京时间；桌面主仓库。仅已有资料展示，未上传、训练、启动云Notebook或发送新模型请求。

最终全量135文件/1055测试、TS、完整lint通过且退出0。初始图谱标题重复断言失败，第一次隐藏group定位仍失败，最终改用可访问知识点清单与详情作用域通过。修复预检face health遗漏Bearer导致的假阻塞，保留健康及模型版本检查，补鉴权/版本不匹配回归。

隔离学生/管理员真实25项HTTP通过：密码分流、学习者管理403、资料/媒体128字节206、笔记创建修改、两题false→true、到期自评0、计划创建完成撤销、图谱/掌握与管理读取。浏览器实际视频duration1800.032秒、播放24.525403秒/error=null，暂停保存时间引用笔记；题库、6图谱点、计划、复习无到期项、助手草稿及管理员筛选核对。题为手工算术样本；510段转写/5原知识点/历史笔记来自只读副本，不代表课堂语义通过，没有伪造关系。

前轮验收脚本误用计划完成POST路由，实际为PATCH；最终汇总误查LearningProgress.positionSec，实际存储ref。保留失败证据并建立新隔离账号重验。第二轮开始网页停止，ECONNREFUSED及3000无监听明确证实连接故障，恢复demo:start/face:start后25项成功。新浏览器再保存第二笔记，最终DB回读2笔记/作答false,true/1复习/1未完成计划/XP0；第二轮未播放，引用0秒，播放证据来自第一轮。

两轮临时会话退出关闭，归属检查后临时学生、内容、管理员及审计清理；共享媒体存在且字节不变，原学习数据和两env指纹一致。最终展示预检通过、face真实模型健康；Agent/生成/ASR仅configured，Ascend未启动。报告：`.taskbook-working/local-demo/1791937578615-24fa2c04-dab8-46a3-91da-e34de36cd531/report.json`。

已发现未解决问题：第二轮截图侧栏8 XP与隔离数据库0不一致，列24.10待定位，本轮未改计分。随播放AI整理默认开启，稳定已有资料演示须先取消“随播放AI整理（会使用API额度）”。助手只填草稿未发送；在线额度/模型语义、本人摄像头、完整30分钟播放、手机、新生产、新导入全教材和公网本轮未验。主流程通过不表示项目无缺陷。

证据目录：`.taskbook-working/demo-walkthrough-20261014`；tests-final/types-final/lint-final/preflight-restored日志、playback.json、study.png、各页面文本。recheck子目录有http/verification/cleanup/admin-cleanup/protection.json及study.png。初始失败日志保留；private.json凭据不输出，临时账号已删除。

只读复现使用`npm run demo:check`。完整隔离复验须将setup/prepare/supplement/http/verify/cleanup/protect脚本复制到新目录并调整输出根：protect before→setup/prepare/supplement→HTTP→临时网页保存第二笔记→verify成功→cleanup/admin-cleanup→protect after。逐步检查退出码，不复用已清理账号，不替换fixture为本人账号或删除共享媒体。

永久修改预检脚本、其单测、主流程测试及TASKS/ARCH/PROGRESS/LEARNINGS/演练指引；无新依赖/API/字段/模块，无TODO补全，非TODO说明按实际鉴权与演示边界修正。
