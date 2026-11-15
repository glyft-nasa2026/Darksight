# AI use: issue #177, nudge panel starts top left

| When | Who | Tool | What the AI did | What a person checked |
|---|---|---|---|---|
| 2026-11-15 | MarsRon | Claude Code (Opus 5.5) | `START_CORNER` in `web/src/ui/nudge/model.ts` is now `'tl'`, so the nudge panel starts in the top left corner of the map. The scene's status message (`.scene-message` in `web/src/scene/scene.css`) moved from top left to bottom left: the panel sits above it (z-index 2) and would have covered "Loading…" and "Graphics paused…". Comments in `nudge/index.ts`, contract section 5 and a history entry updated. Checks: `npm test`, `npm run build`. | Not yet checked by a person |
