## What

<!-- What does this change? -->

## Why

<!-- Link the issue if there is one: Closes #123 -->

## How it was verified

<!--
There is no test suite yet, so describe your manual verification.
Most changes need two clients — two tabs for text sync, two devices for files.
-->

## Checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes
- [ ] Verified across two clients (if the change affects sync or file transfer)
- [ ] Verified on both transports (if the change touches WebSocket or polling)
