# VeryLoving Mobile Design System

Status: **PASS — source foundation implemented; signed-device acceptance remains separate**

Last reviewed: 22 July 2026

VeryLoving supports a wearable safety product and a home companion robot in one mobile experience. This system gives both product lines one calm, recognizable interface while keeping life-safety actions unmistakable. The canonical token source is [`src/constants/theme.js`](../src/constants/theme.js); shared components live in [`src/components/`](../src/components/).

This document describes the implemented foundation and the rules for extending it. It does not claim that every older screen has completed visual migration, or that source review replaces VoiceOver, Dynamic Type, emulator, or physical-device QA.

## 1. Product principles

1. **Calm before clever.** Use generous space, short sentences, and predictable controls. Decoration must never compete with emergency information.
2. **Safety has a stable hierarchy.** The primary action is dark ink, the branded accent is orange, and destructive or emergency actions are red. Do not use red for ordinary emphasis.
3. **State must be honest.** Distinguish offline, connecting, requested, accepted, acknowledged, completed, and failed. A submitted SOS or robot command is not proof of delivery or physical completion.
4. **One ecosystem, two device identities.** Wearables use the watch/human visual language and warm accent; home robots use the home/robot visual language and cool accent. Always include a text label, because color and icon alone are insufficient.
5. **Progressive disclosure.** Put the next useful action first. Keep diagnostics and uncommon settings behind a detail screen instead of crowding the home screen.
6. **Accessible by default.** Controls start at 44 points, text scales, state is announced, motion respects the system preference, and layouts must work in both LTR and RTL.
7. **Privacy is part of the interface.** Never render raw provider errors, credentials, precise coordinates, hardware serials, or unredacted health/event payloads. Explain what export and deletion will do before starting them.

## 2. Tokens

Import tokens rather than repeating numeric or hex values:

```js
import {
  colors,
  layout,
  motion,
  radii,
  shadows,
  sizes,
  spacing,
  tones,
  typography
} from '../constants/theme';
```

### Color

Prefer semantic aliases in new or substantially revised UI. The original palette names remain available for incremental migration.

| Semantic token | Value | Use |
| --- | --- | --- |
| `colors.textPrimary` | `#304557` | Primary copy, titles, and high-emphasis icons. |
| `colors.textSecondary` | `#5F7484` | Supporting copy and metadata. Do not use for critical instructions. |
| `colors.textInverse` | `#FFFFFF` | Text/icons on verified dark, accent, or danger surfaces. |
| `colors.surfaceCanvas` | `#FFF8EF` | App canvas and safe-area background. |
| `colors.surfaceRaised` | `#FFFFFF` | Cards, sheets, and raised controls. |
| `colors.surfaceMuted` | `#F4F6F7` | Quiet grouped content and inactive status. |
| `colors.borderSubtle` | `#E6ECEF` | Card separation and non-interactive dividers. |
| `colors.borderControl` | `#7C8C98` | Interactive control outlines. |
| `colors.actionPrimary` | `#304557` | Default primary action. |
| `colors.actionAccent` | `#A84316` | Brand emphasis and selected non-emergency action. |
| `colors.actionDanger` | `#B52F2F` | Destructive and emergency actions only. |

Status feedback uses the reusable `tones` contract, which pairs an accessible foreground with a soft background and visible border:

| Intent | Tone | Required companion cue |
| --- | --- | --- |
| Neutral/inactive | `tones.neutral` | Neutral icon plus explicit text. |
| Brand emphasis | `tones.accent` | Product/action label; never color alone. |
| Information/active | `tones.info` | Information/active icon plus explicit text. |
| Warning/reconnecting | `tones.warning` | Warning icon plus explicit text. |
| Success/online | `tones.success` | Check icon plus explicit text. |
| Error/offline/danger | `tones.danger` | Alert icon plus explicit text. |

Do not add opacity to foreground text to manufacture a disabled or secondary color. Use the semantic token and apply opacity only to the whole disabled control. Any new color pairing must be contrast-checked in its actual font size and weight.

### Typography

The display face is Scada; interface copy is Inter. React Native font scaling remains enabled by default.

| Token | Family | Size / line height | Intended use |
| --- | --- | --- | --- |
| `typography.displayLarge` | Scada Bold | 44 / 52 | Rare hero moment on a spacious screen. |
| `typography.display` | Scada Bold | 28 / 34 | Screen title and branded loading title. |
| `typography.titleLarge` | Inter Bold | 24 / 31 | High-priority section or modal title. |
| `typography.title` | Inter Bold | 20 / 27 | Card group or secondary screen title. |
| `typography.heading` | Inter Bold | 18 / 25 | Section heading. |
| `typography.bodyLarge` | Inter Regular | 16 / 24 | Prominent body copy and control labels. |
| `typography.body` | Inter Regular | 15 / 22 | Default body copy. |
| `typography.bodySmall` | Inter Regular | 14 / 20 | Compact explanatory copy. |
| `typography.label` | Inter Semibold | 15 / 21 | Buttons, form labels, and compact emphasis. |
| `typography.caption` | Inter Regular | 13 / 18 | Metadata and supporting status. |

