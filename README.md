# HumanInk

HumanInk 是面向中文自媒体创作者的通用内容工作台，也是一个 DeepSeek Harness 插件。它把标题、内容简报、大纲、初稿、人味化改写、发布前复核、任务查询/取消和 Markdown 导出串成一条本地可恢复的内容生产链路。

当前仓库聚焦 **MVP 文字闭环**：先把内容生成、人味化、复核、版本管理和 Harness 命令做稳定；搜图、AI 封面、自动选题、腾讯朱雀检测和平台发布仍是后续 Provider/工作流扩展，不作为当前可交付功能。

## 当前能力

- 中文标题候选生成：输出标题、策略、理由和风险标记；
- 内容简报、大纲和 Markdown 初稿生成；
- 人味化改写：改善中文语感、具体性和表达节奏，输出修改说明、真实 Diff、保护字段校验结果和待确认问题；
- 发布前复核：生成独立 `review` 版本，检查标题兑现、模板化表达、重复、清晰度、结构、风格、推测和隐私等问题；
- 不可变内容版本：原稿、简报、大纲、初稿、改写稿和复核结果均保存为独立版本，保留父版本链、`sourceRefs` 和 `protectedFields`；
- DeepSeek Harness `commands` 与 `llm` 服务适配；
- 异步任务运行时：支持查询、取消、重启恢复和安全错误码；
- JSONL 本地存储：`.humanink/` 保存项目、版本、事务和任务状态；
- Markdown 导出；
- Core、Storage、Harness 分层测试。

## 不在当前 MVP 内

- 腾讯朱雀检测正式 API 接入；
- 搜图配图、图片版权记录和 AI 封面生成；
- 实时热点/自动选题；
- 平台专属规则、多平台分发或自动发布；
- 正式可视化 Client UI。

这些能力后续应通过独立 Provider 或 UI 模块接入，不能污染 Core 的内容版本不变量。

## 工作区结构

```text
packages/
├─ humanink-core/       # 内容项目、版本、生成用例、人味化和复核领域规则
├─ humanink-storage/    # projects.jsonl / versions.jsonl / transactions.jsonl
└─ humanink-harness/    # Harness 插件入口、命令、LLM 适配和 tasks.jsonl

docs/
├─ usage.md             # 安装、接入、命令流和故障排查
├─ architecture/        # 技术栈与架构参考
└─ superpowers/specs/   # 产品和 MVP 设计文档
```

默认数据目录为仓库或宿主进程工作目录下的 `.humanink/`：

```text
.humanink/
├─ projects.jsonl
├─ versions.jsonl
├─ transactions.jsonl
└─ tasks.jsonl
```

`transactions.jsonl` 记录内容版本与项目指针的可恢复提交过程。Storage 提供的是进程崩溃后的可恢复一致性；当前不宣称突然断电场景下的数据库级原子性。

该目录已加入 `.gitignore`，正文和任务数据不会被误提交到 Git。

## 一键安装到 DeepSeek Harness

HumanInk 已按 DeepSeek Harness 的 bundle 机制提供根目录组合包 manifest。Harness CLI 已安装时，可以直接把 GitHub 仓库安装到指定 profile：

```powershell
dsh plugin --profile humanink add github:ElioChen240/dsh-humanink#main
```

安装后启动并验证配置：

```powershell
dsh --profile humanink --dump-config
dsh --profile humanink web
```

GitHub 源码安装会执行包的 `prepare` 构建脚本。pnpm 10 及以上版本可能要求在 profile 的 `pnpm-workspace.yaml` 中显式允许构建：

```yaml
allowBuilds:
  humanink: true
```

如果不希望在安装时执行源码构建，可先在可信环境打包，再安装生成的 `.tgz`。完整说明见 [`docs/usage.md`](docs/usage.md)。

## 安装与验证

项目使用 pnpm workspace。若机器没有全局 pnpm，可通过 `npx` 调用固定版本：

```powershell
npx --yes pnpm@11.7.0 install
npx --yes pnpm@11.7.0 test
npx --yes pnpm@11.7.0 typecheck
npx --yes pnpm@11.7.0 build
```

