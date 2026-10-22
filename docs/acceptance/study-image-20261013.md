# §23.12 私有学习图片组件补修

完成：2026-10-13 20:52，桌面主仓库。

## 实现

学习页PDF页图/上传图片两处img替换为Next Image，unoptimized保留浏览器对原签名URL的请求，不进/_next/image公共优化缓存，不放宽域名/存储权限。主阅读图eager加载、async解码，CSS双auto、原最大高度760/620及最大宽100%保留比例。原PDF页码、错误/重试/原文件入口不变。组件1200×1600仅为必需尺寸提示，不是实际元数据；没有做CLS测量或准确占位尺寸接口。

这消除no-img-element组件警告，不代表做了私有图片压缩、带宽优化或缓存提速；不因lint通过宣称性能量化收益。未改公开字段、依赖、数据库或原用户进度/笔记。

## 验证

2文件20项相关回归、type-check、页面及两测试文件定向lint通过，学习页无warning/error。PDF页码引用/错误重试、签名query保留以及JPEG直读无srcset检查通过。首次测试1项失败是HappyDOM经Next Image归一化src为绝对URL，旧断言只接受相对URL；修复为完整URL规范化比较，未放宽路径/页码要求，tests.log与tests-final.log分别保留。

Edge localhost专用临时账号/真实PDF只读媒体副本，第一页和第二页均complete=true、natural尺寸1241×1754，第一页显示537.71875×760，原比例正确；无/_next/image和srcset，query页码正确。实际下一页操作只写临时账号进度，未重新解析222页、调用AI/ASR或对原账号翻页。没有用前两页代表全PDF验收。PNG/JPEG分支本轮为组件回归，未另取真人上传文件实测。

退出到登录页并关闭自己的标签，清理临时账号/资料/进度，共享原媒体保留且大小一致；原学习数据及.env/.env.local指纹一致。截图page.png为隔离第一页读回，ui.json为无签名URL/令牌的尺寸及路径结论。

## 复现与边界

npx vitest run tests/e2e/study-focus.test.tsx tests/e2e/study-text-blocks.test.tsx；npm run type-check；npx next lint --file "src/app/study/[id]/page.tsx"。

私有证据.taskbook-working/study-image-20261013，含tests/types/lint日志、ui.json、page.png、cleanup.json、protection.json及隔离setup/cleanup入口。private.json仅忽略目录且账号已清理，不公开。

新生产构建/生产图片浏览器读回、准确元数据占位、移动端/压缩/流量/CLS性能指标未复验，不重复历史全量或生产构建。ARCH/VISUAL非TODO同步私有直读与尺寸边界，TASKS/PROGRESS新增完成记录，无TODO补全、不扩展其它编号。
