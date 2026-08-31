# HumanInk

HumanInk 是一个面向中文自媒体创作者的通用内容工作台，也是一个 DeepSeek Harness 插件。当前 MVP 已打通：

```text
创建内容项目
→ 生成标题候选
→ 生成内容简报
→ 生成文章大纲
→ 生成 Markdown 初稿
→ 查询/取消任务
→ 导出指定内容版本
```

产品不绑定微信公众号、小红书、知乎等单一平台。每次 AI 生成都会创建新的内容版本，不会覆盖原始输入；项目、内容版本和任务状态保存在本地 JSONL 文件中。

## 当前能力

- 中文标题候选生成，包含策略、理由和风险标记；
- 内容简报、大纲和 Markdown 初稿生成；
- DeepSeek Harness `commands` 与 `llm` 服务适配；
- 异步任务状态：`queued`、`running`、`succeeded`、`failed`、`cancelled`；
- JSONL 启动恢复和中断任务标记；
- Markdown 导出；
- 中文模板化表达基础诊断；
- Core、Storage、Harness 分层测试。

尚未进入本次 MVP 的能力：正式人味化改写工作流、发布前复核、腾讯朱雀接入、搜图/AI 封面、自动选题和平台发布。

## 工作区

```text
packages/
├─ humanink-core/       # 内容项目、版本、生成用例和领域规则
├─ humanink-storage/    # projects.jsonl / versions.jsonl
└─ humanink-harness/    # Harness 插件、命令、LLM 适配和 tasks.jsonl
```

默认数据目录为仓库或宿主进程工作目录下的 `.humanink/`：

```text
.humanink/
├─ projects.jsonl
├─ versions.jsonl
└─ tasks.jsonl
```

该目录已加入 `.gitignore`，正文和任务数据不会被误提交到 Git。

## 安装与验证

项目使用 pnpm workspace。若机器没有全局 pnpm，可通过 `npx` 调用锁定版本：

```powershell
npx pnpm@11.7.0 install
npx pnpm@11.7.0 test
npx pnpm@11.7.0 typecheck
npx pnpm@11.7.0 build
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
});
```

`provider` 和 `model` 必须与 Harness 宿主中已注册的 LLM Adapter 一致。HumanInk 不读取或保存 API Key，凭据由 Harness 宿主负责。

Verified Harness contract versions: `@deepseek-ai/cordis@4.0.2`, `@deepseek-ai/dsh-commands@0.0.1-rc.1`, and `@deepseek-ai/dsh-llm@0.0.1-rc.1`. The plugin uses structural service boundaries so the host owns those runtime packages and credentials.

## 命令

DeepSeek Harness 官方命令名只允许小写字母、数字、下划线和连字符，因此 HumanInk 使用以下命令：

| 命令 | 作用 |
| --- | --- |
| `/humanink-create` | 创建项目和 source 版本 |
| `/humanink-title` | 启动标题候选任务 |
| `/humanink-brief` | 启动内容简报任务 |
| `/humanink-outline` | 启动文章大纲任务 |
| `/humanink-draft` | 启动 Markdown 初稿任务 |
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

### 4. 导出 Markdown

```text
/humanink-export version_draft
```

## 产品边界

- “人味化”用于改善中文语感、具体性和个人表达，不承诺绕过 AI 检测；
- 不自动循环改写以降低腾讯朱雀或其他检测分数；
- 不编造用户经历、数据或事实；
- 外部检测、图片和发布能力后续均通过独立 Provider 接入，不污染内容 Core。
