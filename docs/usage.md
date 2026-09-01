# HumanInk 使用文档

本文说明 HumanInk 当前 MVP 的安装、Harness 接入、命令流、任务管理、本地数据文件和故障排查。当前交付物是命令驱动的通用中文内容工作台，不包含独立产品演示页，也不绑定微信公众号、小红书、抖音、知乎等单一平台。

## 1. 前置条件

- Node.js 22.19+；
- pnpm 11.x，或使用 `npx --yes pnpm@11.7.0 ...`；
- DeepSeek Harness 宿主已提供 `commands` 和 `llm` 服务；
- 宿主中存在与配置一致的 LLM provider route 和模型；
- 当前进程对 `dataDir` 有读写权限。

## 2. 安装与本地验证

```powershell
npx --yes pnpm@11.7.0 install
npx --yes pnpm@11.7.0 test
npx --yes pnpm@11.7.0 typecheck
npx --yes pnpm@11.7.0 build
```

如果只验证本轮 MVP 主链路，可运行：

```powershell
npx --yes pnpm@11.7.0 test:mvp
```

## 3. 一键安装为 Harness bundle

DeepSeek Harness 的可安装插件不是单个源码文件，而是一个带 `dsh.bundle` manifest 的 npm 组合包。HumanInk 根目录已经提供：

- `main`：指向构建后的插件入口；
- `files`：只发布运行所需的构建产物和 patch；
- `dsh.bundle.patch`：把 `humanink` 插件行加入 profile；
- `prepare`：从 GitHub 源码安装时先构建 Core、Storage 和 Harness。

Harness CLI 已安装时，直接执行：

```powershell
dsh plugin --profile humanink add github:ElioChen240/dsh-humanink#main
dsh --profile humanink --dump-config
dsh --profile humanink web
```

建议使用固定 commit 或 release tag，不要依赖会继续变化的分支。Git 源码安装会在本机执行 `prepare`，pnpm 10 及以上可能要求用户确认构建授权；只对可信源码授权。

如果要避免安装时构建，可以在可信环境执行 `pnpm pack`，再安装生成的 tarball：

```powershell
npx --yes pnpm@11.7.0 pack
dsh plugin --profile humanink add .\dsh-humanink-0.6.1.tgz
```

当前 bundle 的默认配置由 Harness 标准 schema 提供：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `provider` | `deepseek` | Harness 中已注册的 LLM provider route。 |
| `model` | `deepseek-chat` | 默认模型名，可在 profile patch 中覆盖。 |
| `dataDir` | `.humanink` | 本地 JSONL 数据目录。 |
| `timeoutMs` | `60000` | 单次模型调用超时。 |
| `maxAttempts` | `3` | 临时错误最大尝试次数。 |
| `backoffMs` | `500` | 重试退避基准毫秒数。 |

## 4. Harness 接入

在 Harness 插件宿主中加载 `@humanink/harness` 的 `apply`：

```ts
import { apply } from '@humanink/harness';

const dispose = apply(ctx, {
  provider: 'deepseek',
  model: 'deepseek-chat',
  dataDir: '.humanink',
  timeoutMs: 60_000,
  maxAttempts: 3,
  backoffMs: 500,
});

// 宿主卸载插件时调用
// dispose();
```

配置说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `provider` | 是 | Harness 宿主中已注册的 LLM provider route，例如 `deepseek`。 |
| `model` | 是 | 传给宿主 LLM 服务的模型名，例如 `deepseek-chat`。 |
| `dataDir` | 否 | 本地 JSONL 数据目录，默认 `.humanink`。 |
| `timeoutMs` | 否 | 单次模型请求超时时间。 |
| `maxAttempts` | 否 | 临时模型错误的最大尝试次数。取消、非法 JSON 和结构校验错误不会重试。 |
| `backoffMs` | 否 | 重试退避基准时间。 |

HumanInk 不读取或保存 API Key；凭据由 Harness 宿主或其 Credentials 服务管理。

## 5. 命令总览

| 命令 | 输入 | 输出/效果 |
| --- | --- | --- |
| `/humanink-create` | JSON 对象 | 创建项目和 `source` 版本，立即返回 `projectId` 与 `sourceVersionId`。 |
| `/humanink-title` | JSON 对象 | 启动标题候选任务，立即返回 `taskId`。 |
| `/humanink-brief` | JSON 对象 | 启动内容简报任务，立即返回 `taskId`。 |
| `/humanink-outline` | JSON 对象 | 启动文章大纲任务，立即返回 `taskId`。 |
| `/humanink-draft` | JSON 对象 | 启动 Markdown 初稿任务，立即返回 `taskId`。 |
| `/humanink-humanize` | JSON 对象 | 启动人味化改写任务，成功时创建 `humanized` 版本。 |
| `/humanink-review` | JSON 对象 | 启动发布前复核任务，成功时创建 `review` 版本。 |
| `/humanink-task` | `taskId` 或 `{"taskId":"..."}` | 查询任务快照、状态和结果。 |
| `/humanink-cancel` | `taskId` 或 `{"taskId":"..."}` | 请求取消尚未结束的任务。 |
| `/humanink-export` | `versionId` 或 `{"versionId":"..."}` | 导出指定内容版本的 Markdown。 |

