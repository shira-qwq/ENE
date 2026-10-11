# ENE · 空白本地项目基座

用户维护愿望并判断交付，AI 维护本地项目事实、当前接手状态与 Git 保存点。无需全局 Owner skill，也不依赖 Paperclip。本库不携带原 Owner 的愿望、任务、作品、回执或历史提交。

## 开始

**新建第一句话：**“用这个 ENE 空白基座创建【项目目标】，按 docs/PROJECT_START.md 开始，先确定文件布局和最小交付，再做原型。”

**接手第一句话：**“用 ENE 接手【本地项目路径】，目标是【希望怎样改】；先保存原版本，保留【不能丢的功能】，不要默认搬目录或整仓重写。”

完整示例见 [用户使用说明](docs/USER_GUIDE.md)；Home 顶部的“使用说明”可随时阅读同一份文档。

新窗口从 [新项目启动入口](docs/PROJECT_START.md) 开始，里面包含可直接使用的启动指令、复制 ENE 自身的边界和常见问题处理。

需要本机 Node.js 和 Git。运行 `node scripts/project-home.mjs --refresh`，再运行 `node results/refresh.mjs`，最后 `node scripts/project-home.mjs --serve`；打开终端给出的本机地址。关闭服务在启动终端按 Ctrl+C。首次愿望由接手模型按 AGENTS.md 写入。

新对话需能访问本地目录，先读 AGENTS.md 和当前文件。仅在网页聊天中获得仓库链接不能操作本机文件。PI 为可选 Builder，需另行配置本地 CLI、模型认证和 `.ai/runtime.json`，仓库不包含这些私有设置。

## 文件

WANT.json：愿望。results/CURRENT.json：当前交付及接受指针。changes/active 与 changes/done：施工卡。receipts：交付回执。docs：必要说明。src：产品。prototypes：小样。.ai/work：本机当前恢复状态。Git 保存项目版本；运行密钥、临时进程与原项目历史不发布。复用时保留一份新的本地 Git，不向模板仓库上传项目私有事实。
