"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => main_default
});
module.exports = __toCommonJS(main_exports);
var main_default = {
  name: "my-first-plugin",
  inject: ["commands", "toolsCompat", "vault", "workspace", "notice"],
  apply(ctx) {
    ctx.effect(() => [
      // 1) 工具：统计 vault 中的 markdown 笔记数
      ctx.toolsCompat.register({
        name: "count_notes",
        description: "\u7EDF\u8BA1 vault \u4E2D\u7684 markdown \u7B14\u8BB0\u6570\u91CF",
        input: { type: "object", properties: {} },
        execute() {
          return { count: ctx.vault.listMarkdown().length };
        }
      }),
      // 2) 命令：有活动笔记时可用，点击提示当前笔记路径
      ctx.commands.addCommand({
        id: "dsh-example:hello",
        name: "\u793A\u4F8B\uFF1A\u6253\u62DB\u547C\uFF08\u663E\u793A\u5F53\u524D\u7B14\u8BB0\u8DEF\u5F84\uFF09",
        checkCallback: (checking) => {
          const file = ctx.workspace.getActiveFile();
          if (!file) return false;
          if (!checking) ctx.notice.notice(`\u4F60\u597D\uFF01\u5F53\u524D\u7B14\u8BB0: ${file}`);
          return true;
        }
      })
    ]);
  }
};
