import { listR2Objects } from "@/repositories/bucket";
import type { Route } from "./+types/list";

export async function loader({ request, context }: Route.LoaderArgs) {
  try {
    // Check if bucket binding exists
    const bucket = context.cloudflare.env.BUCKET as R2Bucket | undefined;
    if (!bucket) {
      return Response.json(
        { error: "R2 bucket binding not configured", objects: [] },
        { status: 500 }
      );
    }

    const url = new URL(request.url);
    const prefix = url.searchParams.get("prefix") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "1000");

    const result = await listR2Objects(bucket, prefix, limit);

    return Response.json({
      objects: result.objects.map((obj) => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded.toISOString(),
        httpMetadata: obj.httpMetadata,
      })),
      truncated: result.truncated,
      cursor: "cursor" in result ? result.cursor : undefined,
    });
  } catch (error) {
    console.error("List error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to list objects",
        objects: [],
      },
      { status: 500 }
    );
  }
}

export default function BucketList({ loaderData }: Route.ComponentProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">R2 Bucket Objects</h1>

      {loaderData.error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {loaderData.error}
        </div>
      )}

      <div className="mb-4">
        <form method="get" className="flex gap-2">
          <input
            type="text"
            name="prefix"
            placeholder="Filter by prefix..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="number"
            name="limit"
            placeholder="Limit"
            defaultValue="1000"
            className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Filter
          </button>
        </form>
      </div>

      {loaderData.objects.length === 0 ? (
        <p className="text-gray-500">No objects found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-300">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 border-b text-left">Key</th>
                <th className="px-4 py-2 border-b text-left">Size</th>
                <th className="px-4 py-2 border-b text-left">Content Type</th>
                <th className="px-4 py-2 border-b text-left">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.objects.map((obj: { key: string; size: number; uploaded: string; httpMetadata?: { contentType?: string } }) => (
                <tr key={obj.key} className="hover:bg-gray-50">
                  <td className="px-4 py-2 border-b">
                    <a
                      href={`/bucket/get/${encodeURIComponent(obj.key)}`}
                      className="text-blue-600 hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {obj.key}
                    </a>
                  </td>
                  <td className="px-4 py-2 border-b">
                    {(obj.size / 1024).toFixed(2)} KB
                  </td>
                  <td className="px-4 py-2 border-b">
                    {obj.httpMetadata?.contentType || "N/A"}
                  </td>
                  <td className="px-4 py-2 border-b">
                    {new Date(obj.uploaded).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loaderData.truncated && (
        <div className="mt-4 text-sm text-gray-600">
          Results truncated. Use cursor pagination for more results.
        </div>
      )}
    </div>
  );
}

