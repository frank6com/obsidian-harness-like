#!/usr/bin/env bash
# link-dev.sh —— 把 harness-like 构建产物以【文件级软链】接入测试 vault。
#
# 原理：vault 侧插件目录保持真实目录，仅软链四个产物文件；
# Obsidian 的 data.json 写入真实目录（vault 侧），永不污染项目仓库。
#
# 用法：
#   ./scripts/link-dev.sh <vault路径>
#   DEV_VAULT=/path/to/vault ./scripts/link-dev.sh
# 之后：pnpm dev（watch 构建）→ Obsidian 重载插件即可。
set -euo pipefail

VAULT="${1:-${DEV_VAULT:-}}"
if [[ -z "$VAULT" ]]; then
  echo "用法: ./scripts/link-dev.sh <vault路径>  或 设置 DEV_VAULT 环境变量" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$VAULT/.obsidian/plugins/harness-like"
mkdir -p "$PLUGIN_DIR"

# 名称 → 仓库内相对路径（main.js 在 dist/，其余在 apps/plugin/ 根）
link() { ln -sfn "$ROOT/$2" "$PLUGIN_DIR/$1"; }
link main.js       apps/plugin/dist/main.js
link manifest.json apps/plugin/manifest.json
link styles.css    apps/plugin/styles.css
link versions.json apps/plugin/versions.json

echo "已链接 → $PLUGIN_DIR"
echo "  main.js      → $ROOT/apps/plugin/dist/main.js"
echo "  提示: 运行 'pnpm dev' 后重载 Obsidian；data.json 将写入 vault 侧（不污染仓库）。"
echo "  提示: 移除软链: rm \"$PLUGIN_DIR\"/main.js \"$PLUGIN_DIR\"/manifest.json \"$PLUGIN_DIR\"/styles.css \"$PLUGIN_DIR\"/versions.json"
