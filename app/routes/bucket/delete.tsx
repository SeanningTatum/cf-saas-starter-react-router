import { deleteFromR2 } from "@/repositories/bucket";
import type { Route } from "./+types/delete";

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
    const key = formData.get("key") as string;

    if (!key) {
      return Response.json({ error: "No key provided" }, { status: 400 });
    }

    await deleteFromR2(bucket, key);

    return Response.json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Delete error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Delete failed",
      },
      { status: 500 }
    );
  }
}

export default function BucketDelete() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Delete from R2 Bucket</h1>
      <form method="post" className="space-y-4">
        <div>
          <label htmlFor="key" className="block text-sm font-medium mb-2">
            File Key
          </label>
          <input
            type="text"
            id="key"
            name="key"
            required
            placeholder="uploads/my-file.jpg"
            className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Delete
        </button>
      </form>
    </div>
  );
}

