import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HumanInkWorkbenchController } from '../src/controller.js';
import { createHumanInkFakeApi } from '../src/fake-api.js';
import { HumanInkWorkbench } from '../src/react-ui.js';

describe('React HumanInk workbench', () => {
  it('renders a paper-and-ink three-column workspace with the main workflow controls', async () => {
    const controller = new HumanInkWorkbenchController(createHumanInkFakeApi());
    await controller.initialize();
    controller.open();
    const html = renderToStaticMarkup(createElement(HumanInkWorkbench, { controller }));
    expect(html).toContain('humanink-workbench');
    expect(html).toContain('humanink-rail');
    expect(html).toContain('humanink-editor');
    expect(html).toContain('humanink-assistant');
    expect(html).toContain('新建文章');
    expect(html).toContain('编辑');
    expect(html).toContain('预览');
    expect(html).toContain('生成简报');
    expect(html).toContain('人味化改写');
    expect(html).toContain('版本历史');
    expect(html).toContain('导出 Markdown');
    expect(html).toContain('pointer-events:auto');
  });

  it('renders preview content and queued task status from controller state', async () => {
    const controller = new HumanInkWorkbenchController(createHumanInkFakeApi());
    await controller.initialize();
    controller.open();
    controller.setMode('preview');
    await controller.triggerAction('review');
    const html = renderToStaticMarkup(createElement(HumanInkWorkbench, { controller }));
    expect(html).toContain('humanink-preview');
    expect(html).toContain('不是所有的茶');
    expect(html).toContain('排队中');
    expect(html).toContain('取消');
  });
});
