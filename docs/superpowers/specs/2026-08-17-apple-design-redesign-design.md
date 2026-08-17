# CLIPLINK Apple-Style Redesign

## Context

CLIPLINK's current UI (`components/cliplink-app.tsx`, ~1080 lines, landing + room view + toasts + QR sheet in one file) has a deliberate terminal/brutalist identity: JetBrains Mono + Syne, neon yellow-green accent, all-caps tracked labels, sharp 2–4px corners, a noise-texture overlay, and CSS-only transitions (`:active` scale, fixed-duration `@keyframes`).

This redesign applies Apple's fluid-interface principles (spring-based, interruptible motion; translucent materials; optical typography) to the whole app — landing screen and room view both — while keeping CLIPLINK's brand color identity. It also splits the single large component into focused, independently animatable pieces, since the redesign touches nearly every part of it anyway.

**Scope**: visual and motion layer only. No changes to transport, storage, or any business logic in `cliplink-app.tsx`'s hooks/effects/handlers — those are reused as-is by the new presentational components.

## Decisions

- **Aesthetic**: Apple system materials/motion language, but keep the existing brand accent color (`#e8ff3c` dark / `#8ea21a` light) rather than switching to Apple's own palette.
- **Motion library**: add `motion` (Framer Motion's successor) via `npm install motion`. CSS transitions/`@keyframes` cannot be cleanly interrupted/re-targeted mid-flight, which is the core requirement for gesture-driven UI (QR sheet drag-to-dismiss, toast stack).
- **Component split**: yes. Container (`cliplink-app.tsx`) keeps all state, effects, and transport orchestration unchanged; a new `components/cliplink/` directory holds presentational pieces.

## Design

### 1. Typography & color

- Drop JetBrains Mono and Syne as the primary UI faces. Replace with `system-ui` (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`) for all UI text — buttons, labels, body copy, headings.
- Monospace stays only where it earns its keep: the room code display (badge, QR sheet heading) and the join-code input, since fixed-width glyphs matter for a 6-character code.
- All-caps tracked labels (`uppercase tracking-[0.1em]`) become sentence case. Tracking becomes size-specific per the type system below, not a blanket value.
- Corner radii move from the current 2–4px sharp-cut aesthetic to 12–20px: buttons `14px`, panels/textarea container `16px`, QR sheet `20px` (top corners) / `12px` (bottom, mobile sheet), toasts `14px`.
- Remove the `body::before` noise-texture overlay entirely; keep the existing gradient background (it already reads clean).
- Keep every existing CSS custom property name in `app/globals.css` (`--accent`, `--success`, `--danger`, etc.) so component code doesn't need token renames — only the values/usage sites for radius, font-family, and tracking change.

Type scale (mobile → desktop, matching existing `clamp()` pattern):

| Role | Size | Tracking | Leading |
| --- | --- | --- | --- |
| Hero (`h1`) | `clamp(1.7rem, 15vw, 6.35rem)` | `-0.02em` (was up to `-0.075em`) | `1.05` |
| Body / description | `11–13px` | `0` | `1.6` |
| Labels (room, history, toolbar) | `11–12px` | `0.01em` | `1.4` |
| Room code badge | `16–20px`, monospace | `0.1em` | `1` |

### 2. Materials

- **Header**: already uses `backdrop-blur` + translucent background — keep, but raise blur to `20px` and add `saturate(180%)` for the Apple "frosted" look; add a bright 1px top inset border on the header's *bottom* edge only where content actually scrolls under it (scroll-edge effect, not a hard divider).
- **Toast stack**: switch from opaque `--surface`-based fill to a translucent material (`backdrop-filter: blur(16px)`), each toast a distinct floating card rather than a flat bordered box.
- **QR sheet**: becomes a real bottom sheet (mobile) / centered dialog (desktop) with a dimming scrim behind it (already has `bg-black/60` — keep), `backdrop-filter: blur(24px)` on the sheet itself, and a "materialize" enter (blur radius + scale animate together, not just opacity).

### 3. Motion (all via `motion`)

| Interaction | Spec |
| --- | --- |
| Button press (all buttons) | `whileTap={{ scale: 0.97 }}`, spring `damping: 1, duration: 0.15` — fires on pointer-down via Motion's built-in press handling, not on click |
| Toast enter | Spring from off-screen-below + `opacity: 0` → resting position, `damping: 1, duration: 0.35`, no overshoot (no gesture momentum precedes it) |
| Toast exit | Reverse of enter path (same axis), interruptible if a new toast pushes the stack before the exit finishes |
| Toast stack reflow | `layout` prop on the toast list so remaining toasts spring to their new position when one exits, instead of jump-snapping |
| History item enter | Spring `y: -8 → 0, opacity: 0 → 1`, `damping: 1, duration: 0.3`, replacing the current fixed `fade-in` CSS keyframe |
| Flash-on-receive | Spring opacity `0 → 1 → 0` instead of the current hard `duration-0` cut, `damping: 1, duration: 0.25` |
| QR sheet enter/exit | Scale `0.95 → 1` + blur radius animate together on enter; exits along the same path (slide down on mobile, fade+scale on desktop) — mirrors the entry, per spatial-consistency |
| QR sheet drag-to-dismiss (mobile) | `drag="y"`, rubber-band resistance above the open position, velocity-projected snap on release: fast downward flick → dismiss (animate off-screen at release velocity), otherwise spring back to open |
| Status dot (live/syncing/error) | Keep CSS `pulse` for the syncing state (ambient, not gesture-driven — CSS is fine here) |
| Theme toggle icon swap | Cross-fade + slight rotate, `damping: 1, duration: 0.2` |

All spring-driven transitions get a `prefers-reduced-motion: reduce` fallback to a simple opacity cross-fade (Motion respects this automatically via `useReducedMotion()`, applied at the container level).

### 4. Component structure

```
components/
  cliplink-app.tsx          # container: all state/effects/transport logic (unchanged), renders below
  cliplink/
    landing-screen.tsx      # hero + create/join form
    room-header.tsx         # room badge, status pill, share/QR/leave actions, theme toggle
    clip-editor.tsx         # textarea + toolbar (paste/clear/send)
    clip-history.tsx        # history list + empty state, per-item motion
    qr-sheet.tsx            # bottom sheet / dialog, drag-to-dismiss
    toast-stack.tsx         # fixed toast container + AnimatePresence
    icons.tsx               # IconPlus, IconCopy, IconQr, IconTheme
```

Each presentational component takes plain props/callbacks (`onSend`, `onCopy`, `status`, `history`, etc.) from `cliplink-app.tsx` — no state or effects live in the split-out files except purely local UI state that doesn't need to survive the component (e.g. a drag-progress value inside `qr-sheet.tsx`, if a `motion` value needs to live at that level).

`app/globals.css` changes: font-family stack, corner-radius scale reference (as a comment or a few new custom properties like `--radius-md: 16px`), remove `body::before` noise, remove the now-superseded `@keyframes fade-in` / `toast-in` (replaced by Motion).

## Out of scope

- Any change to transport, storage, API routes, or the state machine in `cliplink-app.tsx`'s hooks/effects.
- Rebranding colors to Apple's own palette — brand accent stays.
- New features (this is a visual/motion pass, not a functionality change).

## Verification

- `npm run type-check` / `npx tsc --noEmit` and `npm run lint` after implementation.
- Manual pass in the browser: light + dark theme, `prefers-reduced-motion: reduce` toggled on, mobile viewport (QR sheet drag-to-dismiss), keyboard-only navigation (focus states still visible through the material changes).
- Confirm no regression in the transport/state behavior — send a clip, receive one on a second tab, drop the WebSocket (dev tools throttling) and confirm polling fallback still works, since the container logic is untouched but re-wired through new prop boundaries.
