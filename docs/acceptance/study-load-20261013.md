# §22.18 学习来源加载竞态修复 · 2026-10-13

完成：2026-10-13 09:32（北京时间）。只执行本编号；未重新生成或删除原资料。

## 复现与实现

此前浏览器出现过视频已解码但保留“原资料加载失败”横幅，重载后消失，未留可确认当时请求顺序的网络轨迹。本次用受控Promise稳定复现同类代码缺陷：

1. StrictMode首轮详情迟于当前轮返回，旧代码依然启动resource/notes/readPart，覆盖标题并显示旧失败。
2. 先前资源仍待返回，而笔记失败使重试可用；新一轮成功后，旧资源失败仍重设失败横幅。
3. 同样的顺序中，旧资源成功会覆盖新播放器URL。

新增3项测试在修改前全部失败（before.log）；修改后全部通过。它们证明代码存在过期响应问题，不证明当时真实网络错误的唯一根因。

src/app/study/[id]/page.tsx增加主loadVersion及mounted+版本守卫。详情/资料入口await后先检查是否当前轮，旧详情不启动下游请求或跳转；资源/个人笔记回调和主错误只接受当前轮。新加载与effect cleanup使旧轮失效，避免StrictMode重新置mounted=true后复活旧请求。四类独立readPart仍沿用原版本/轮询策略。只丢弃过期结果，不宣称中止底层网络请求。

最新真实失败仍展示重试；不单凭已有视频就清除错误。个人草稿、已保存笔记、引用优先、续学/心跳及写入守卫保持。没有新API/字段/表/依赖或积分算法变化。

## 验证

- 相关23项通过，包括新的3项、草稿失败/重试、引用优先、PDF翻页与既有学习闭环。
- 全量122文件934项通过；TS严格类型检查通过；定向ESLint退出0，无错误，学习页原生img的2条既有性能警告保留。
- Edge临时账号从真实复习引用进入来源。30分钟视频currentTime42、duration1800.032、readyState4、error=null、paused=true；整页刷新后仍相同且无原资料失败横幅。
- PDF真实第209/222页图片complete=true、naturalWidth1241、无失败提示。不是222页全量理解或语义质量验收。
- 临时资料复用原视频/PDF媒体与已解析来源，不调用AI、ASR、Ascend或摄像头；浏览仅可能写临时账号续学进度。不为制造失败修改服务器、断网或原数据。
- 临时3账号/资料已清理，originalUnchanged=true、sharedMediaNotDeleted=true；用户127.0.0.1原标签未操作，临时localhost标签关闭，没有视口更改。保留原网页进程。

证据：.taskbook-working/study-load-20261013中的before.log、focused.log、all-tests.log、typecheck.log、lint.log、browser.json、video-loaded.png、pdf-loaded.png、fixture/cleanup.json。private-fixture.json只在忽略目录，禁止提交/分享凭据。

## 文档与范围

更新TASKS、DESIGN、ARCHITECTURE、PROGRESS和LEARNINGS；没有TODO补全，非TODO新增仅说明加载取消/真实失败与验收边界，不新增业务模块。没有重复生产快照或全部云推理验收；上轮生产通过属于当时版本。

外部服务断开仍可能产生真实错误，本修复不保证所有网络问题消失。Ascend/人脸不可达、长PDF/模型语义、B04预检环境顺序、B05失败导入残留、R01生产资产及公网HTTPS继续保留待处理，不核销其它编号。
