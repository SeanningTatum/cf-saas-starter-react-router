import { useState, useRef, useEffect, type DragEvent, type ChangeEvent } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { action } from "@/routes/api/upload-file";

interface FileUploadProps {
  onUploadSuccess?: (key: string) => void;
  onUploadError?: (error: string) => void;
  accept?: string;
  maxSize?: number; // in bytes
  className?: string;
}

export function FileUpload({
  onUploadSuccess,
  onUploadError,
  accept,
  maxSize = 10 * 1024 * 1024, // 10MB default
  className,
}: FileUploadProps) {
  const { t } = useTranslation("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher<typeof action>();

  const validateFile = (file: File): string | null => {
    if (maxSize && file.size > maxSize) {
      return t("size_limit_exceeded", { size: (maxSize / 1024 / 1024).toFixed(0) });
    }
    return null;
  };

  // Handle fetcher results — the action returns { success: true, key } or
  // { success: false, error } on every branch (401/400/500 included)
  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      onUploadSuccess?.(fetcher.data.key);
    } else {
      const errorMessage = fetcher.data.error || t("failed");
      setError(errorMessage);
      onUploadError?.(errorMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, onUploadSuccess, onUploadError]);

  const handleFile = (file: File) => {
    setError(null);

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      onUploadError?.(validationError);
      return;
    }

    setSelectedFile(file);

    const formData = new FormData();
    formData.append("file", file);

    fetcher.submit(formData, {
      method: "POST",
      action: "/api/upload-file",
      encType: "multipart/form-data",
    });
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleReset = () => {
    setSelectedFile(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isUploading = fetcher.state === "submitting" || fetcher.state === "loading";
  const uploadedKey = fetcher.data?.success ? fetcher.data.key : undefined;

  return (
    <div className={cn("w-full", className)}>
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileInputChange}
        accept={accept}
        className="hidden"
        aria-label={t("file_input_label")}
      />

      {!uploadedKey ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleBrowseClick}
          className={cn(
            "relative flex flex-col items-center justify-center w-full h-64 px-4 transition-all border-2 border-dashed rounded-lg cursor-pointer",
            isDragging
              ? "border-primary bg-primary/5 scale-[1.02]"
              : "border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500",
            "bg-background hover:bg-accent/50 dark:bg-input/10",
            isUploading && "pointer-events-none opacity-70"
          )}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-4">
              <Spinner size="lg" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("uploading", { name: selectedFile?.name })}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("please_wait")}
                </p>
              </div>
            </div>
          ) : (
            <>
              <svg
                className="w-12 h-12 mb-4 text-gray-400 dark:text-gray-500"
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
                <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <span className="text-primary">{t("dropzone.click_to_upload")}</span>{" "}
                  {t("dropzone.drag_and_drop")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {accept
                    ? t("dropzone.accepted_formats", { formats: accept })
                    : t("dropzone.any_file_type")}
                </p>
                {maxSize && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t("dropzone.max_size", { size: (maxSize / 1024 / 1024).toFixed(0) })}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center w-full h-64 px-4 border-2 border-green-500 dark:border-green-600 bg-green-50 dark:bg-green-950/20 rounded-lg">
          <svg
            className="w-16 h-16 mb-4 text-green-500 dark:text-green-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {t("success")}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
            {selectedFile?.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mb-4 font-mono">
            {t("key_label", { key: uploadedKey })}
          </p>
          <Button onClick={handleReset} variant="outline" size="sm">
            {t("upload_another")}
          </Button>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                {t("failed")}
              </p>
              <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                {error}
              </p>
            </div>
          </div>
          <Button
            onClick={handleReset}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            {t("try_again")}
          </Button>
        </div>
      )}
    </div>
  );
}

