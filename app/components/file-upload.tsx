import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useMachine } from "@xstate/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fileUploadMachine, type UploadFailure } from "./file-upload.machine";

interface FileUploadProps {
  onUploadSuccess?: (key: string) => void;
  onUploadError?: (error: string) => void;
  accept?: string;
  /** In bytes. Read once, when the component mounts. */
  maxSize?: number;
  className?: string;
}

const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);

// React escapes text already; i18next's own escaping turns "/" in a key or "&"
// in a file name into &#x2F; and &amp; on screen.
const raw = { interpolation: { escapeValue: false } } as const;

// "image/png,image/jpeg" has no break points and overflows a phone-width zone.
const formatList = (accept: string) =>
  accept
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .join(", ");

/**
 * Drop zone that uploads one file to /api/upload-file. Its behaviour lives in
 * file-upload.machine.ts; this component only renders the machine's state and
 * forwards DOM events to it. `data-state` on the root mirrors that state.
 */
export function FileUpload({
  onUploadSuccess,
  onUploadError,
  accept,
  maxSize = 10 * 1024 * 1024,
  className,
}: FileUploadProps) {
  const { t } = useTranslation("upload");
  const [snapshot, send, actorRef] = useMachine(fileUploadMachine, { input: { maxSize } });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { file, key, error } = snapshot.context;
  const limit = toMB(snapshot.context.maxSize);

  const describe = useCallback(
    (failure: UploadFailure): string => {
      switch (failure.reason) {
        case "too_big":
          return t("size_limit_exceeded", { size: limit });
        case "rejected":
          return failure.message;
        case "unreachable":
          return t("unreachable");
      }
    },
    [t, limit],
  );

  useEffect(() => {
    const uploaded = actorRef.on("uploaded", (e) => onUploadSuccess?.(e.key));
    const failed = actorRef.on("failed", (e) => onUploadError?.(describe(e.error)));
    return () => {
      uploaded.unsubscribe();
      failed.unsubscribe();
    };
    // describe only reads t and the size limit, both listed here.
  }, [actorRef, onUploadSuccess, onUploadError, describe]);

  // Focus can stay on the zone during an upload, and `uploading` takes no PICK,
  // so a file picked then would be dropped. Keep the picker shut.
  const openPicker = () => {
    if (!snapshot.matches("uploading")) fileInputRef.current?.click();
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    send({ type: "DRAG_ENTER" });
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // dragleave also fires when the pointer moves onto a child of the zone.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    send({ type: "DRAG_LEAVE" });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) send({ type: "PICK", file: dropped });
    else send({ type: "DRAG_LEAVE" });
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    // Clear the input so picking the same file again still fires change.
    e.target.value = "";
    if (picked) send({ type: "PICK", file: picked });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  };

  const reset = () => send({ type: "RESET" });

  const uploading = snapshot.matches("uploading");
  const dragging = snapshot.matches("dragging");

  return (
    <div
      className={cn("w-full", className)}
      data-testid="file-upload"
      data-state={String(snapshot.value)}
    >
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleInputChange}
        accept={accept}
        className="hidden"
        aria-label={t("file_input_label")}
        data-testid="file-upload-input"
      />

      {snapshot.matches("success") ? (
        <div
          role="status"
          className="flex flex-col items-center justify-center w-full h-64 px-4 border-2 border-primary/60 bg-primary/5 rounded-lg"
        >
          <svg
            className="w-16 h-16 mb-4 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm font-semibold text-foreground mb-2">{t("success")}</p>
          <p className="text-xs text-foreground mb-1 max-w-full truncate">{file?.name}</p>
          <p
            className="text-xs text-foreground/90 mb-4 font-mono max-w-full break-all text-center"
            data-testid="file-upload-key"
          >
            {t("key_label", { key, ...raw })}
          </p>
          <Button onClick={reset} variant="outline" size="sm" data-testid="file-upload-reset">
            {t("upload_another")}
          </Button>
        </div>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: the zone wraps a file input and the upload machine drives it, so swapping the element is a UI change for its own review
        <div
          role="button"
          tabIndex={uploading ? -1 : 0}
          aria-disabled={uploading || undefined}
          aria-busy={uploading || undefined}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={openPicker}
          onKeyDown={handleKeyDown}
          data-testid="file-upload-dropzone"
          className={cn(
            "relative flex flex-col items-center justify-center w-full h-64 px-4 transition-all border-2 border-dashed rounded-lg cursor-pointer outline-none",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            dragging
              ? "border-primary bg-primary/5 scale-[1.02] motion-reduce:scale-100"
              : "border-input hover:border-muted-foreground/60",
            "bg-background hover:bg-accent/50 dark:bg-input/10",
            uploading && "pointer-events-none opacity-70",
          )}
        >
          {uploading ? (
            <div role="status" className="flex flex-col items-center gap-4">
              <Spinner size="lg" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground max-w-full truncate">
                  {t("uploading", { name: file?.name, ...raw })}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t("please_wait")}</p>
              </div>
            </div>
          ) : (
            <>
              <svg
                className="w-12 h-12 mb-4 text-muted-foreground"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="text-center">
                <p className="mb-2 text-sm font-semibold text-foreground">
                  <span className="text-primary">{t("dropzone.click_to_upload")}</span>{" "}
                  {t("dropzone.drag_and_drop")}
                </p>
                <p className="text-xs text-muted-foreground text-balance break-words">
                  {accept
                    ? t("dropzone.accepted_formats", { formats: formatList(accept), ...raw })
                    : t("dropzone.any_file_type")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("dropzone.max_size", { size: limit })}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          data-testid="file-upload-error"
          className="mt-4 p-4 bg-destructive/10 border border-destructive/30 rounded-lg"
        >
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-destructive shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{t("failed")}</p>
              <p className="text-sm text-foreground mt-1 break-words">{describe(error)}</p>
            </div>
          </div>
          <Button
            onClick={reset}
            variant="outline"
            size="sm"
            className="mt-3"
            data-testid="file-upload-reset"
          >
            {t("try_again")}
          </Button>
        </div>
      )}
    </div>
  );
}
