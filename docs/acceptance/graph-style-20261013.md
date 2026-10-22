# §24.5 图谱样式与练习衔接

完成2026-10-14 00:11（北京时间），证据目录沿用2026-10-13开工日期。用户要求特别修改知识图谱样式；仅本编号，不改学习中心或其它模块。

业务文件：src/app/graph/page.tsx、src/components/graph/GraphCanvas.tsx、src/lib/domain/graph-layout.ts、新graph-presentation.ts、src/app/globals.css。小圆点改等尺寸208×120卡片，类型中文、标题两行/详情完整、状态文字与低饱和条；网格280×190，不以坐标声称学习顺序。保留已有合法端点/关系，相关虚线、其它箭头和标签。1100px以上画布详情并排，已有缩放/平移/小地图和ReactFlow标识保留；知识清单提供键盘选择和弱点优先，最后补齐页面选中状态同步。

未知由复习次数/作答正确率/最近复习证据缺失判定，不把默认mastery0显示为真实0。已有记录的0%保留。聚合多点分数沿用原接口（包含未记录项），不是每个子点都被证明薄弱；展示说明，不改变算法。局部或唯一来源单点精确contentId/pointId题库，合并多点按资料题库且建议选择单资料范围，不猜数组映射。复习入口为该资料到期项，不能称只复习该点。薄弱清单补精确练习。

验证：

- npx vitest run tests/e2e/graph-reliability.test.tsx tests/unit/domain/graph-layout.test.ts tests/unit/api/graph.test.ts tests/unit/api/graph-overview.test.ts：最终22项/4文件通过。
- npm run type-check：最终通过。首次pointIds在基类联合中为unknown，显式可选聚合类型与数组验证后通过。
- npx next lint --file src/app/graph/page.tsx --file src/components/graph/GraphCanvas.tsx --file src/lib/domain/graph-layout.ts --file src/lib/domain/graph-presentation.ts：无warning/error。

测试包含50节点卡片不重叠/不增加边、真实端点过滤/箭头、已有读取失败/重试/迟到保护、无记录与0区分、局部精确练习/复习及合并多来源安全筛选。实际浏览器隔离三节点（测试0分/无记录/85%）和两条手工测试关系；点选卡片/中文状态正常，精确进入同知识点两道已有题未作答，薄弱清单可进入精确题库。1280px正常视口无横向溢出，详情与画布并列。

初始受控画布MiniMap为空，补useNodesState/onNodesChange后正常MiniMap3节点，选中1节点。初次精确等待动态节点统计和summary角色定位超时，当前DOM检查后改用实际节点/summary文字，不作为产品失败。fullPage截图与正常视口布局不同，desktop-final.png为正常视口实际展示，早期截图保留。最后selectedPointId同步清单/画布的微调通过最终TS/lint/相关回归，未另做真人拖动量化。

DB记录3知识点/2测试关系、0作答/计划/笔记，XP0；临时退出/关闭/级联清理后原学习数据/.env/.env.local及共享媒体保护通过，没有修改原课堂关系或调用AI。所有证据与setup/prepare/verify/cleanup/protect脚本位于.taskbook-working/graph-style-20261013，临时private.json不提交且账号已删。

更新DESIGN/VISUAL旧非TODO圆点及大小映射描述，ARCH记录呈现/画布状态边界，TASKS/PROGRESS/LEARNINGS同步；无TODO补全、新字段/API/表/依赖。手机、新生产、全量、大规模实际课堂和关系语义未验证，不因隔离手工样本通过核销模型关系正确性。下一任务24.6尚未实施。
