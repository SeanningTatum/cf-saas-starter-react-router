import { FileUpload } from "@/components/file-upload";
import { Button } from "@/components/ui/button";
import { api } from "@/trpc/client";
import { SiteHeader } from "./layout/site-header";
import { Separator } from "@/components/ui/separator";


export default function KitchenSink() {
  const createWorkflowMutation = api.user.createWorkflow.useMutation();
  return (
    <div>
      <SiteHeader title="Kitchen Sink" />
      <div className="p-4">
        <Button
          className="mb-4"
          onClick={() => {
            createWorkflowMutation.mutate({
              email: "test@example.com",
              metadata: {
                test: "test",
              },
            });
          }}>Trigger Workflow</Button>
        {createWorkflowMutation.isPending && <p>Creating workflow...</p>}
        {createWorkflowMutation.isSuccess && <p>Workflow created successfully</p>}
        {createWorkflowMutation.isError && <p>Error creating workflow</p>}

        <Separator className="my-4" />

        <h2 className="text-lg font-medium">File Upload</h2>

        <FileUpload onUploadSuccess={(key) => {
          console.log(key);
        }} />
      </div>
    </div>
  );
}