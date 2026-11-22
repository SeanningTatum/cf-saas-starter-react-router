import { describe, expect, it, vi } from "vitest";
import { Either } from "effect";
import { createActor, fromPromise, waitFor } from "xstate";
import { BucketValidationError } from "@/models/errors/bucket";
import { ExternalServiceError } from "@/models/errors/repository";
import {
  fileUploadMachine,
  type FileUploadEmitted,
  type FileUploadState,
  type UploadResult,
} from "../file-upload.machine";
import { describePath, fileUploadEdgePaths, fileUploadPaths } from "../file-upload.model";

const MAX = 10;
const small = new File(["12345"], "small.txt");
const big = new File(["12345678901"], "big.txt");

const start = (result: UploadResult = Either.right({ key: "k1" })) => {
  const upload = vi.fn(async () => result);
  const actor = createActor(
    fileUploadMachine.provide({ actors: { upload: fromPromise(upload) } }),
    { input: { maxSize: MAX } }
  ).start();
  const emitted: FileUploadEmitted[] = [];
  actor.on("*", (e) => emitted.push(e));
  return { actor, upload, emitted };
};

const settled = (actor: ReturnType<typeof start>["actor"]) =>
  waitFor(actor, (s) => !s.matches("uploading"));

describe("fileUploadMachine", () => {
  // Catches the bug in the old component: "Upload another" cleared the file
  // but not the fetcher's data, so the success panel never went away.
  it("RESET after a success returns to idle and clears the key and file", async () => {
    const { actor } = start();
    actor.send({ type: "PICK", file: small });
    await settled(actor);
    expect(actor.getSnapshot().value).toBe("success");
    expect(actor.getSnapshot().context.key).toBe("k1");

    actor.send({ type: "RESET" });
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context).toMatchObject({ key: null, file: null, error: null });
  });

  // Catches: an oversize file reaching the network.
  it("fails an oversize file without uploading it", () => {
    const { actor, upload, emitted } = start();
    actor.send({ type: "PICK", file: big });
    expect(actor.getSnapshot().value).toBe("failed");
    expect(actor.getSnapshot().context.error).toEqual({ reason: "too_big" });
    expect(upload).not.toHaveBeenCalled();
    expect(emitted).toEqual([{ type: "failed", error: { reason: "too_big" } }]);
  });

  // Catches: the route's reason being swapped for a generic message.
  it("fails with the route's message when the route refuses the file", async () => {
    const { actor, emitted } = start(
      Either.left(new BucketValidationError({ message: "Wrong type", field: "file" }))
    );
    actor.send({ type: "PICK", file: small });
    await settled(actor);
    expect(actor.getSnapshot().value).toBe("failed");
    expect(actor.getSnapshot().context.error).toEqual({ reason: "rejected", message: "Wrong type" });
    expect(emitted).toEqual([
      { type: "failed", error: { reason: "rejected", message: "Wrong type" } },
    ]);
  });

  // Catches: a transport failure leaving the component stuck in uploading.
  it("fails as unreachable when the server cannot be reached", async () => {
    const { actor } = start(Either.left(new ExternalServiceError({ service: "upload-file" })));
    actor.send({ type: "PICK", file: small });
    await settled(actor);
    expect(actor.getSnapshot().value).toBe("failed");
    expect(actor.getSnapshot().context.error).toEqual({ reason: "unreachable" });
  });

  // Catches: onUploadSuccess firing with a stale or missing key.
  it("emits uploaded with the new key once, on success", async () => {
    const { actor, emitted } = start(Either.right({ key: "uploads/a.png" }));
    actor.send({ type: "PICK", file: small });
    await settled(actor);
    expect(emitted).toEqual([{ type: "uploaded", key: "uploads/a.png" }]);
  });

  // Catches: a second pick or a reset during an upload starting a second
  // request or dropping the first one's result.
  it("ignores PICK and RESET while uploading", async () => {
    const { actor, upload } = start();
    actor.send({ type: "PICK", file: small });
    actor.send({ type: "PICK", file: small });
    actor.send({ type: "RESET" });
    expect(actor.getSnapshot().value).toBe("uploading");
    await settled(actor);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().value).toBe("success");
  });

  // Catches: the highlighted drop zone sticking after the pointer leaves.
  it("goes back to idle when a drag leaves", () => {
    const { actor } = start();
    actor.send({ type: "DRAG_ENTER" });
    expect(actor.getSnapshot().value).toBe("dragging");
    actor.send({ type: "DRAG_LEAVE" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  // Catches: an old error staying on screen while the user drags a new file in.
  it("clears the error when a new drag starts after a failure", () => {
    const { actor } = start();
    actor.send({ type: "PICK", file: big });
    actor.send({ type: "DRAG_ENTER" });
    expect(actor.getSnapshot().value).toBe("dragging");
    expect(actor.getSnapshot().context.error).toBeNull();
  });

  // Catches: "Try again" by picking a new file not working after a failure.
  it("uploads a new pick straight from failed", async () => {
    const { actor } = start();
    actor.send({ type: "PICK", file: big });
    actor.send({ type: "PICK", file: small });
    expect(actor.getSnapshot().value).toBe("uploading");
    await settled(actor);
    expect(actor.getSnapshot().value).toBe("success");
  });

  // Catches: a state that no sequence of events can reach, or a dead end with
  // no way back to idle. The e2e spec replays these same paths in the browser.
  it("reaches every state, and every state can get back to idle", () => {
    const paths = fileUploadPaths({ maxSize: MAX, small, big });
    const reached = new Set(paths.map((p) => String(p.state.value)));
    const all: FileUploadState[] = ["idle", "dragging", "uploading", "success", "failed"];
    expect([...reached].sort()).toEqual([...all].sort());

    for (const path of paths) {
      const back = fileUploadPaths(
        { maxSize: MAX, small, big },
        { fromState: path.state, toState: (s) => s.matches("idle") }
      );
      expect(back.length, `no way back to idle from ${describePath(path.steps, String(path.state.value))}`).toBeGreaterThan(0);
    }
  });

  it("labels a path by its events", () => {
    const toSuccess = fileUploadPaths({ maxSize: MAX, small, big }).find((p) =>
      p.state.matches("success")
    );
    expect(toSuccess && describePath(toSuccess.steps, "success")).toBe(
      "PICK small.txt → upload ok → success"
    );
  });
  // Catches: the e2e spec skipping a transition because its target state was
  // already reached another way. The reset edge is the one the old bug broke.
  it("gives the e2e spec one path per transition, the reset edges included", () => {
    const names = fileUploadEdgePaths({ maxSize: MAX, small, big }).map((p) =>
      describePath(p.steps, String(p.state.value))
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("PICK small.txt → upload ok → RESET → idle");
    expect(names).toContain("PICK big.txt → RESET → idle");
  });
});
