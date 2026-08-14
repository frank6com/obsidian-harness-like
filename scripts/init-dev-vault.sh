#!/usr/bin/env bash
# init-dev-vault.sh —— 在项目内初始化 Obsidian 测试库（dev-vault）。
#
# 整个 dev-vault/ 目录被 gitignore 忽略：构建产物、data.json、会话、
# 用户插件全部落在其中，仓库保持纯净。
#
# 用法：
#   ./scripts/init-dev-vault.sh            # 使用默认 dev-vault/（项目根下）
#   DEV_VAULT_DIR=myvault ./scripts/init-dev-vault.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${DEV_VAULT_DIR:-dev-vault}"
VAULT_ABS="$(cd "$ROOT" && cd "$VAULT" 2>/dev/null && pwd || echo "$ROOT/$VAULT")"

mkdir -p "$VAULT_ABS"

# 示例笔记（用于测试 read_note / write_note / search_notes）
mkdir -p "$VAULT_ABS/Inbox"
if [[ ! -f "$VAULT_ABS/Inbox/示例笔记.md" ]]; then
  cat > "$VAULT_ABS/Inbox/示例笔记.md" <<'EOF'
# 示例笔记

这是 dev-vault 的示例笔记，用于测试 read_note / write_note / search_notes 等工具。

- 标签：示例
- 目的：agent 开发测试
EOF
fi

# 示例用户插件（含预编译产物，可直接"授权并加载"）
mkdir -p "$VAULT_ABS/.obsidian/dsh-plugins"
cp -R "$ROOT/apps/plugin/examples/my-first-plugin" "$VAULT_ABS/.obsidian/dsh-plugins/"

# 构建并自动同步产物（esbuild onEnd 钩子写入插件目录）
DEV_VAULT_DIR="$VAULT" pnpm --dir "$ROOT" build

echo ""
echo "dev-vault 就绪: $VAULT_ABS"
echo "  插件目录: $VAULT_ABS/.obsidian/plugins/dsh-obsidian/（构建后自动同步）"
echo "  示例插件: $VAULT_ABS/.obsidian/dsh-plugins/my-first-plugin/"
echo ""
echo "用 Obsidian 打开:  open -a Obsidian \"$VAULT_ABS\""
echo "日常开发: 终端运行 'pnpm dev'，Obsidian 里重载插件即可"
