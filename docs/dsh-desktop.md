# DSH Desktop 使用说明

`dsh-desktop` 使用普通 DSH profile 组合加载第三方插件。HumanInk 不依赖 Electron 私有 API：Host 侧使用标准 `dsh.bundle`，Browser 侧使用 `dsh.client`（`platform: "web"`）并导出 `./client`，因此 Desktop 不需要单独的客户端注册方式。

## 通过 Desktop 的内置终端安装

如果 DSH Desktop 已提供当前 profile 的终端，在终端中执行：

```powershell
dsh plugin --profile <你的 profile> add github:ElioChen240/dsh-humanink#main
```

推荐将 `#main` 替换为固定 release tag 或 commit。安装完成后，重启 DSH Desktop，使当前 profile 重新组合并加载 Browser client。

## 启动后验证

1. 打开 DSH Desktop，并确认启动的是安装 HumanInk 的 profile；
2. 进入主工作区，等待 Web client 加载完成；
3. 在左侧栏底部找到 **HumanInk**；
4. 点击后确认三栏工作台能够打开；
5. 新建一篇文章，执行“生成标题”或“生成简报”，确认任务状态能更新；
6. 保存或导出后，检查当前 profile 的 `.humanink/` 目录中是否出现版本和任务记录。

如果入口没有出现，依次检查：

- Desktop 是否已重启，而不是只刷新当前页面；
- 当前激活 profile 是否就是安装 HumanInk 的 profile；
- 插件包是否同时包含 `cordis.patch.yml`、`dist/bundle/index.mjs` 和 `dist/bundle/client.js`；
- Desktop 的 Web client runtime 是否提供 `slots`、`connection`、`sidebar.footer.action` 和 `shell.overlay`；
- Host 日志中是否有稳定的 `HUMANINK_*` 错误码。

真实 Desktop 验收与仓库单测是两层检查：本仓库可以验证 manifest、Client closure、Host facade 和 RPC，但无法在没有当前 Desktop 运行时实例的环境中代替用户完成窗口级点击验收。
