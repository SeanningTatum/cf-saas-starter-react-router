import { Link } from "react-router";

export default function BucketIndex() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">R2 Bucket Management</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/bucket/upload"
          className="block p-6 bg-white border border-gray-200 rounded-lg shadow hover:bg-gray-100"
        >
          <h2 className="text-xl font-semibold mb-2">Upload File</h2>
          <p className="text-gray-600">Upload files to your R2 bucket</p>
        </Link>

        <Link
          to="/bucket/list"
          className="block p-6 bg-white border border-gray-200 rounded-lg shadow hover:bg-gray-100"
        >
          <h2 className="text-xl font-semibold mb-2">List Objects</h2>
          <p className="text-gray-600">View all objects in your R2 bucket</p>
        </Link>

        <Link
          to="/bucket/delete"
          className="block p-6 bg-white border border-gray-200 rounded-lg shadow hover:bg-gray-100"
        >
          <h2 className="text-xl font-semibold mb-2">Delete File</h2>
          <p className="text-gray-600">Remove files from your R2 bucket</p>
        </Link>
      </div>

      <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h3 className="font-semibold mb-2">Configuration Required</h3>
        <p className="text-sm text-gray-700">
          Make sure you have configured an R2 bucket binding named <code className="bg-gray-200 px-1 rounded">BUCKET</code> in your wrangler.jsonc file:
        </p>
        <pre className="mt-2 p-2 bg-gray-800 text-white text-xs rounded overflow-x-auto">
          {`[[r2_buckets]]
binding = "BUCKET"
bucket_name = "your-bucket-name"`}
        </pre>
      </div>
    </div>
  );
}

