# 变更记录

## [0.8.3] - 2026-09-03

- 新增统一 `HumanInkWorkbenchService` 与公开契约，为后续 Remote、Tools、Skill、Prompt 和 Client 共用同一应用边界。
- 门面覆盖内容列表、内容详情、新建内容、保存人工版本、启动写作动作、任务查询、能力报告和单调 revision，并透传取消信号。
- 继续复用现有 `HumanInkApplication`、内容仓库和任务运行时，不复制标题、写作、人味化或复核领域逻辑。

## [0.8.2] - 2026-09-03

- 新增 `test:dsh-contract` 原生集成契约门禁，覆盖 Host disposer、可选 Connection、DSH Desktop Client 入口、Better Sidebar 可选降级和 Client 插件生命周期。
- 将 Host `connection` 从硬注入改为可选能力，避免命令模式或无 Browser Connection 的宿主在插件应用前阻塞。
- 修复既有测试替身缺少 `listProjects()` 以及 Client 契约测试缺少 Node 类型声明的问题，恢复完整 TypeScript 检查。

## [0.8.1] - 2026-09-03

- 完成 HumanInk 2.0 重构设计基线：产品定位调整为集成在 DeepSeek Harness 中的本地 AI 内容生产工作台。
- 新增 0.9.0 MVP 产品需求、技术架构、DSH 集成协议和分阶段实施计划。
- 明确渐进重构边界：保留 Core、Storage、任务和版本能力，重写 Client UI 与 DSH Remote、Tool、Skill、Prompt 集成层。
- 明确 Better Sidebar 仅为可选增强、Windows 为发布阻断平台，搜图、封面、朱雀检测、热点和发布不进入首个重构 MVP。
## [0.8.0] - 2026-09-03

- HumanInk 接入 DSH Better Sidebar 原生 Tab：客户端入口按 DSH 生态约定注入 `betterSidebar` 可选服务，注册 `humanink:workbench` / `HumanInk` 单实例 Tab，注册/卸载经 Cordis disposer 管理，HMR 与插件卸载不会产生重复 Tab；
- 关键契约修复（本机 DSH Desktop 2.0.4 实测）：`apply()` 必须返回 disposer 而非实例对象，否则 Cordis 抛 `TypeError("Invalid effect")` 导致整个 renderer 启动失败；`betterSidebar` 不能写入 `inject`（服务缺失时插件 fiber 永远 pending，同样拖垮 renderer），改用 `ctx.get('betterSidebar')` 防御式读取；
- Better Sidebar 服务缺失或形态异常时立即降级为兼容入口：注册 `sidebar.footer.action` 打开按钮与 `shell.overlay` 工作台组件，overlay 仅在用户点击按钮后显示，不再默认注册、不再自动弹出；
- 原生 Tab 渲染窄侧栏版 `native-workbench` 内容工作台（项目选择/新建、标题、创作流程、编辑、任务、版本历史、Markdown 导出），并展示当前 DSH 会话的 `sessionId` 与 `cwd`/`repoRoot`；Tab 可见时若仓库为空会自动初始化；
- 支持 DSH session scope：Tab 组件接收 `scope` 并把 `sessionId`、`cwd` 传入 UI；当前 MVP 仍为共享 controller，代码内已注明该边界；
- 完善任务失败展示：新增客户端安全错误归一化（`errors.ts`），按 Harness 稳定错误码给出原因、请求阶段与建议（如 `LLM_PROVIDER_FAILED` → 提示检查当前 DSH profile 的模型配置），并对未知错误做 API Key / Authorization / 堆栈脱敏；任务失败状态显示可读原因而非单纯"失败"；
- 明确模型配置边界：provider/model 仅为可被宿主 profile 覆盖的默认值，所有生成调用继续通过 Harness `ctx.llm.stream`，不读取 API Key、不直连外部模型服务；
- 声明 `dsh-better-sidebar` 为 optional peerDependency（宿主能力，不打包、不重复安装）；由于该包的传递依赖含私有 registry 产物，编译期类型继续使用仓库内的结构化适配器（`better-sidebar-adapter.ts`）；
- 新增/更新测试：Better Sidebar Tab 注册、Tab ID/标题、Cordis disposer 契约、重复注册与卸载、缺少/形态异常 betterSidebar 的降级、原生工作台最小上下文渲染、session scope 透传、失败错误卡片、任务状态标签与既有功能回归。

