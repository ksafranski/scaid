---
description: Open the Scaid live view on an OpenSCAD file — a browser tab that watches one .scad and rebuilds the 3D model every time it's saved, so it can be spun, cut open and measured. Use when the user asks to see, view or preview a model, or types /scad-view.
argument-hint: "[path/to/file.scad]"
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/connect.mjs" --url "${user_config.host}" $ARGUMENTS`

Open the `URL:` line above in the built-in browser pane, not the user's own browser — this
belongs beside the conversation. Use whichever browser tool this session has for opening a
page in that pane. If there is no such tool, give the user the URL to open themselves and say
nothing else about it.

Then tell them, in one short line, to click the button and choose the file named on the
`FILE:` line. That click is the one thing they have to do; the browser will not let a page
read a file it wasn't handed. After it, every save rebuilds the model on its own.

Don't restate the rest of the output, don't explain the plugin, and don't mention the URL
again in later turns. Carry on with whatever you were doing.
