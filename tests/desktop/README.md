# Native desktop regression

Run `npm run test:desktop` for the unattended suite. It uses a separate app identity,
fixture database and local Notion substitute; it does not edit the installed app's
notes or log in to Notion.

For the lesson completion flow alone, run `AI_PLAYER_SMOKE_LESSON_ONLY=1 npm run test:desktop`.
This uses the same isolated app and two native launches to verify that Pomodoro breaks do not prompt
feedback, actual video completion opens practice, closing practice prompts one lesson state, and
replaying the lesson (including after restarting) preserves that single state. It does not require
the native Notion fixture to load.

## Interactive Chinese input check

Run `AI_PLAYER_SMOKE_IME=1 npm run test:desktop` on macOS. This builds the isolated
**AI Player Smoke.app** and pauses at the local Notion fixture for up to ten minutes.

1. Activate the test window and select a Chinese input method.
2. Type `nihaoshijie` in **Native note**, then commit the Chinese candidates to
   produce `你好世界`. Repeat in **Rich note** (a `contenteditable` editor).
3. Do not paste or set the field values: the check also requires real
   `compositionstart` and `compositionend` events in both editors.
4. Once both fields match, the remaining desktop/restart checks run automatically.
   Restore your previous input source after testing.

The report at `.cache/desktop-smoke-report.json` includes the browser user agent, a bounded input-event
trace (including input type and text snapshots) and, on macOS, the focused view's input-context/source diagnostics. These
are read-only; the harness does not change system input sources or synthesize keys.
Snapshots are read directly from the loopback fixture rather than transported in
document titles, which can truncate the JSON once the input trace grows. Both
the native URL check and the in-page origin check restrict reads to that fixture.

Passing this check confirms the native input path for these simple editors only.
It does **not** establish that Notion's own editor works, or that a Notion-specific
input bug is fixed. Test the affected Notion field separately before claiming a fix.

The unattended suite checks that macOS Notion views are identified as Safari,
without Chromium/Electron tokens. This protects the browser-compatibility profile,
not the behavior of Notion’s remote editor. The Safari version comes from the
installed Safari bundle, falling back to 16.6 (the app’s minimum macOS 13.5).