也可使用仓库已安装的本地工具执行聚焦验证：

```powershell
node_modules\.bin\vitest.cmd run packages\humanink-core\tests
node_modules\.bin\vitest.cmd run packages\humanink-storage\tests
node_modules\.bin\vitest.cmd run packages\humanink-harness\tests
```

## Harness 接入

插件入口导出 `apply`、`name` 和 `inject`。宿主需要提供 DeepSeek Harness 的 `commands` 与 `llm` 服务，并配置可用的 provider route 和模型：

```ts
import { apply } from '@humanink/harness';

const dispose = apply(ctx, {
  dataDir: '.humanink',
  provider: 'deepseek',
  model: 'deepseek-chat',
  timeoutMs: 60_000,
  maxAttempts: 3,
  backoffMs: 500,
});
```

`provider` 和 `model` 必须与 Harness 宿主中已注册的 LLM Adapter 一致。`timeoutMs`、`maxAttempts` 和 `backoffMs` 用于控制单次超时和临时网络错误重试；取消、非法 JSON 和结构校验错误不会重试。任务只暴露稳定、安全的错误码和提示，不回传 Provider 的原始错误消息、堆栈或凭据。HumanInk 不读取或保存 API Key，凭据由 Harness 宿主负责。

## 标准命令流

1. 创建项目和原始素材版本：

   ```text
   /humanink-create {"title":"社区咖啡店如何留下熟客","source":{"title":"社区咖啡店如何留下熟客","body":"一家街角咖啡店想减少对低价促销的依赖。"}}
   ```

2. 生成标题候选并查询任务：

   ```text
   /humanink-title {"projectId":"project_x","sourceVersionId":"version_source","count":5}
   /humanink-task task_x
   ```

3. 选择标题后生成简报、大纲和初稿：

   ```text
   /humanink-brief {"projectId":"project_x","sourceVersionId":"version_source","selectedTitle":"社区咖啡店留住熟客，靠的不是打折"}
   /humanink-outline {"projectId":"project_x","briefVersionId":"version_brief"}
   /humanink-draft {"projectId":"project_x","briefVersionId":"version_brief","outlineVersionId":"version_outline","tone":"像店主复盘经验","length":"medium"}
   ```

4. 对初稿做人味化改写和发布前复核：

   ```text
   /humanink-humanize {"projectId":"project_x","versionId":"version_draft","direction":"增加具体场景，保留事实和保护字段"}
   /humanink-review {"projectId":"project_x","versionId":"version_humanized","focus":"标题兑现、模板化表达、事实风险"}
   ```

5. 导出 Markdown：

   ```text
   /humanink-export version_humanized
   ```

完整字段说明见 `docs/usage.md`。

## 任务状态、取消与恢复

HumanInk 对外使用五种任务状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`。运行中取消请求不会引入新的公开状态，而是通过 `cancellationRequested=true` 和 `cancelRequestedAt` 记录。

恢复时，任务运行时会按 `operationId` 与内容仓储对账。如果内容版本已经提交且完整 `task result` 也已落盘，任务可以恢复为 `succeeded`。如果确认内容已提交，但完整 `task result` 没有写入 `tasks.jsonl`，任务会标记为 `failed` 并返回 `TASK_RECOVERY_REQUIRED`，要求人工核对，避免在缺失真实 Diff、保护字段校验或复核结构化结果时误报完整成功。

## 产品边界

- “人味化”用于改善中文语感、具体性和表达节奏，不承诺绕过 AI 检测；
- 不会自动循环改写以降低腾讯朱雀或其他检测分数；
- 发布前复核只标记疑似缺少素材支撑、存在风险或需要人工确认的内容，不是事实认证或合规审计；
- 当前 `sourceRefs` 只用于来源追踪，尚不解析引用内容，也不执行证据级事实比对；
- 复核结果为 `pass` 只表示当前检查未发现需要修订的问题，不是自动发布许可，最终发布决定仍由用户负责；
- 外部检测、配图和发布能力后续均通过独立 Provider 接入。
