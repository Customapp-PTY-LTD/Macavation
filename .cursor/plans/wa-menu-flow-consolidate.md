# Make the main WhatsApp menu itself launch the Flow, retire the separate "Full report" item

## Context

Today's `842ae79` ("Add a 'Full report' WhatsApp Flow menu item") added `commandFullReportFlow`
as an 8th row on the existing staff menu, alongside the six digest-backed rows it already had
(production, stock, yield, alerts, intake, digest). Tapping any of those six rows still sends a
plain-text reply, one message per tap, via `renderMenuItem` → `item.render()`
(`supabase/functions/whatsapp-inbound/index.ts:1038-1057`). Tapping "Full report" instead opens a
Meta Flow (`supabase/flows/daily-report-menu.flow.json`) whose own screen lists the *same* six
items again, each one now opening a tap-through Flow detail screen instead of a text reply
(`commandFullReportFlow`, `index.ts:602-684`). The commit's own comment on that function says so
outright: "a richer, tap-through version of the same six digest-backed MENU_ITEMS."

So there are two parallel entry points to the same six figures: the native list (per-row text) and
the Flow (per-row Flow screen), presented as sibling rows on one menu. The Flow is not yet
published (`WA_DAILY_REPORT_FLOW_ID` unset — this repo's Control Room key has no `publish_flow`
access) so nothing user-visible is duplicated in production yet, but the code path is, and it will
become visibly duplicated the moment someone with publish access sets the Flow live.

The fix: when the Flow is available, `commandMenu` should launch the Flow directly as the main
menu — one send, one path — instead of sending the native list *and* offering a separate "Full
report" row that re-lists the same six items. "Latest report" and "My reports" are not
digest-`render()`-backed (one calls a per-phone RPC via `resolve`, the other opens its own
sub-list via `subMenu`) and stay outside the Flow, appended as native list rows exactly as they
work today — confirmed as the intended scope with the user rather than assumed.

## Approach

**`commandMenu` picks ONE send path per invocation, not two menus:**

- When `WA_DAILY_REPORT_FLOW_ID` is set: send the Flow as the main menu response, containing the
  six `render`-backed items (`production`, `stock`, `yield`, `alerts`, `intake`, `digest`) as Flow
  rows exactly as `commandFullReportFlow` builds them today, i.e. reuse its row-building logic (the
  `item.render(digest, false)` → `flowDetailMarkdown` → `WaFlowRow` mapping,
  `index.ts:643-660`) rather than re-deriving it.
  - "Latest report" and "My reports" are NOT put in the Flow. Since the Flow's `REPORT_MENU`
    screen is a flat `NavigationList` with no room for a `resolve`/`subMenu` action type, these two
    stay as a short **native list** send immediately after, OR — simpler, and preferred — are
    appended as two more Flow rows whose `on-click-action` is `complete` with a body telling the
    member to reply `7`/`8` (or similar) to reach them via text, since the Flow has no way to call
    `resolve`/`subMenu` handlers. Resolve this mechanically in favour of whichever keeps the
    two working exactly as they do today with the least new Flow-JSON complexity — see Open
    question below; default to **native list fallback for just these two items**, sent as a
    second, small `sendList` call right after the Flow launch succeeds, mirroring how
    `commandMySettings` already sends its own follow-up list.
- When `WA_DAILY_REPORT_FLOW_ID` is unset, OR the Flow send fails: fall back to exactly today's
  `commandMenu` behaviour — `sendList` with all 8 rows (six render items + Latest report + My
  reports), unchanged. This is the existing code path already in `commandMenu`
  (`index.ts:997-1029`); do not touch it beyond adding the Flow-first branch ahead of it.

**Remove the now-redundant standalone entry point:**
- Delete the `full_report` row from `MENU_ITEMS` (`index.ts:848-857`).
- Delete `commandFullReportFlow` as a standalone dispatch target, folding its row-building logic
  into the new Flow-sending branch of `commandMenu` (do not delete the logic, relocate it).
- `flowDetailMarkdown`, `statsAsOfSAST`, `WA_DAILY_REPORT_FLOW_ID`,
  `WA_DAILY_REPORT_FLOW_ENTRY_SCREEN_ID`, and the `sendFlow`/`WaFlowRow`/`buildFlowLaunchBody`
  helpers in `_shared/wa-send.ts` are all still needed — keep them as-is.

**Reply-id / tap routing:** rows launched from the Flow's `DETAIL` screen are `terminal: true` with
a `complete` action (`daily-report-menu.flow.json`'s `DETAIL` screen) — they end the Flow, they are
not routed back through `renderMenuItem`/`MENU_ITEMS.action` dispatch at all. This is unchanged
from how `commandFullReportFlow` already works today; no new reply-id wiring is needed. Numbered
text fallback behaviour (typing "3" for the third visible item) is preserved because it is driven
by `visibleItems()` position, which still includes all 8 items for the text-degrade path.

## Files to change

- `supabase/functions/whatsapp-inbound/index.ts`
  - `commandMenu` (~line 997): add the Flow-first branch described above, reusing the row-building
    code currently in `commandFullReportFlow`.
  - Remove the `full_report` `MENU_ITEMS` entry and the `commandFullReportFlow` function once its
    logic is relocated into `commandMenu`.
  - Keep `flowDetailMarkdown`/`statsAsOfSAST` (still used by the relocated row-building code).
- `supabase/flows/daily-report-menu.flow.json` — no structural change needed if "Latest report" /
  "My reports" stay off the Flow (native-list fallback approach); revisit only if the Open question
  below is resolved the other way.
- `scripts/verify-wa-plumbing.mjs` — this file was touched by `842ae79` (per its stat); re-check
  what it currently asserts about `commandFullReportFlow`/`full_report` and update those
  assertions to match the relocated code path, since a stale assertion here would silently stop
  verifying real behaviour.

## Verification

- Re-run whatever `scripts/verify-wa-plumbing.mjs` currently checks for the Flow/menu items,
  after updating it, and confirm it passes.
- Confirm the existing unit-style coverage (if any) for `commandMenu`/`renderMenuItem` still
  passes — search for existing tests referencing `MENU_ITEMS`, `full_report`, or
  `commandFullReportFlow` and update/remove per the relocation.
- Since `WA_DAILY_REPORT_FLOW_ID` is unset in every environment today, the Flow-first branch
  cannot be exercised live; verification is necessarily code-review-level plus the text-degrade
  path (which IS the only path that runs today) confirmed unchanged. State this explicitly in the
  plan submitted to the fleet as an unconfirmed/can't-verify-live item per this repo's plan-safety
  checklist (item 2: no device/live-Flow verification available; item 5: the degrade path's
  current behaviour must be cited from `index.ts:997-1029`, not assumed).

## Open question to settle before submitting

Whether "Latest report" / "My reports" ride along as two extra Flow rows (bigger Flow JSON change,
one message) or as a small separate native-list send right after the Flow launch (smaller Flow
JSON change, two messages, but zero new Flow interaction-type work). Plan defaults to the
native-list follow-up as the lower-risk option; flag this choice explicitly in the submitted plan
so the fleet's reviewer isn't asked to infer it.
