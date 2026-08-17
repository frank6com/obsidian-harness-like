# Overview

![Create a game plugin in conversation](/screenshots/zh/CreateAGame.gif)

## What is this?

Harness Like is an Obsidian implementation inspired by DeepSeek Harness. It embeds a Cordis runtime inside the Obsidian plugin process, exposes Obsidian's APIs as Cordis services, and lets an AI agent read and write your notes through tools — with human approval at every step to keep your data safe. In **Create Mode**, you can build, iterate and reload your own **Cordis plugins** entirely through conversation — whatever you can imagine, you can create.

(Note: these are not Obsidian-native plugins — they are Cordis plugins adapted to Obsidian's extension points provided by Harness Like.)

## A concrete example

The animation above shows the whole flow: say "create a small game plugin I can play" in the chat, and the agent scaffolds, writes, loads and opens the plugin by itself — **zero code, pure conversation**.

## Core concepts

- **Host plugin**: Harness Like itself — chat, agent, approvals, settings and sub-plugin management;
- **Sub-plugins**: Cordis plugins you (or the agent) create — they can register tools, commands, panels, ribbon icons, status bar items and settings tabs.

## Interface preview

![Chat panel](/screenshots/zh/chat.png)
![Settings — Models](/screenshots/zh/Settings.gif)
![Plugin Manager](/screenshots/zh/Plugins.png)

## Next steps

- [Quick Start](/guide/quickstart)
- [Creating Plugins in Conversation](/guide/plugin-agent)
- [Implemented Capabilities](/development/capabilities)
