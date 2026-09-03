export interface HumanInkPromptContext { readonly libraryRoot?: string; readonly writingProfile: string; readonly selectedContent?: { readonly id: string; readonly title: string; readonly stage?: string; readonly versionId?: string }; readonly task?: { readonly id: string; readonly status: string }; }
export interface HumanInkSystemPromptContext { readonly systemPrompt: { section(section: { name: string; order: number; text: string | (() => string) }): () => void }; }

export function humanInkLibraryPromptText(context: HumanInkPromptContext): string {
  const lines = [
    'HumanInk 是集成在 DeepSeek Harness 中的本地 AI 内容工作台。首次使用或能力不明确时调用 humanink_setup；不确定下一步时调用 humanink_guide。',
    `内容目录：${context.libraryRoot ?? '未配置'}。磁盘文件和 HumanInk 版本链是内容真源；正文只在明确引用或工具任务需要时读取。`,
    `写作 profile：${context.writingProfile.trim() || '未配置'}。不要索取或注入 API Key、Token、Cookie 等凭据。`,
  ];
  if (context.selectedContent !== undefined) lines.push(`当前内容：${context.selectedContent.id} | ${context.selectedContent.title} | 阶段 ${context.selectedContent.stage ?? 'unknown'} | 版本 ${context.selectedContent.versionId ?? 'unknown'}。`);
  if (context.task !== undefined) lines.push(`当前任务：${context.task.id} | ${context.task.status}。任务启动不等于完成，必须查询状态并验证产物版本。`);
  lines.push('AI 生成、原创改写、人味化和复核必须创建新版本，不覆盖正式稿。');
  return lines.join('\n');
}

export function registerHumanInkLibraryPrompt(ctx: HumanInkSystemPromptContext, source: () => HumanInkPromptContext): () => void {
  return ctx.systemPrompt.section({ name: 'humanink:library', order: 120, text: () => humanInkLibraryPromptText(source()) });
}