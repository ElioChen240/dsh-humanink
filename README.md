# HumanInk

HumanInk 是面向中文自媒体创作者的通用内容工作台，也是一个 DeepSeek Harness 插件。它把选题、标题、简报、大纲、初稿、人味化改写、发布前复核、任务查询/取消和导出串成一条本地可恢复的内容生产链路。

## 当前能力

- 中文标题候选生成，包含策略、理由和风险标记；
- 内容简报、大纲和 Markdown 初稿生成；
- 人味化改写：改善中文语感、具体性和表达节奏，输出修改说明、真实 Diff、保护字段校验结果和待确认问题；
- 发布前复核：生成独立 review 版本，检查标题兑现、模板化表达、重复、清晰度、结构、风格、推测和隐私等问题，并标记需要人工确认的表述；
- 原稿、改写稿和复核结果使用独立版本保存，保留父版本链、sourceRefs 和 protectedFields；
- DeepSeek Harness `commands` 与 `llm` 服务适配；
- 任务对外公开状态保持 0.4 兼容：`queued`、`running`、`succeeded`、`failed`、`cancelled`；
- 运行中取消通过 `cancellationRequested=true` 和 `cancelRequestedAt` 表示；
- 内容提交可恢复；如果内容已提交但完整 `task result` 未落盘，任务会返回 `TASK_RECOVERY_REQUIRED` 要求人工核对；
- Markdown 导出；
- Core、Storage、Harness 分层测试。

尚未进入本次 MVP 的能力：腾讯朱雀接入、搜图/AI 封面、自动选题和平台发布。

## 工作区

```text
packages/
├─ humanink-core/       # 内容项目、版本、生成用例和领域规则
├─ humanink-storage/    # projects.jsonl / versions.jsonl / transactions.jsonl
└─ humanink-harness/    # Harness 插件、命令、LLM 适配和 tasks.jsonl
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

## Harness 配置

插件入口导出 `apply`、`name` 和 `inject`。宿主需要已提供 DeepSeek Harness 的 `commands` 与 `llm` 服务，并配置一个可用的 provider route 和模型：

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

## 命令

DeepSeek Harness 官方命令名只允许小写字母、数字、下划线和连字符，因此 HumanInk 使用以下命令：

| 命令 | 作用 |
| --- | --- |
| `/humanink-create` | 创建项目和 source 版本 |
| `/humanink-title` | 启动标题候选任务 |
| `/humanink-brief` | 启动内容简报任务 |
| `/humanink-outline` | 启动文章大纲任务 |
| `/humanink-draft` | 启动 Markdown 初稿任务 |
| `/humanink-humanize` | 对指定内容版本执行人味化改写 |
| `/humanink-review` | 对指定文章版本执行发布前复核 |
| `/humanink-task` | 查询任务状态和结果 |
| `/humanink-cancel` | 取消未完成任务 |
| `/humanink-export` | 导出指定版本的 Markdown |

### 1. 创建项目

```text
/humanink-create {"title":"社区咖啡店如何留下熟客","source":{"title":"社区咖啡店如何留下熟客","body":"一家街角咖啡店想减少对低价促销的依赖。"}}
```

返回 `projectId` 和 `sourceVersionId`。

### 2. 生成标题并查询结果

```text
/humanink-title {"projectId":"project_x","sourceVersionId":"version_x","count":5}
/humanink-task task_x
```

生成命令会立即返回 `taskId`。任务成功后，查询结果中的 `result.candidates` 包含标题候选。

### 3. 生成简报、大纲和初稿

选择标题候选后，可将标题作为 `selectedTitle` 传给简报：

```text
/humanink-brief {"projectId":"project_x","sourceVersionId":"version_source","selectedTitle":"社区咖啡店留住熟客，靠的不是打折"}
/humanink-outline {"projectId":"project_x","briefVersionId":"version_brief"}
/humanink-draft {"projectId":"project_x","briefVersionId":"version_brief","outlineVersionId":"version_outline"}
```

每一步都需要通过 `/humanink-task task_x` 等待成功，并从 `contentVersionId` 取得下一步版本 ID。

### 4. 人味化改写与发布前复核

初稿完成后，对初稿版本创建独立的人味化版本；任务成功后，再对人味化版本创建复核结果版本：

```text
/humanink-humanize {"projectId":"project_x","versionId":"version_draft","direction":"增加具体场景，保留事实和保护字段"}
/humanink-review {"projectId":"project_x","versionId":"version_humanized"}
```

两条生成命令都会立即返回 `taskId`，需要继续调用 `/humanink-task task_x` 获取完整结果。人味化任务结果中的字段含义如下：

- `result.output.changes`：模型生成的修改说明，用于解释改写意图，不等同于可信 Diff；
- `result.diff`：Core 根据改写前后文本确定性计算的真实差异；
- `result.protectedFieldValidation`：保护字段的确定性校验结果；
- `result.output.questions`：需要用户补充或确认的信息。

如果模型删除、改写或无法从原稿定位 `protectedFields`，人味化任务会失败，不会创建 `humanized` 版本。复核结果包含 `pass` 或 `needs_revision` 结论，以及按类别和严重度组织的问题清单。两步都不会覆盖输入版本。

### 5. 导出 Markdown

```text
/humanink-export version_humanized
```

## 任务状态、取消与恢复

HumanInk 0.5.0 对外继续使用 0.4 的五种任务状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`。运行中取消请求不会引入新的公开状态，而是通过 `cancellationRequested=true` 和 `cancelRequestedAt` 记录。

恢复时，任务运行时会按 `operationId` 与内容仓储对账。如果内容版本已经提交且完整 `task result` 也已落盘，任务可以恢复为 `succeeded`。如果确认内容已提交，但完整 `task result` 没有写入 `tasks.jsonl`，任务会标记为 `failed` 并返回 `TASK_RECOVERY_REQUIRED`，要求人工核对，避免在缺失真实 Diff、保护字段校验或复核结构化结果时误报完整成功。

## 产品边界

- “人味化”用于改善中文语感、具体性和表达节奏，不承诺绕过 AI 检测；
- 不会自动循环改写以降低腾讯朱雀或其他检测分数；
- 发布前复核只标记疑似缺少素材支撑、存在风险或需要人工确认的内容，不是事实认证或合规审计；
- 当前 `sourceRefs` 只用于来源追踪，尚不解析引用内容，也不执行证据级事实比对；
- 复核结果为 `pass` 只表示当前检查未发现需要修订的问题，不是自动发布许可，最终发布决定仍由用户负责；
- 外部检测、配图和发布能力后续均通过独立 Provider 接入，不污染内容 Core。