## 6. 标准工作流：从标题到文章

### 5.1 创建项目

```text
/humanink-create {"title":"社区咖啡店如何留下熟客","source":{"format":"markdown","title":"社区咖啡店如何留下熟客","body":"一家街角咖啡店想减少对低价促销的依赖，希望把熟客关系做得更稳。"},"metadata":{"channel":"generic"}}
```

成功返回：

```json
{"projectId":"project_x","sourceVersionId":"version_source"}
```

### 5.2 生成标题候选

```text
/humanink-title {"projectId":"project_x","sourceVersionId":"version_source","brief":"面向小店主，讲社区店如何靠关系和体验留客","audience":"社区门店经营者","count":5}
```

该命令立即返回任务 ID：

```json
{"taskId":"task_title","status":"queued"}
```

随后查询：

```text
/humanink-task task_title
```

任务成功后，`result.candidates` 中包含标题候选、策略、理由和风险提示。选择一个标题后，把它作为后续简报的 `selectedTitle`。

### 5.3 生成内容简报

```text
/humanink-brief {"projectId":"project_x","sourceVersionId":"version_source","selectedTitle":"社区咖啡店留住熟客，靠的不是打折","audience":"社区门店经营者","objective":"提供可执行的留客思路","angle":"从老板日常经营复盘切入","constraints":"避免夸大收益，不编造数据","protectedFields":["不依赖低价促销"],"sourceRefs":["用户原始素材"]}
```

成功任务结果会返回新的 `contentVersionId`，该版本类型为简报。简报通常包含目标读者、核心观点、素材缺口和需要用户确认的问题。

### 5.4 生成文章大纲

```text
/humanink-outline {"projectId":"project_x","briefVersionId":"version_brief","extraDirection":"结构要适合 5 分钟阅读，先讲误区再讲做法","protectedFields":["不依赖低价促销"],"sourceRefs":["用户原始素材"]}
```

成功后用任务结果里的 `contentVersionId` 作为 `outlineVersionId`。

### 5.5 生成 Markdown 初稿

```text
/humanink-draft {"projectId":"project_x","briefVersionId":"version_brief","outlineVersionId":"version_outline","tone":"像店主复盘经验，克制、具体、不喊口号","length":"medium","protectedFields":["不依赖低价促销"],"sourceRefs":["用户原始素材"]}
```

`length` 只接受 `short`、`medium` 或 `long`。成功后会创建 `draft` 版本。

## 7. 标准工作流：改写已有内容

如果已有一段文章，可以先把原文作为 `source.body` 创建项目，再直接生成简报、大纲，或对指定版本执行人味化：

```text
/humanink-humanize {"projectId":"project_x","versionId":"version_draft","direction":"删掉宣传腔，增加具体场景和自然转折，保留所有数字、人名、时间和结论","protectedFields":["2026 年春季复盘","不依赖低价促销"],"sourceRefs":["用户原始素材"]}
```

人味化任务结果重点看四类字段：

- `result.output.text`：模型给出的改写正文；
- `result.output.changes`：模型说明的修改意图；
- `result.diff`：Core 根据改写前后文本确定性计算的真实 Diff；
- `result.protectedFieldValidation`：保护字段是否仍可在改写稿中定位；
- `result.output.questions`：仍需用户补充或确认的问题。

如果保护字段被删除、改写或无法定位，任务会失败并返回 `HUMANIZE_PROTECTED_FIELD_VALIDATION_FAILED`，不会保存新的 `humanized` 版本。

## 8. 发布前复核

对任意文章版本运行：

```text
/humanink-review {"projectId":"project_x","versionId":"version_humanized","focus":"标题兑现、模板化表达、事实风险、隐私风险","protectedFields":["不依赖低价促销"],"sourceRefs":["用户原始素材"]}
```

复核任务成功后重点看：

- `result.output.verdict`：`pass` 或 `needs_revision`；
- `result.output.summary`：整体摘要；
- `result.output.findings`：按类别、严重度、片段和建议组织的问题清单；
- `contentVersionId`：本次复核结果对应的新版本。

