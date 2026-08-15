import { describe, expect, it } from 'vitest'
import { SandboxPolicy, decideSandbox, type SandboxScope } from '../sandbox'
import * as path from 'path'

const scope: SandboxScope = {
  vaultRoot: '/vault',
  configDir: '.obsidian',
  dataDir: '/vault/.obsidian/dsh',
  pluginsDir: '/vault/.obsidian/dsh-plugins',
  tempDir: '/vault/.obsidian/dsh/tmp',
}

describe('decideSandbox', () => {
  it('读操作在整个 vault 内允许', () => {
    expect(decideSandbox(scope, '/vault/notes/a.md', 'read').allowed).toBe(true)
    expect(decideSandbox(scope, '/vault/.obsidian/app.json', 'read').allowed).toBe(true)
  })

  it('写操作在笔记区允许', () => {
    expect(decideSandbox(scope, '/vault/notes/a.md', 'write').allowed).toBe(true)
  })

  it('写操作拒绝 .obsidian 配置区（除白名单）', () => {
    expect(decideSandbox(scope, '/vault/.obsidian/app.json', 'write').allowed).toBe(false)
    expect(decideSandbox(scope, '/vault/.obsidian/plugins/other/main.js', 'write').allowed).toBe(
      false,
    )
    expect(decideSandbox(scope, '/vault/.obsidian/workspace.json', 'delete').allowed).toBe(false)
  })

  it('写操作允许数据目录与插件目录', () => {
    expect(decideSandbox(scope, '/vault/.obsidian/dsh/sessions/s.jsonl', 'write').allowed).toBe(
      true,
    )
    expect(decideSandbox(scope, '/vault/.obsidian/dsh-plugins/my/main.js', 'write').allowed).toBe(
      true,
    )
    expect(decideSandbox(scope, '/vault/.obsidian/dsh/tmp/x', 'write').allowed).toBe(true)
  })

  it('拒绝 vault 外路径（含目录穿越）', () => {
    expect(decideSandbox(scope, '/etc/passwd', 'read').allowed).toBe(false)
    expect(decideSandbox(scope, '/vault/../secret', 'read').allowed).toBe(false)
  })

  it('相对路径基于 vault 根解析', () => {
    expect(decideSandbox(scope, 'notes/a.md', 'write').allowed).toBe(true)
    expect(decideSandbox(scope, '../outside.md', 'write').allowed).toBe(false)
  })
})

describe('SandboxPolicy', () => {
  it('assertWrite 对白名单外路径抛错', () => {
    const policy = new SandboxPolicy(scope)
    expect(() => policy.assertWrite('/vault/.obsidian/app.json')).toThrow(/沙箱拒绝/)
    expect(() => policy.assertWrite('/vault/notes/a.md')).not.toThrow()
  })
})

describe('resolveTarget 路径规范化', () => {
  it('归一化绝对路径', () => {
    expect(path.normalize('/vault//notes/../notes/a.md')).toBe('/vault/notes/a.md')
    expect(resolveTargetAbs('/vault', 'notes/a.md')).toBe('/vault/notes/a.md')
  })
})

function resolveTargetAbs(root: string, target: string): string {
  return path.isAbsolute(target) ? path.normalize(target) : path.resolve(root, target)
}
