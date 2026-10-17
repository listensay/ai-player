# Native desktop regression

Run `npm run notes:build` with Node 22 configured through `AFFINE_NODE`, then `npm run test:desktop` with Node 24.
The suite uses a separate app identity, temporary course database and a per-run local AFFiNE origin. Two process launches verify real local note edits, per-lesson bindings and restart persistence, native view geometry, tab/sidebar/dialog/fullscreen hiding, denial of direct database access from the note view, programming execution/cancellation, and lesson feedback persistence.

On macOS, it also checks cursor ownership at five points across the note view and the exposed host toolbar, plus attachment to the host's tracking-area observer. Covered host regions must reject cursor updates while notes are visible and regain ownership when hidden, including workspace navigation, resizing, fullscreen, and restart. These are native hit-test checks, not frame-by-frame recordings of the system cursor. For manual pointer-motion verification, launch the isolated `desktop-smoke` build with `AI_PLAYER_CURSOR_TRACE=1` to log filtered host events and native cursor changes. This tracing is excluded from production builds. Coordinate clicks do not establish continuous pointer-motion behavior.

Note editing uses the real AFFiNE document model and IndexedDB persistence. It does not synthesize typing or establish Chinese IME behavior. Keyboard and visual checks are performed separately in the Notes Check app.

The lesson-only subset remains available with `AI_PLAYER_SMOKE_LESSON_ONLY=1 npm run test:desktop`.
Reports are written to `.cache/desktop-smoke-report.json`. No production application database or installed application is changed.