Rules:

- Do not disable font scaling on user-facing copy.
- Prefer `minHeight` over fixed height for controls containing text.
- Allow labels to wrap; never truncate a safety instruction solely to preserve a card height.
- Keep paragraphs within `layout.readableMaxWidth` (`560`) and full screen content within `layout.contentMaxWidth` (`720`).
- Use a real accessibility heading role for a screen's primary title; size and weight alone do not communicate hierarchy to assistive technology.

### Spacing and layout

| Token | Points | Typical use |
| --- | ---: | --- |
| `spacing.none` | 0 | Explicit opt-out only. |
| `spacing.xs` | 4 | Icon/label or stacked metadata gap. |
| `spacing.sm` | 8 | Compact element gap. |
| `spacing.mdSm` | 12 | Dense card padding or related-control gap. |
| `spacing.md` | 16 | Default component padding and section gap. |
| `spacing.lg` | 24 | Major section separation. |
| `spacing.xl` | 32 | Screen-region separation. |
| `spacing.xxl` | 48 | Hero or empty-state breathing room. |

Use `layout.screenPadding` (`20`) for ordinary screens and `layout.compactScreenPadding` (`16`) only when width is constrained. The shared `Screen` component supplies safe-area, scrolling, keyboard avoidance, a readable maximum width, and a consistent canvas.

### Radius, size, and elevation

| Group | Tokens | Rule |
| --- | --- | --- |
| Radius | `sm 6`, `md 8`, `lg 12`, `xl 16`, `bubble 18`, `pill 999` | Use `lg` for controls/cards, `pill` only for chips/status, and avoid arbitrary mixed radii in one region. |
| Controls | `controlCompact 44`, `control 50`, `controlLarge 56` | No interactive target may be smaller than `sizes.touchTarget` (`44`). |
| Icons | `iconSmall 18`, `icon 22`, `iconLarge 28` | Decorative icons are hidden from accessibility; meaningful icons need a labelled parent control. |
| Elevation | `shadows.subtle`, `shadows.raised` | Use subtle for ordinary cards and raised for the current focus/modal surface. Never rely on shadow alone for separation. |

### Motion

| Token | Value | Use |
| --- | ---: | --- |
| `motion.durationFast` | 140 ms | Press/dismiss feedback. |
| `motion.durationStandard` | 180 ms | Banner and ordinary state transition. |
| `motion.durationEmphasis` | 240 ms | One meaningful focal transition. |
| `motion.pressedScale` | 0.98 | Button press response. |

Motion reinforces causality; it does not delay access to an action. Reanimated transitions must use the system reduce-motion setting. Never encode an emergency state using motion alone, and avoid looping decoration, parallax, or celebratory animation in a safety flow.

## 3. Shared components

### `Screen`

Use `Screen` as the default route container. It provides safe-area handling, keyboard avoidance, scroll behavior, the cream canvas, and readable-width containment.

```jsx
<Screen>
  <Header title={t('common.settings')} showBack backLabel={t('common.back')} />
  {/* screen sections */}
</Screen>
```

Use `scroll={false}` only for a component that explicitly owns scrolling or needs a full-height canvas, such as the map. Verify keyboard access when doing so.

### `Header`

`Header` owns the brand/back affordance and screen hierarchy. Its title is exposed as an accessibility header. Supply a localized `backLabel`; the component safely returns home if native history is unavailable. `eyebrow`, `subtitle`, and `trailing` are optional—do not populate all three unless each adds useful context.

### Onboarding progress and tutorial pages

Use `OnboardingProgress` for a known, finite onboarding/tutorial sequence. Pass one-based `current` and `total` values; the component clamps unsafe inputs and exposes native progress semantics. Do not use it for an indeterminate network operation.

`TutorialPage` combines that progress pattern with localized header copy, contextual illustration, a focused explanation card, one Continue action, and an explicit Skip route. Keep new tutorial steps in the ordered step/art registry so the visible and announced progress stays accurate. Entry animation must use the motion scale and respect Reduce Motion.

### `Button`

`Button` provides a 44-point-or-larger target, loading and disabled semantics, selected state, icon placement, Android ripple, and a short press animation.

