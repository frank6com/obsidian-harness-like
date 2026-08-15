const { ItemView } = require('obsidian')

const VIEW_TYPE = 'note-counter-view'

module.exports = {
  name: 'note-counter',
  // 铁律：用到哪个服务，就必须在 inject 里声明哪个
  inject: ['vault', 'notice', 'views', 'commands', 'ribbon'],
  apply(ctx) {
    let currentView = null

    function computeStats() {
      const paths = (ctx.vault.listMarkdown() || []).map((f) =>
        typeof f === 'string' ? f : String((f && f.path) || f),
      )
      const folders = {}
      for (const p of paths) {
        const i = p.lastIndexOf('/')
        const dir = i <= 0 ? '/' : p.slice(0, i)
        folders[dir] = (folders[dir] || 0) + 1
      }
      return { total: paths.length, folders }
    }

    class NoteCounterView extends ItemView {
      getViewType() { return VIEW_TYPE }
      getDisplayText() { return '笔记统计' }
      getIcon() { return 'hash' }
      onOpen() {
        this.rootEl = this.contentEl.createDiv()
        this.render()
      }
      onClose() {
        if (currentView === this) currentView = null
      }
      render() {
        const { total, folders } = computeStats()
        if (!this.rootEl) return
        this.rootEl.empty()
        this.rootEl.createEl('h3', { text: `📝 笔记总数：${total}` })
        const ul = this.rootEl.createEl('ul')
        for (const [dir, n] of Object.entries(folders).sort((a, b) => b[1] - a[1])) {
          ul.createEl('li', { text: `${dir}  ·  ${n} 篇` })
        }
      }
    }

    const refreshAll = () => {
      try {
        currentView?.render()
      } catch (e) {
        console.error(e)
      }
    }

    // 全部注册包进 effect，返回 disposer；停止插件时统一撤销
    ctx.effect(() => [
      ctx.views.registerView(VIEW_TYPE, (leaf) => {
        currentView = new NoteCounterView(leaf)
        return currentView
      }),
      ctx.ribbon.addRibbonIcon('hash', '笔记统计：显示笔记总数', () => {
        ctx.notice.notice(`📝 vault 中共有 ${computeStats().total} 篇笔记`)
      }),
      ctx.on('vault/create', refreshAll),
      ctx.on('vault/delete', refreshAll),
      ctx.on('vault/rename', refreshAll),
      ctx.commands.addCommand({
        id: 'note-counter:open-view',
        name: '打开笔记统计面板',
        callback: () => ctx.views.open(VIEW_TYPE),
      }),
    ])
  },
}
