# File upload

One signed-in user uploads one file to R2 through `POST /api/upload-file` (`app/routes/api/upload-file.ts`). The browser side is the `FileUpload` drop zone (`app/components/file-upload.tsx`), whose behaviour is the XState machine in `app/components/file-upload.machine.ts`, and `uploadFile` in `app/lib/upload-client.ts`. Limits and allowed types live in `app/lib/constants/upload.ts`. Rate limits: [docs/auth.md](../auth.md#rate-limits).

## Why

- **One set of limits for both sides.** The route and the browser read the same constants: `FileUpload`'s default `maxSize` is `MAX_UPLOAD_SIZE_BYTES`, and a caller builds `accept` from `ALLOWED_UPLOAD_CONTENT_TYPES`, as the kitchen sink does. The browser's check and the server's cannot drift apart.
- **No SVG.** `image/svg+xml` is not allowed: an SVG can carry script and becomes a stored-XSS vector once uploads are served from the app's origin. To allow it, serve uploads with `Content-Disposition: attachment` or from another origin first ([security-headers.md](../security-headers.md#before-you-change-the-defaults)). Test: "rejects image/svg+xml" (`app/lib/constants/__tests__/upload.test.ts`).
- **The server sniffs the content.** The multipart `file.type` is chosen by the client, so the route also checks the file's first bytes against the signature of the declared type (`matchesMagicBytes`). Test: "rejects a spoofed declared type" (same file).
- **What the browser shows.** `uploadFile` turns the route's own refusal (wrong type, too big, signed out) into a `BucketValidationError` carrying the route's message, which is safe to show only because the route answers with messages the code writes: the `UPLOAD_*_MESSAGE` constants, or the message of a validation error it raised itself. A route message must never carry a cause, a key or other internals; a 5xx answers `UPLOAD_FAILED_MESSAGE` and the cause goes to the error reporter. Anything that stops a readable reply (offline, aborted, a body that is not the route's JSON) becomes an `ExternalServiceError`, and the drop zone shows its own text. Tests: `app/lib/__tests__/upload-client.test.ts`.
- **Keys are capped at R2's limit**, `R2_MAX_KEY_LENGTH` (1024).
- **R2 may be off.** `wrangler.jsonc` has no `r2_buckets` when setup ran with R2 disabled, and then the generated `Env` has no `BUCKET`. `BucketLive` reads it as optional (`EnvWhereR2MayBeOff`) and fails with `BucketBindingError` when it is missing, so the code type-checks with R2 on or off.

### The drop zone

`FileUpload` only renders the machine's state (also put on `data-state` on its root) and forwards DOM events to it. The machine's transitions:

```text
idle --DRAG_ENTER--> dragging --DRAG_LEAVE--> idle
idle | dragging | failed --PICK [fits]--> uploading --done--> success | failed
idle | dragging | failed --PICK [too big]--> failed
success | failed --RESET--> idle (clears file, key and error)
```

The unit tests drive the machine directly and the e2e paths are generated from it: [file-upload-wiring.md](file-upload-wiring.md#why).

- **`maxSize` is read once, at mount.** It is the machine's input, so changing the prop later does nothing.
- **i18next does not escape the drop zone's text.** React already escapes every text node, and i18next's own escaping would show `/` in a key and `&` in a file name as `&#x2F;` and `&amp;`. This is safe only while the strings are rendered as React text, never as HTML.
- **The picker stays shut during an upload.** Focus can stay on the zone, and `uploading` takes no `PICK`, so a file picked then would be lost.
- **The accepted types are listed with spaces.** `image/png,image/jpeg` has no break point and overflows a phone-width zone.
- **The file input is cleared after each pick,** so picking the same file again still fires `change`. `dragleave` also fires when the pointer moves onto a child of the zone, so that case is ignored.
- **Upload results are data.** The `upload` actor runs `uploadFile` under `Effect.either`, so a refusal or a dropped connection arrives as a done event; the promise rejects only when the actor is stopped mid-flight (the signal aborts), and `onError` covers that. The emit actions read context that the `assign` before them has already updated. `keepFile` always sets a file before `uploading`; the actor's no-file branch is there so the types need no cast, not because it can run.

### The machine's test model

`app/components/file-upload.model.ts` is test support: the unit test checks its paths and the e2e spec replays them. App code does not import it.

- `xstate/graph`'s `createTestModel` refuses a machine that invokes actors, so the model walks the graph with `getShortestPaths`, and the callers replay the steps.
- Shortest paths stop at the first way into each state, so an edge into a state already reached (success, `RESET`, idle: the old reset bug) would never be replayed. `fileUploadEdgePaths` adds one more event for every event each state accepts: one path per transition.
- Done events are not in the machine's event type, but the walk needs them to leave `uploading`, so the traversal casts them in. A dropped connection is one of them (`UPLOAD_UNREACHABLE`), not an actor error, for the reason above.
- The default event key is `JSON.stringify`, and a `File` stringifies to `{}`, which would make every `PICK` one edge. A pick is keyed by the file's name and size.
