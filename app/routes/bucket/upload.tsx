import { uploadToR2 } from "@/repositories/bucket";
import type { Route } from "./+types/upload";

export async function action({ request, context }: Route.ActionArgs) {
  try {
    // Check if bucket binding exists
    const bucket = context.cloudflare.env.BUCKET as R2Bucket | undefined;
    if (!bucket) {
      return Response.json(
        { error: "R2 bucket binding not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // Optional parameters
    const customKey = formData.get("key") as string | null;
    const contentType = formData.get("contentType") as string | null;

    const key = await uploadToR2(bucket, file, {
      key: customKey || undefined,
      contentType: contentType || undefined,
    });

    return Response.json({
      success: true,
      key,
      message: "File uploaded successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 }
    );
  }
}

export default function BucketUpload() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Upload to R2 Bucket</h1>
      <form method="post" encType="multipart/form-data" className="space-y-4">
        <div>
          <label htmlFor="file" className="block text-sm font-medium mb-2">
            File
          </label>
          <input
            type="file"
            id="file"
            name="file"
            required
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="key" className="block text-sm font-medium mb-2">
            Custom Key (optional)
          </label>
          <input
            type="text"
            id="key"
            name="key"
            placeholder="uploads/my-file.jpg"
            className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="contentType" className="block text-sm font-medium mb-2">
            Content Type (optional)
          </label>
          <input
            type="text"
            id="contentType"
            name="contentType"
            placeholder="image/jpeg"
            className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Upload
        </button>
      </form>
    </div>
  );
}

