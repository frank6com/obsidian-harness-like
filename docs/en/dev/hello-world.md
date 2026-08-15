# Minimal Plugin

A user plugin = `package.json` + `main.js` (plain JS, no build step). Put it in `.obsidian/harness-like-plugins/my-plugin/`.

## package.json

```json
{
  "name": "my-plugin",
  "version": "0.0.1",
  "description": "One-line description",
  "dsh": { "id": "my-plugin", "version": "0.0.1", "entry": "main.js" }
}
```

## main.js (one tool + one command)

```js
module.exports = {
  name: 'my-plugin',
  inject: ['toolsCompat', 'commands', 'notice'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.toolsCompat.register({
        name: 'my_tool',
        description: 'What the tool does',
        input: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
        execute(input) { return { ok: true, x: input.x } },
      }),
      ctx.commands.addCommand({
        id: 'hello',
        name: 'Example command',
        callback: () => ctx.notice.notice('Hello'),
      }),
    ])
  },
}
```

Command ids/names get prefixed automatically (`Harness Like: Example command (my-plugin)`).

## Loading

Plugin Manager → "Authorize & Load" (single = this version / double = trust future) → status becomes running.

## Rules

1. `inject` must declare every service used in `apply`.
2. Never touch Obsidian DOM directly — use `ctx.*` services.
3. Wrap all registrations in `ctx.effect(() => [disposer...])` so stopping the plugin cleans up.

Full signatures: [ctx.* services](/en/dev/services).
