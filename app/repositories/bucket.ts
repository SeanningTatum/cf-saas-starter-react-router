import {
  BucketBindingError,
  BucketUploadError,
  BucketGetError,
  BucketDeleteError,
  BucketListError,
} from "@/models/errors/bucket";

interface UploadOptions {
  key?: string;
  contentType?: string;
}

/**
 * Uploads a file to the R2 bucket
 * @param file - The file data as Buffer, Uint8Array, or string
 * @param options - Upload options including optional key and contentType
 * @returns The key (path) of the uploaded file in R2
 */
export async function uploadToR2(
  bucket: R2Bucket,
  file: Blob | Uint8Array | string | File,
  options: UploadOptions = {}
): Promise<string> {
  try {
    // Generate a unique key if not provided
    const key = options.key ?? `uploads/${Date.now()}-${crypto.randomUUID()}`;

    // Handle File object
    let data: Uint8Array;
    let contentType: string | undefined = options.contentType;

    if (file instanceof File) {
      data = new Uint8Array(await file.arrayBuffer());
      contentType = contentType ?? file.type;
    } else {
      data = file as Uint8Array;
    }

    // Upload to R2
    await bucket.put(key, data, {
      httpMetadata: contentType
        ? {
            contentType,
          }
        : undefined,
    });

    return key;
  } catch (err) {
    if (err instanceof BucketBindingError) {
      throw err;
    }
    console.error("Failed to upload to R2:", err);
    throw new BucketUploadError(
      "Failed to upload file to R2 - make sure you're running in a Cloudflare Worker context",
      err
    );
  }
}

/**
 * Gets a file from the R2 bucket
 * @param key - The key (path) of the file in R2
 * @returns   The file object from R2 or null if not found
 */
export async function getFromR2(bucket: R2Bucket, key: string) {
  try {
    return await bucket.get(key);
  } catch (err) {
    if (err instanceof BucketBindingError) {
      throw err;
    }
    console.error("Failed to get from R2:", err);
    throw new BucketGetError(
      "Failed to get file from R2 - make sure you're running in a Cloudflare Worker context",
      err
    );
  }
}

/**
 * Deletes a file from the R2 bucket
 * @param key - The key (path) of the file to delete
 */
export async function deleteFromR2(
  bucket: R2Bucket,
  key: string
): Promise<void> {
  try {
    await bucket.delete(key);
  } catch (err) {
    if (err instanceof BucketBindingError) {
      throw err;
    }
    console.error("Failed to delete from R2:", err);
    throw new BucketDeleteError(
      "Failed to delete file from R2 - make sure you're running in a Cloudflare Worker context",
      err
    );
  }
}

/**
 * Lists objects in the R2 bucket with optional prefix
 * @param prefix - Optional prefix to filter objects
 * @param limit - Maximum number of objects to return (default: 1000)
 */
export async function listR2Objects(
  bucket: R2Bucket,
  prefix?: string,
  limit: number = 1000
) {
  try {
    return await bucket.list({ prefix, limit });
  } catch (err) {
    if (err instanceof BucketBindingError) {
      throw err;
    }
    console.error("Failed to list R2 objects:", err);
    throw new BucketListError(
      "Failed to list R2 objects - make sure you're running in a Cloudflare Worker context",
      err
    );
  }
}
