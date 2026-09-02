import { describe, expect, it } from 'vitest';
import { HumanInkWorkbenchController } from '../src/controller.js';
import { createHumanInkFakeApi } from '../src/fake-api.js';

describe('HumanInkWorkbenchController', () => {
  it('opens and closes the workbench without losing loaded projects', async () => {
    const controller = new HumanInkWorkbenchController(createHumanInkFakeApi());

    await controller.initialize();
    controller.open();
    expect(controller.getState().isOpen).toBe(true);
    expect(controller.getState().projects).toHaveLength(2);

    controller.close();
    expect(controller.getState().isOpen).toBe(false);
    expect(controller.getState().projects).toHaveLength(2);
  });

  it('selects a project and restores any version into the editor', async () => {
    const controller = new HumanInkWorkbenchController(createHumanInkFakeApi());
    await controller.initialize();

    await controller.selectProject('project-tea');
    expect(controller.getState().activeProjectId).toBe('project-tea');
    expect(controller.getState().activeVersionId).toBe('tea-v2');
    expect(controller.getState().editor.title).toBe('不是所有的茶，都适合慢慢喝');

    await controller.selectVersion('tea-v1');
    expect(controller.getState().activeVersionId).toBe('tea-v1');
    expect(controller.getState().editor.body).toContain('第一版');
    expect(controller.getState().editor.dirty).toBe(false);
  });

  it('creates a new project and selects its initial version', async () => {
    const controller = new HumanInkWorkbenchController(createHumanInkFakeApi());
    await controller.initialize();

    await controller.createProject('城市散步观察');

    expect(controller.getState().projects[0]?.title).toBe('城市散步观察');
    expect(controller.getState().activeProjectId).toMatch(/^project-/);
    expect(controller.getState().versions).toHaveLength(1);
  });

  it('saves edits as a new immutable version', async () => {
    const api = createHumanInkFakeApi();
    const controller = new HumanInkWorkbenchController(api);
    await controller.initialize();
    await controller.selectProject('project-tea');
    const previousVersionId = controller.getState().activeVersionId;

    controller.updateEditor({ body: '这是编辑后保存的新正文。' });
    expect(controller.getState().editor.dirty).toBe(true);
    await controller.save('人工编辑');

    const state = controller.getState();
    expect(state.activeVersionId).not.toBe(previousVersionId);
    expect(state.versions).toHaveLength(3);
    expect(state.editor.dirty).toBe(false);
    expect(state.saveStatus).toBe('saved');

    const oldVersion = (await api.getProject('project-tea')).versions.find((version) => version.id === previousVersionId)!;
    expect(oldVersion.body).not.toBe('这是编辑后保存的新正文。');
  });

  it('tracks workflow action tasks from queued to running to succeeded', async () => {
    const api = createHumanInkFakeApi();
    const controller = new HumanInkWorkbenchController(api);
    await controller.initialize();
    await controller.selectProject('project-tea');

    const task = await controller.triggerAction('humanize');
    expect(task.status).toBe('queued');
    expect(controller.getState().tasks[0]?.action).toBe('humanize');

    await api.advanceTask(task.id, 'running');
    await controller.refreshTasks();
    expect(controller.getState().tasks[0]?.status).toBe('running');

    await api.advanceTask(task.id, 'succeeded');
    await controller.refreshTasks();
    expect(controller.getState().tasks[0]?.status).toBe('succeeded');
  });
});