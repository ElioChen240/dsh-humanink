import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HumanInkWorkbenchController } from '../src/controller.js';
import { createHumanInkFakeApi } from '../src/fake-api.js';
import { createHumanInkNativeTab, HumanInkNativeWorkbench } from '../src/native-workbench.js';
import { HumanInkApiError } from '../src/errors.js';

function createController(): { controller: HumanInkWorkbenchController; api: ReturnType<typeof createHumanInkFakeApi> } {
  const api = createHumanInkFakeApi();
  return { controller: new HumanInkWorkbenchController(api), api };
}

describe('HumanInk native Better Sidebar workbench', () => {
  it('renders the narrow-sidebar workbench with session scope and main workflow controls', async () => {
    const { controller } = createController();
    await controller.initialize();
    const html = renderToStaticMarkup(createElement(HumanInkNativeWorkbench, {
      controller,
      sessionId: 'session-1234567890abcdef',
      cwd: 'E:/work/HumanInk',
      visible: true,
    }));

    expect(html).toContain('humanink-native');
    expect(html).toContain('会话 session-…');
    expect(html).toContain('目录 E:/work/HumanInk');
    expect(html).toContain('新建');
    expect(html).toContain('标题');
    expect(html).toContain('简报');
    expect(html).toContain('大纲');
    expect(html).toContain('初稿');
    expect(html).toContain('人味化');
    expect(html).toContain('复核');
    expect(html).toContain('版本历史');
    expect(html).not.toContain('humanink-overlay-screen');
    expect(html).not.toContain('role="dialog"');
  });

  it('renders without browser globals and without a session id', async () => {
    const { controller } = createController();
    const tab = createHumanInkNativeTab(controller);
    const html = renderToStaticMarkup(tab({ ctx: null, scope: { sessionId: '' }, visible: false }));
    expect(html).toContain('未知会话');
    expect(html).toContain('HumanInk');
  });

  it('passes scope.sessionId and scope.cwd through the Better Sidebar tab factory', async () => {
    const { controller } = createController();
    await controller.initialize();
    const tab = createHumanInkNativeTab(controller);
    const html = renderToStaticMarkup(tab({
      ctx: null,
      scope: { sessionId: 'sess-abc123', cwd: 'E:/content/site', repoRoot: 'E:/content/site' },
      visible: true,
    }));
    expect(html).toContain('会话 sess-abc123');
    expect(html).toContain('目录 E:/content/site');
  });

  it('shows a structured safe error card when a workflow fails', async () => {
    const { controller, api } = createController();
    await controller.initialize();
    await controller.selectProject('project-tea');
    vi.spyOn(api, 'runWorkflow').mockRejectedValue(new HumanInkApiError('模型服务暂时不可用，请稍后重试', 'LLM_PROVIDER_FAILED'));

    await expect(controller.triggerAction('draft')).rejects.toThrow();
    const html = renderToStaticMarkup(createElement(HumanInkNativeWorkbench, {
      controller,
      sessionId: 'session-1',
      visible: true,
    }));

    expect(html).toContain('操作未完成');
    expect(html).toContain('原因：Harness 当前 provider/model 调用失败');
    expect(html).toContain('请求阶段：ctx.llm.stream');
    expect(html).toContain('建议：检查当前 DSH profile 的模型配置');
    expect(html).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(html).not.toContain('Authorization');
  });

  it('renders failed tasks with a readable reason instead of a bare status', async () => {
    const { controller, api } = createController();
    await controller.initialize();
    await controller.selectProject('project-tea');
    const task = await controller.triggerAction('titles');
    await api.advanceTask(task.id, 'failed', '模型返回格式无效，请重试或调整输入');
    await controller.refreshTasks();

    const html = renderToStaticMarkup(createElement(HumanInkNativeWorkbench, {
      controller,
      sessionId: 'session-1',
      visible: true,
    }));
    expect(html).toContain('is-failed');
    expect(html).toContain('失败');
    expect(html).toContain('原因：模型返回格式无效，请重试或调整输入');
  });

  it('exposes the task lifecycle labels for every task status', async () => {
    const statuses = [
      { status: 'queued', label: '排队' },
      { status: 'running', label: '生成中' },
      { status: 'succeeded', label: '完成' },
      { status: 'failed', label: '失败' },
      { status: 'cancelled', label: '已取消' },
    ] as const;
    for (const { status, label } of statuses) {
      const { controller, api } = createController();
      await controller.initialize();
      await controller.selectProject('project-tea');
      const task = await controller.triggerAction('review');
      await api.advanceTask(task.id, status);
      await controller.refreshTasks();
      const html = renderToStaticMarkup(createElement(HumanInkNativeWorkbench, {
        controller,
        sessionId: 'session-1',
        visible: true,
      }));
      expect(html, `status ${status}`).toContain(label);
    }
  });
});
