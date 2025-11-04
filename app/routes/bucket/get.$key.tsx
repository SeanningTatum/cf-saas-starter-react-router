import { getFromR2 } from "@/repositories/bucket";
import type { Route } from "./+types/get.$key";

export async function loader({ params, context }: Route.LoaderArgs) {
  try {
    // Check if bucket binding exists
    const bucket = context.cloudflare.env.BUCKET;
    if (!bucket) {
      throw new Response("R2 bucket binding not configured", { status: 500 });
    }

    const key = decodeURIComponent(params.key);

    if (!key) {
      throw new Response("No key provided", { status: 400 });
    }

    const object = await getFromR2(bucket, key);

    if (!object) {
      throw new Response("File not found", { status: 404 });
    }

    // Return the file with appropriate headers
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": object.size.toString(),
        "ETag": object.httpEtag,
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error("Get error:", error);

    if (error instanceof Response) {
      throw error;
    }

    throw new Response(
      error instanceof Error ? error.message : "Failed to get file",
      { status: 500 }
    );
  }
}

