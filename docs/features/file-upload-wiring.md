---
slug: file-upload-wiring
title: FileUpload wiring, tested on generated paths
ticket: none
date: 2026-11-22
ui: false
base: main
---

# FileUpload wiring, tested on generated paths

The tests: `e2e/file-upload.paths.spec.ts` (wiring) and `app/components/__tests__/file-upload.machine.test.ts` (logic).

## Why

The spec replays paths generated from `app/components/file-upload.machine.ts` with `xstate/graph`.

The machine's unit tests already cover every transition. The spec checks the seam they cannot see: each DOM event reaches the machine, and each state renders what it should. So it runs a handful of the generated paths, chosen so every binding and every view shows up at least once, not all of them. It catches a DOM event that no longer reaches the machine, a state the markup renders wrong (for example "Upload another" leaving the success panel up, or i18next escaping the key), and drift between the machine and the markup.

Each test replays its path on `/admin/kitchen-sink#upload` and checks `data-state` after every step. The upload request is held open by a route mock and released when the path reaches the upload actor's done event, so `uploading` is observable and the reply (ok, refused or a dropped connection) comes from the model. The real upload to R2 is walked by `feature-verifier`, not by the spec.

`KITCHEN_SINK_MAX_SIZE` in the spec must match `<FileUpload maxSize>` on the kitchen-sink page.

One path per binding or view (names come from `describePath`; the first test fails if the machine stops generating one of them):

| Path | What it covers |
|------|----------------|
| `DRAG_ENTER → DRAG_LEAVE → idle` | drag in and out, the dragging view |
| `PICK small.txt → upload ok → success` | file picker, uploading and success views; the `@golden` smoke video |
| `PICK small.txt → upload ok → RESET → idle` | "Upload another" (the old reset bug) |
| `PICK small.txt → upload refused → failed` | the route's refusal message; the `@error` smoke video |
| `PICK small.txt → upload refused → RESET → idle` | "Try again" |
| `PICK small.txt → upload unreachable → failed` | a dropped connection (the route is aborted, no readable reply), the unreachable message |
| `PICK big.bin → failed` | the size limit, with no request sent |

Beyond `data-state`, each end state must show its own markup: the key on success, the error on failed (and the unreachable message for a dropped connection), no error elsewhere, the dropzone on idle and dragging. A path with no upload step must not have sent a request.
