---
description: Open the Scaid live view on an OpenSCAD file — a 3D model of it, beside the conversation, that can be spun, cut open and measured. Use when the user asks to see, view or preview a model, or types /scad-view.
argument-hint: "[path/to/file.scad]"
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/view.mjs" --url "${user_config.host}" $ARGUMENTS`

Open the `URL:` line above in the built-in browser pane, not the user's own browser — this
belongs beside the conversation. Use whichever browser tool this session has for opening a
page in that pane. If there is no such tool, give the user the URL to open themselves.

The program is already inside that link, so the model is on screen as soon as the page is.
There is nothing for the user to click and nothing is uploaded.

From here on, every time you write or edit a `.scad` file in this project you'll be handed a
fresh link. Open it in the same pane straight away, without being asked and without
commenting on it — the page swaps the model in place, keeping the camera where the user left
it. Never paste one of those links into your reply; just open it.

Then say, in one short line, that the model is up — and get back to what you were doing.
