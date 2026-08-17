# 最小插件

用户插件 = `package.json` + `main.js`（纯 JS，免构建）。放在 `.obsidian/harness-like-plugins/my-plugin/`。

## package.json

```json
{
  "name": "my-plugin",
  "version": "0.0.1",
  "description": "一句话描述",
  "dsh": { "id": "my-plugin", "version": "0.0.1", "entry": "main.js" }
}
```

## main.js（注册一个工具 + 一个命令）

```js
module.exports = {
  name: 'my-plugin',
  inject: ['toolsCompat', 'commands', 'notice'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.toolsCompat.register({
        name: 'my_tool',
        description: '工具做什么',
        input: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
        execute(input) { return { ok: true, x: input.x } },
      }),
      ctx.commands.addCommand({
        id: 'hello',
        name: '示例命令',
        callback: () => ctx.notice.notice('你好'),
      }),
    ])
  },
}
```

命令 id/名称会自动带前缀（`Harness Like: 示例命令（my-plugin）`），无需手写。

## 加载

插件管理器 →「授权并加载」（单勾=仅此版本 / 双勾=信任后续）→ 状态变为 running。

## 铁律

1. `inject` 必须声明 apply 里用到的**每一个**服务；
2. 禁止直接操作 Obsidian DOM，一律通过 `ctx.*` 服务；
3. 所有注册必须包进 `ctx.effect(() => [disposer...])`，停止时自动撤销。

完整服务签名见[服务速查](/zh/dev/services)。
