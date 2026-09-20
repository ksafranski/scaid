---
description: Open the Scaid live view for this project — a browser tab that watches this folder and builds whichever .scad file you saved last into a 3D model you can spin, cut open and measure. Use when the user asks to see, view or preview a model, or types /scad-view.
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/connect.mjs" --url "${user_config.host}"`

Relay what the command above reported in one short line — the link most of all, and the fact
that the folder picker wants this project's folder. Don't restate the rest, don't explain the
plugin, and don't repeat the URL in later turns.

Then carry on with whatever you were doing. From here the viewer keeps up on its own: it
reads the files from disk, so every `.scad` you save in this project rebuilds in that tab
without anything being sent anywhere.
