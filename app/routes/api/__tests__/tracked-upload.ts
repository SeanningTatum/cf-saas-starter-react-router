export interface TrackedUpload {
  readonly request: Request;
  readonly bodyRead: () => boolean;
}

export interface TrackedUploadOptions {
  readonly form?: FormData;
  readonly headers?: HeadersInit;
  readonly contentLength?: number;
}

export const trackedUpload = async (
  url: string,
  { form = new FormData(), headers, contentLength }: TrackedUploadOptions = {}
): Promise<TrackedUpload> => {
  const encoded = new Request(url, { method: "POST", body: form });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  let pulled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled = true;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  const sent = new Headers(headers);
  sent.set("content-type", encoded.headers.get("content-type") ?? "");
  if (contentLength !== undefined) sent.set("content-length", String(contentLength));
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers: sent, body, duplex: "half" };
  return { request: new Request(url, init), bodyRead: () => pulled };
};
