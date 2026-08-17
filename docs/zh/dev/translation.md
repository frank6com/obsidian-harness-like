# 翻译插件

通过 `ctx.dshI18n.registerLocale(lang, dict)` 键级覆盖主插件界面文案（zh/en），插件停止自动还原。

```js
module.exports = {
  name: 'my-translation',
  inject: ['dshI18n'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.dshI18n.registerLocale('en', {
        'chat.send': 'Send it!',
        'chat.header.newSession': '＋ New Conversation',
        // 不写的 key 保持主插件原文
      }),
    ])
  },
}
```

- 查找链：扩展文案（后注册优先）→ 内置字典 → key 本身。
- 多插件注册同一 key：后注册者生效，任一插件卸载只移除自己的注册。
- v1 仅支持覆盖 zh/en 两种内置语言，不新增语言。
