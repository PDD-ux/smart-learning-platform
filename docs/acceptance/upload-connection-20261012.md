# §22.10 文档上传连接修复

时间：2026-10-12 16:44（上海）。

用户PDF申报16683936字节，15.91 MiB未超50 MB文档限制。用户确认Edge访问http://127.0.0.1:3000/import，但APP_URL=http://localhost:3000。多次上传意图创建PENDING/NONE记录，传输未完成。旧直传地址跨源，本地PUT没有跨源放行。local上传意图改为同源路径和原签名查询参数，S3签名URL不改；不放宽CORS、不自动重放写请求。services/api网络错误中文化，取消和HTTP错误保留。两个Node验收脚本解析相对URL。没有新增依赖/字段/表。

真实验证：.taskbook-working/upload-diagnostic-20261012/transport.ts、transport-fixed.json。临时隔离账号分别从localhost和127.0.0.1创建意图、PUT16683936字节，均200、落盘字节匹配；清理自建账号/内容/文件，不修改用户失败记录。测试使用人工填充字节，仅验证传输，未调用complete或AI，不是用户PDF内容解析验收。

54项Vitest（client-upload-network/client-session/upload-intent/storage-upload/storage）通过，TS和六文件ESLint通过。覆盖local签名保留、S3原地址、网络不重放、取消与HTTP分类。无TODO补全，非TODO同步ARCH/DATA/DESIGN契约、TASKS和PROGRESS。

用户Edge当前不可通过已连接浏览器直接核对，已告知刷新、重选PDF再导入。最终PDF解析/笔记尚待用户重试；未宣称完成。历史Ascend控制器10:19断开并清理过网页，但当前网站200，不能把旧故障当作当前失败的唯一原因。
