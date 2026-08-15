# my-first-plugin（示例插件）

harness-like 的入门示例：注册一个工具（agent 可用）和一条命令（Obsidian 命令面板可见）。

## 安装

1. 把本目录复制到 vault 的 `.obsidian/harness-like-plugins/my-first-plugin/`。
2. 打开 Obsidian → 命令面板 → "打开 Harness Like 插件管理器"。
3. 点"授权并加载"→ 选择信任范围（单勾 = 仅此版本；双勾 = 信任后续版本）。
4. 测试：
   - 命令面板搜索"示例：打招呼"；
   - 在 Harness Like Chat 里问"vault 里有多少篇笔记"（agent 会调用 count_notes 工具）。

## 修改与重新构建

```sh
npm i -D esbuild          # 首次
npm run build             # 生成 main.js
```

改完源码重新构建后，在插件管理器中"停止"再"授权并加载"（新版本需要重新授权，除非你之前选了双勾）。
