# Describing What You Want

Use Obsidian's **area names** when telling the agent what to do — it maps them to the right capabilities.

## Obsidian area glossary

| What you see | Official name | How to phrase it |
| --- | --- | --- |
| Narrow icon bar on the far left | Ribbon | "Add an icon to the left ribbon that opens…" |
| Thin bar at the bottom | Status bar | "Show … in the status bar" |
| The palette opened with Ctrl/Cmd+P | Command palette | "Register a command named…" |
| A draggable side panel | Panel / view | "Open a right-side panel showing…" |
| The note you're editing | Active note | "Summarize the current note…" / "Insert at the cursor" |
| Categorized settings pages | Settings tab | "Add an option in the host settings…" |
| The vault file tree | Vault | "Count the whole vault…" |

## Example requests

**Create a sub-plugin (Create Mode)**:

> Create a plugin with a panel showing the folders in this vault and the file count under each folder.

**Modify an existing sub-plugin**:

> Change folder-stats to group the stats by file type instead.

**Read-only question (Chat Mode)**:

> Find notes containing "reading" and count them.

**Read/write notes (Edit Mode)**:

> Turn the list above into a note under the Inbox folder.

## Tips

- Think about the **goal** first (the result you want), then the **form** (panel / command / icon / status bar);
- Not sure of the name? Describe the position ("that icon at the bottom left") — the agent understands;
- Writes always go through approval — that's normal.