## [0.7.3] - 2026-09-02

- 文档：同步 GitHub 仓库公开后的安装说明，并修正 ddsh-humanink-0.7.2.tgzd 版本示例。

## [0.7.2] - 2026-09-02

- 修正文档，明确当前 GitHub 仓库为私有仓库，并补充 DSH Desktop 的凭据前置条件和本地 tarball 安装路径。

## [0.7.1] - 2026-09-02

- 对齐 DSH Desktop 的普通第三方插件接入方式：继续使用标准 ddsh.bundled、ddsh.clientd 和 d./clientd 导出，不引入 Electron 私有 API；
- 补充 DSH Desktop 安装、重启和真实宿主验收说明；
- 增加桌面兼容性契约测试，防止 Client manifest 或 Electron 边界回归。

## [0.7.0] - 2026-09-02

- 新增集成在 ddsh webd 内的 HumanInk 三栏 React 内容工作台；
- 新增 dsidebar.footer.actiond 入口和 dshell.overlayd 全屏工作台，支持项目、版本、编辑、预览、导出和任务操作；
- 新增 Host UI facade 与 d/humaninkd Connection RPC，复用现有领域服务、JSONL 存储和任务运行时；
- 新增项目列表仓储能力，UI 与命令共用同一内容版本链；
- 根 Bundle 新增 d./clientd Browser 入口和 ddsh.clientd manifest，生成 lazy-CJS closure 形状的 Client 产物；
- 保持搜图、AI 封面、自动选题、腾讯朱雀检测和平台发布在后续版本。

## [0.6.2] - 2026-09-01

- 更新 README 标题和安装包示例，明确 ddsh-humaninkd 是可安装 Bundle 名称、HumanInk 是产品品牌，并保持 d/humanink-*d 命令兼容。

## [0.6.1] - 2026-09-01

