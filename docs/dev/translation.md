# Translation Plugins

Override host UI strings per key via `ctx.dshI18n.registerLocale(lang, dict)` (zh/en). Removed automatically when the plugin stops.

```js
module.exports = {
  name: 'my-translation',
  inject: ['dshI18n'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.dshI18n.registerLocale('en', {
        'chat.send': 'Send it!',
        'chat.header.newSession': '＋ New Conversation',
        // keys you omit keep the host's original text
      }),
    ])
  },
}
```

- Lookup chain: extension strings (latest registration wins) → built-in dictionary → key itself.
- Multiple plugins overriding the same key: the last registered wins; unloading one only removes its own entries.
- v1 supports overriding the built-in zh/en languages only.