| Variant | Use |
| --- | --- |
| `primary` | One default next action in a region. |
| `orange` | Selected mode or branded affirmative emphasis. |
| `danger` | SOS/destructive action with confirmation where reversal is difficult. |
| `ghost` | Secondary navigation or low-emphasis action. |
| `secondary` | Informational alternative. |
| `success` | Confirmed positive state; not merely a submitted request. |

```jsx
<Button
  title={t('common.save')}
  loading={saving}
  loadingLabel={t('common.loading')}
  disabled={!isValid}
  onPress={save}
/>
```

Use one visually dominant action per card or modal. Supply `accessibilityHint` when the result is not obvious from the label. A spinner must be accompanied by a stable or loading-specific label.

### `Card`

`Card` standardizes surface, border, radius, padding, and elevation.

| Variant | Use |
| --- | --- |
| `default` | Ordinary grouped content. |
| `flat` | Nested or already-separated content. |
| `raised` | Current focal panel or sheet content. |
| `tinted` | Warm, non-critical guidance. |
| `critical` | Safety warning or destructive confirmation. |

Padding values are `none`, `sm`, `md` (default), and `lg`. Do not nest multiple elevated cards.

### `DeviceStatusCard` and `StatusPill`

Use `DeviceStatusCard` for the same identity/status pattern on Home and My Devices. Pass the complete normalized entity; do not infer an online robot merely because it is paired. `StatusPill` supports `ok`, `warn`, `danger`, `idle`, and `active` tones and always pairs color with an icon and label.

Status copy should answer three questions in order: which device, whether it can currently act, and—if useful—when it was last seen. Renaming changes the friendly name, never the hardware identity.

### `ActionTile`

Use `ActionTile` for a high-information navigation/action row with an icon, title, optional description, optional value, and trailing direction cue. Available tones are `default`, `wearable`, `robot`, `safety`, and `danger`. A danger tone communicates context; the destination must still confirm any irreversible action.

Do not use an action tile for a binary setting (use a labelled switch row) or a simple primary form submission (use `Button`). Keep the description short enough to scale and wrap without pushing the chevron off screen.

### `TextField`

`TextField` is the default new text-input primitive. It owns a visible label, optional hint/error, required marker, disabled/editable state, focused/invalid border, leading icon, trailing content, multiline mode, forwarded ref, and RTL alignment.

```jsx
<TextField
  label={t('contacts.name')}
  value={name}
  required
  error={nameError ? t(nameError) : null}
  autoComplete="name"
  returnKeyType="next"
  onChangeText={setName}
/>
```

Do not rely on a placeholder as the only label. Supply the appropriate keyboard/content/autofill attributes, keep validation near the field, and avoid echoing sensitive values into logs or generic errors. Existing specialist controls such as the global phone-number input may retain their domain-specific behavior while adopting the same visual and semantic rules.

### Loading: `AppLoadingState`, `LoadingState`, and skeletons

Use the branded, live-region-aware `AppLoadingState` only for application, font, authentication, or persistence hydration that temporarily prevents safe routing. Use an inline activity indicator or skeleton for content that can load while the rest of a screen remains usable.

Use `LoadingState` for a bounded route/section wait with optional compact presentation. Use `Skeleton`/`SkeletonText` to preserve the shape of async content and wrap related placeholders in one labelled `SkeletonGroup`; individual blocks stay silent to assistive technology. Skeleton animation observes Reduce Motion and stops on unmount.

A loading state must be bounded by the owning operation. On timeout or failure, transition to usable fallback/retry UI; never leave a spinner or skeleton indefinitely.

### `FeedbackBanner`

Use a banner for contextual, recoverable feedback that belongs on the current screen. Tones are `info`, `success`, `warning`, and `error`; error announcements are assertive and other tones are polite. Prefer an inline retry action. Add dismissal only when hiding the message is safe.

Use a native confirmation dialog for an irreversible decision that must block progress, such as delete-all-data or emergency activation. Do not show both a native alert and a banner for the same error.

### `Snackbar`

Use `Snackbar` for a short, non-blocking result such as a confirmed safety-mode change. It supports `success`, `info`, `warning`, and `error`, a manual close action, a bounded auto-dismiss duration (3.5 seconds by default), timer cleanup, RTL, live-region semantics, and reduced-motion entry/exit.

A snackbar must not be the only place to expose a critical failure, required recovery step, emergency result, or persistent offline state. Use `FeedbackBanner` for those cases. Pass a stable `onDismiss` callback when possible so unrelated renders do not restart the dismissal timer.

### `EmptyState`

An empty state explains why content is absent and offers one relevant action. Use `compact` inside a list/card and the default layout for a screen-level state. Illustrations are decorative; the title and message carry the meaning.

### Modal sheets and confirmations

