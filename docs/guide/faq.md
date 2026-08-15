# 常见问题

<details><summary>API Key 存在哪里？</summary>

明文保存在 `.obsidian/plugins/harness-like/data.json`，请注意保管。

</details>

<details><summary>对话记录存在哪里？</summary>

vault 内 `.obsidian/harness-like/sessions/*.jsonl`（自动迁移自旧版 `.obsidian/dsh/`）。

</details>

<details><summary>跑用户插件安全吗？</summary>

插件只执行你放在 `.obsidian/harness-like-plugins/` 的本地文件，加载需要授权，可随时撤销。

</details>

<details><summary>单勾和双勾的区别？</summary>

单勾 = 只信任当前版本；双勾 = 信任该插件后续所有版本（更新不再弹窗）。

</details>

<details><summary>agent 能随便写文件吗？</summary>

不能——写操作限制在 vault 内并经过审批链（见[审批与安全](/guide/approval)）。

</details>

<details><summary>怎么切换界面语言？</summary>

设置 → 界面 → 界面语言：跟随系统（默认）/ 中文 / English。

</details>

<details><summary>为什么只能在桌面端用？</summary>

Harness Like 依赖桌面端能力（本地文件系统、进程内运行时），manifest 已声明 `isDesktopOnly`，移动端商店自动隐藏。

</details>

<details><summary>会上传数据吗？</summary>

零遥测；模型请求只发往你配置的提供方端点。

</details>
