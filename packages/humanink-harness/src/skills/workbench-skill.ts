export interface HumanInkSkillsContext { readonly skills: { register(skill: typeof HUMANINK_WORKBENCH_SKILL): () => void }; }

export const HUMANINK_WORKBENCH_SKILL = {
  name: 'humanink-workbench',
  description: '在 DeepSeek Harness 中配置并使用 HumanInk 本地内容工作台。',
  source: 'runtime' as const,
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# HumanInk 内容工作台

1. 不知道下一步或用户询问功能时，先调用 \`humanink_guide\`。首次使用先调用 \`humanink_setup\` 做只读诊断。
2. 配置默认使用 \`apply=false\` 预览精确变更；只有用户确认后，才能用同样字段和 \`apply=true\`。
3. 不要让用户在对话中发送 API Key、Token 或其他密钥；凭据只能在 DeepSeek Harness 的安全设置中配置。
4. 新建写作与基于原文的原创改写要明确区分。AI 写作、人味化和复核都创建新版本，不覆盖正式稿。
5. 异步工具返回“任务已启动”不等于完成；随后调用 \`humanink_get_task_status\`，只有状态成功且产物版本可读取时才报告完成。
6. 正文按需读取，不把整篇文章长期注入系统上下文。每次只推进当前缺失的下一步，未验证产物前不声称完成。`,
};

export function registerHumanInkWorkbenchSkill(ctx: HumanInkSkillsContext): () => void { return ctx.skills.register(HUMANINK_WORKBENCH_SKILL); }