The repository does not expose one universal modal abstraction. Use a native alert for short destructive confirmation and a safe-area-aware modal route for multi-step work. In either case, provide a localized title/body, keep confirm and cancel visually distinct, prevent duplicate submission, return focus predictably, and never close with false success after a failed mutation.

## 4. Interaction patterns

### Loading and retry

1. Preserve the last known valid content when refreshing.
2. Disable only controls affected by the in-flight action.
3. Give every network/native operation a bounded timeout or cancellation path.
4. Show an actionable localized failure; never expose raw exception text.
5. Retry idempotently and prevent duplicate taps.

For feedback selection: use inline field error for validation, `FeedbackBanner` for persistent/contextual recovery, `Snackbar` for transient confirmed results, and a confirmation dialog/modal route for a consequential decision.

### Success

Use success feedback only after the application's contract is satisfied. Examples:

- **Saved:** local or remote mutation committed according to that feature's contract.
- **Command accepted:** backend/vendor accepted the command; physical completion is still pending.
- **Emergency contact notified:** only after an approved delivery receipt, not after queuing.

### Safety and destructive actions

- Keep SOS visually separate from routine quick actions.
- Confirm actions that place calls, delete data, factory-reset a robot, or escalate an incident.
- State what happens next and what may still fail.
- Always offer an obvious cancel/close route unless immediate safety policy explicitly forbids it.

### Device states

Use this shared vocabulary:

| State | Meaning |
| --- | --- |
| Paired | The account owns a valid device binding. It may be offline. |
| Connecting | A bounded connection attempt is active. |
| Online | Current telemetry/transport evidence meets the feature's freshness rule. |
| Offline | The freshness/transport rule is not met; queued work may remain. |
| Action requested | The app/backend accepted intent. |
| Action acknowledged | The target transport/provider acknowledged it. |
| Completed | A trusted completion signal satisfied the action contract. |

## 5. Accessibility, localization, and responsiveness

### VoiceOver and TalkBack

- Give each critical control a concise localized label, role, hint when necessary, and current state.
- Group icon, device name, battery, and status only when the combined announcement is clearer than separate focus stops.
- Hide decorative art and duplicate icons with `accessible={false}`.
- Announce asynchronous feedback through an appropriate live region; avoid repeated announcements during telemetry updates.
- Verify focus after navigation, modal open/close, validation failure, item deletion, and direction reload.
- Test with the screen reader running; source attributes alone do not prove usable focus order or speech.

### Dynamic Type

- Test at the platform's default, one large accessibility size, and maximum supported size.
- Expect buttons, cards, pills, and headers to grow vertically.
- Replace absolute overlays or fixed-height content when labels overlap, clip, or become unreachable.
- Ensure the SOS confirmation and cancellation controls remain visible without precision scrolling.

### RTL

`I18nContext` provides `isRTL`, and supported native builds coordinate the required LTR/RTL reload. Use logical `start`/`end` spacing, mirror directional rows and chevrons, keep numbers readable, and never reverse chronological order or data values merely because the interface is RTL. Expo Go is not acceptance evidence for native direction changes.

### Responsive layouts

- Start with a single readable column.
- Let action groups wrap instead of shrinking labels.
- Keep critical controls full-width when a multi-column layout could obscure priority.
- Test compact iPhone, current iPhone, large Dynamic Type, 11-inch iPad portrait/landscape, iPad split view, and a representative Android phone/tablet width.

## 6. Contribution checklist

Before merging a new or materially changed mobile surface:

- [ ] It uses semantic tokens and shared components where applicable.
- [ ] It has loading, empty, success, failure, retry, offline, and disabled behavior appropriate to its data.
- [ ] Every external/native operation is bounded and duplicate-safe.
- [ ] Safety copy distinguishes request, acknowledgement, delivery, and completion.
- [ ] Controls are at least 44 points and have localized accessibility semantics.
- [ ] Text scales without clipping at an accessibility size.
- [ ] LTR and RTL layouts preserve reading and navigation order.
- [ ] Keyboard, safe area, compact width, and tablet width are covered.
- [ ] Motion respects Reduce Motion and is not required to understand state.
- [ ] Logs and visible failures contain no credential, PII, precise location, serial, or raw provider error.
- [ ] Unit/source checks pass, and the applicable rows in [`mobile-polish-qa.md`](./mobile-polish-qa.md) have current-candidate evidence.

## 7. Current evidence boundary

The token and component APIs in this document are present in source. The repository also contains automated checks and production JavaScript export gates. Visual quality, touch behavior, native permissions, screen-reader order, device radio behavior, and signed-build persistence still require the environment-specific evidence defined in [`mobile-polish-qa.md`](./mobile-polish-qa.md) and the main [TestFlight acceptance checklist](../README.md#12-testflight-acceptance-checklist).