复核不是事实认证、版权审计或自动发布许可；它只提示发布前应人工确认的问题。

## 9. 导出

```text
/humanink-export version_humanized
```

或：

```text
/humanink-export {"versionId":"version_humanized"}
```

当前导出格式为 Markdown。HTML、TXT、多平台格式和发布接口留到后续版本。

## 10. 任务状态与取消

任务快照包含以下稳定字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 任务 ID。 |
| `operationId` | 用于任务、事务和内容版本对账的操作 ID。 |
| `projectId` | 任务所属项目。 |
| `type` | 任务类型，例如 `title`、`draft`、`humanize`、`review`。 |
| `status` | `queued`、`running`、`succeeded`、`failed` 或 `cancelled`。 |
| `contentVersionId` | 成功创建或已提交的内容版本 ID。 |
| `result` | 任务成功后的结构化结果。 |
| `errorCode` | 失败或取消时的稳定错误码。 |
| `safeMessage` | 可展示给用户的安全错误说明。 |
| `cancellationRequested` | 运行中取消请求已被接受。 |
| `cancelRequestedAt` | 取消请求时间。 |
| `startedAt` / `finishedAt` | 任务开始和结束时间。 |

取消任务：

```text
/humanink-cancel task_x
```

取消是协作式的：如果任务已结束或不存在，会返回 `TASK_NOT_CANCELLABLE`；如果模型请求已进入不可中断阶段，可能需要等待当前步骤落盘后才进入终态。

## 11. 本地数据文件

默认数据目录是 `.humanink/`，可通过 `dataDir` 改写：

| 文件 | 说明 |
| --- | --- |
| `projects.jsonl` | 内容项目、当前版本指针和元数据。 |
| `versions.jsonl` | 不可变内容版本快照。 |
| `transactions.jsonl` | 内容版本与项目指针的可恢复提交日志。 |
| `tasks.jsonl` | 任务状态、结果、错误码和恢复信息。 |

排障时优先用 `task.operationId` 对照 `transactions.jsonl` 与 `tasks.jsonl`。不要把 `.humanink/` 提交到 Git。

## 12. 错误码与处理建议

| 错误码 | 常见原因 | 建议 |
| --- | --- | --- |
| `INVALID_INPUT` | 命令不是合法 JSON，或字段缺失/多余/类型错误。 | 对照本文件示例检查字段名和 ID。 |
| `TASK_NOT_FOUND` | 查询了不存在的任务。 | 确认使用的是任务 ID，不是版本 ID。 |
| `TASK_NOT_CANCELLABLE` | 任务不存在或已结束。 | 刷新任务状态后再决定是否重试。 |
| `TASK_CANCELLED` | 用户或宿主取消任务。 | 如仍需要结果，重新发起生成命令。 |
| `TASK_INTERRUPTED` | 进程重启后发现任务未完成且无可恢复结果。 | 重新执行对应任务。 |
| `TASK_RECOVERY_REQUIRED` | 内容版本已保存，但完整任务结果未完整持久化。 | 人工核对 `contentVersionId`、版本内容和任务日志后再继续。 |
| `TASK_STORE_FAILED` | 任务状态写入失败。 | 检查 `dataDir` 权限和磁盘空间。 |
| `LLM_TIMEOUT` | 模型请求超时。 | 增大 `timeoutMs` 或稍后重试。 |
| `LLM_INVALID_RESPONSE` | 模型返回不是预期 JSON 或结构不合法。 | 调整输入，必要时更换模型或提示词版本。 |
| `LLM_PROVIDER_FAILED` | 模型服务临时不可用。 | 稍后重试；不要把原始 provider 错误展示给最终用户。 |
| `HUMANIZE_PROTECTED_FIELD_VALIDATION_FAILED` | 人味化结果破坏了保护字段。 | 缩小改写范围，明确要求保留数字、人名、时间和关键结论。 |
| `HUMANINK_CAPABILITY_UNAVAILABLE` | 当前能力未启用或 Provider 未配置。 | 检查宿主配置，或跳过该能力继续文字流程。 |

## 13. 当前边界与后续能力

当前版本只保证命令驱动的文字工作流。以下能力尚未作为可交付功能：

- 腾讯朱雀检测正式接入；
- 搜图、图片版权记录和 AI 封面生成；
- 热点抓取和自动选题；
- 平台专属格式、多平台分发和自动发布；
- 正式可视化 Client UI。

这些能力后续接入时必须保持：用户主动触发、结果绑定版本、失败不阻塞文字流程、日志不泄露正文和凭据。
