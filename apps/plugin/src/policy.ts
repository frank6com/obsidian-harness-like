/**
 * 审批策略纯函数（设置面第二批：目录级白名单）。
 */

/** 规范化 vault 相对路径（posix、去首尾斜杠） */
export function normalizeVaultPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/** 目标路径是否位于任一白名单目录下（目录边界匹配：Inbox 不匹配 InboxNote.md） */
export function isPathInDirs(vaultRel: string, dirs: string[]): boolean {
  const norm = normalizeVaultPath(vaultRel)
  if (!norm) return false
  return dirs.some((d) => {
    const dir = normalizeVaultPath(d)
    if (!dir) return false
    return norm === dir || norm.startsWith(dir + '/')
  })
}
