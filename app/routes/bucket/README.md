# R2 Bucket Routes

This directory contains route handlers for managing files in Cloudflare R2 (object storage).

## Routes

- **`/bucket`** - Index page with links to all bucket operations
- **`/bucket/upload`** - Upload files to R2
- **`/bucket/list`** - List all objects in the bucket
- **`/bucket/delete`** - Delete files from R2
- **`/bucket/get/:key`** - Retrieve a specific file from R2

## Configuration

To use these routes, you need to configure an R2 bucket binding in your `wrangler.jsonc` file:

```jsonc
{
  // ... other configuration
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "your-bucket-name"
    }
  ]
}
```

### Creating an R2 Bucket

1. **Create bucket via CLI:**
   ```bash
   wrangler r2 bucket create your-bucket-name
   ```

2. **Or via Cloudflare Dashboard:**
   - Go to R2 in your Cloudflare dashboard
   - Click "Create bucket"
   - Name your bucket

3. **Update worker-configuration.d.ts:**
   After creating the bucket, add the binding to your TypeScript types:
   ```typescript
   declare namespace Cloudflare {
     interface Env {
       BUCKET: R2Bucket;
       // ... other bindings
     }
   }
   ```

4. **Regenerate types:**
   ```bash
   npm run cf-typegen
   ```

## API Usage

### Upload a File

**POST** `/bucket/upload`

Form data:
- `file` (required) - The file to upload
- `key` (optional) - Custom key/path for the file
- `contentType` (optional) - Content type of the file

Response:
```json
{
  "success": true,
  "key": "uploads/1234567890-abc-def.jpg",
  "message": "File uploaded successfully"
}
```

### List Objects

**GET** `/bucket/list?prefix=uploads/&limit=100`

Query parameters:
- `prefix` (optional) - Filter objects by prefix
- `limit` (optional) - Maximum number of objects to return (default: 1000)

Response:
```json
{
  "objects": [
    {
      "key": "uploads/file.jpg",
      "size": 12345,
      "uploaded": "2025-01-01T00:00:00.000Z",
      "httpMetadata": {
        "contentType": "image/jpeg"
      }
    }
  ],
  "truncated": false,
  "cursor": "optional-cursor-for-pagination"
}
```

### Get a File

**GET** `/bucket/get/:key`

Returns the file with appropriate headers.

### Delete a File

**POST** `/bucket/delete`

Form data:
- `key` (required) - The key of the file to delete

Response:
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

## Error Handling

All routes include proper error handling and will return appropriate HTTP status codes:
- `400` - Bad request (missing required parameters)
- `404` - File not found
- `500` - Server error (including missing bucket binding)

## Security Considerations

⚠️ **Important:** These routes are currently public. For production use, you should:

1. Add authentication/authorization checks
2. Implement rate limiting
3. Add file size limits
4. Validate file types
5. Sanitize file names
6. Consider using signed URLs for direct uploads

Example of adding authentication:

```typescript
export async function action({ request, context }: Route.ActionArgs) {
  // Add auth check
  const user = await getAuthenticatedUser(context);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // ... rest of the action
}
```