- 将可安装的 DeepSeek Harness Bundle、插件标识和 GitHub 安装示例统一为 ddsh-humaninkd；保留 HumanInk 产品品牌、d@humanink/*d 内部包名和 d/humanink-*d 用户命令，避免破坏已有工作流程。


## [0.6.0] - 2026-09-01

- 按 DeepSeek Harness 官方 bundle 机制补充根目录可安装组合包 manifest、Cordis patch 和 prepare 构建入口。
- 导出 Harness 标准 Config schema，为 provider、model、dataDir、超时和重试参数提供校验与默认值。
- 新增一键安装、profile 启动、源码构建授权和 tarball 交付说明。
- 使用 tsdown 生成自包含 Harness 入口，避免 GitHub 安装依赖旁边存在 monorepo。
## [0.5.1] - 2026-09-01

- 删除独立产品演示页目录和对应的历史实现计划文档，当前交付聚焦命令驱动的 MVP 文字闭环。
- 重写 README，明确当前能力、Harness 接入方式、标准命令流、任务恢复和产品边界。
- 新增 ddocs/usage.mdd 使用文档，补齐安装验证、命令参数、工作流示例、任务状态、本地数据文件和错误码说明。
- 更新架构参考文档，移除对独立演示页作为当前交付物的依赖说明，保留正式 Client UI 的后续接入边界。

## [0.5.0] - 2026-08-31

- 新增人味化改写与发布前复核：基于指定内容版本分别创建独立的 dhumanizedd 和 dreviewd 版本，不覆盖原稿，并输出修改说明、待确认问题和结构化复核结论。
- 新增由 Core 计算的真实内容 Diff 与保护字段校验；模型生成的修改说明仅用于解释改写意图，保护字段被删除、改写或无法从源稿定位时阻止人味化版本落库。
- 新增 d/humanink-humanized 与 d/humanink-reviewd Harness 命令，打通 ddraft → humanized → review → Markdown 导出d 的持久化闭环。
- 新增 dtransactions.jsonld 可恢复提交日志，用于在进程崩溃后恢复内容版本与项目当前版本指针，并按 doperationIdd 对账；该机制不宣称突然断电场景下的数据库级原子性。
- 保持 0.4 的五种公开任务状态不变；运行中取消通过 dcancellationRequested=trued 与 dcancelRequestedAtd 表示。重启恢复时会按 doperationIdd 与内容仓储对账，若内容已提交但完整 dtask resultd 未落盘，则返回 dTASK_RECOVERY_REQUIREDd 要求人工核对。
- 新增 LLM 单次超时、有限次数重试和固定退避；仅重试明确的临时故障，不重试取消、非法 JSON 或结构校验错误，并对外只暴露稳定错误码与安全提示，隐藏 Provider 原始消息、堆栈和凭据。
- 补充 Core、Storage 与 Harness 单元及端到端测试，覆盖人味化/复核闭环、真实 Diff、保护字段违规、非法模型输出、事务恢复、错误脱敏和运行中取消场景。

## [0.4.0] - 2026-08-31

- 新增 JSONL 内容仓储，持久化项目与内容版本，并支持启动恢复、引用校验、幂等写入和不可变快照。
- 新增内容简报、文章大纲和 Markdown 初稿生成用例，建立 dsource → brief → outline → draftd 版本链。
- 新增 DeepSeek Harness 插件入口、LLM 流式适配器和 8 个官方命名规则兼容的 HumanInk 命令。
- 新增异步任务运行时与 dtasks.jsonld 持久化，覆盖排队、运行、成功、失败、取消和进程中断恢复。
- 新增标题到初稿的持久化 MVP 集成测试、Markdown 导出和安装/命令使用说明。

## [0.3.0] - 2026-08-31

- 增加 dLlmProviderd 抽象接口，为后续 Harness 和多模型接入保留稳定边界。
- 增加中文标题候选生成用例，支持结构化输出、候选清洗、数量约束、取消检查和模型元数据记录。
- 加强内容仓储的项目、父版本和当前版本引用校验，扩大版本冲突检测范围并保持不可变快照。
- 调整项目初始化顺序，避免 source 版本保存失败时留下悬空的当前版本指针。
- 增加标题生成、仓储边界、项目初始化失败路径的自动化测试。

## [0.2.0] - 2026-08-31

- 建立 TypeScript ESM workspace 和 d@humanink/cored 包。
- 实现内容项目、原始内容版本、派生版本、历史恢复和内存仓储。
- 增加不可变版本、内容哈希、幂等保存、冲突检测及父版本归属校验。
- 增加中文模板化诊断规则，支持轻度、标准和深度三种人味化分析模式。
- 增加 Vitest 测试、TypeScript 类型检查和 Core 构建脚本。
- 增加 workspace 依赖锁文件和本地 pnpm store 的忽略规则，保证安装结果可复现且缓存不进入版本库。

## [0.1.3] - 2026-08-31

- 增加 HumanInk 技术栈与系统架构参考文档，明确 Harness 适配层、独立 Core、Provider、版本化存储和测试门禁。
- 明确朱雀检测仅作为可选外部参考，不阻塞内容工作流，不自动循环改写或宣称真人认证。
- 增加 d.humanink/d 本地内容数据目录的 Git 忽略规则，避免正文、任务和检测数据误提交。

## [0.1.2] - 2026-08-31

- 增加 ddemo/d 交互式 HTML5 Demo，展示 HumanInk 通用内容工作台的文章生产流程。
- 增加标题切换、人味化模拟、朱雀检测模拟、主题切换、响应式布局和 Markdown 导出交互。
- 明确 Demo 使用本地演示数据，不连接真实模型、搜索服务或朱雀 API。

## [0.1.1] - 2026-08-31

- 增加 HumanInk 通用中文内容工作台 MVP 产品文档。
- 明确中文人味化、人类参与、内容版本和发布前复核原则。
- 将腾讯朱雀 AI 检测定义为可选的外部参考检测能力。
- 划定 P0 文字内容闭环，以及 P1 视觉和实时研究、P2 平台和增长能力边界。

## [0.1.0] - 2026-08-31

- 初始化 Git 版本管理。
- 增加 dAGENTS.mdd，规定每次改动提交版本并在完成后自测。
- 增加根目录 dVERSIONd 文件。
