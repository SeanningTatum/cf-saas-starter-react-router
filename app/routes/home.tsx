import { api } from "@/trpc/client";
import type { Route } from "./+types/home";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `${loaderData.message}` },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  context.cloudflare.env.EXAMPLE_WORKFLOW.create({
    params: {
      email: "test@example.com",
      metadata: {
        test: "test",
      },
    }
  });

  const user = await context.trpc.user.getUsers();
  const hello = await context.trpc.example.hello();

  return {
    message: context.cloudflare.env.VALUE_FROM_CLOUDFLARE,
    user,
    hello,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const utils = api.useUtils();
  const session = authClient.useSession();
  const { data: user, isLoading, error } = api.user.getUsers.useQuery();
  const { data: usersProtected, isLoading: isLoadingProtected, error: errorProtected } = api.user.getUsersProtected.useQuery();

  async function createRandomUser() {
    await authClient.signUp.email({
      email: "test" + Math.random() + "@example.com",
      password: "password",
      name: "Test User " + Math.random(),
    });
    await utils.user.getUsers.invalidate();
    await utils.user.getUsersProtected.invalidate();
  }

  async function signout() {
    await authClient.signOut();
    await utils.user.getUsers.invalidate();
    await utils.user.getUsersProtected.invalidate();
  }

  return (
    <div>
      <h1>Hello World {loaderData.message}</h1>
      <div>
        <h2>User from tRPC:</h2>
        <pre>{JSON.stringify(loaderData.user, null, 2)}</pre>
      </div>
      <div>
        <h2>Hello from tRPC:</h2>
        <p>{loaderData.hello}</p>
      </div>
      <div>
        <h2>Session:</h2>
        <pre>{JSON.stringify(session, null, 2)}</pre>
      </div>
      {isLoading ? <div>Loading...</div> : <div>User from trpc client: {user?.map((user) => user.name).join(", ")}</div>}
      {isLoadingProtected ? <div>Loading...</div> : <div>User from trpc client protected: {usersProtected?.map((user) => user.name).join(", ")}</div>}
      {!session.data?.user ? <Button onClick={createRandomUser}>Create Random User</Button> : null}
      {session.data?.user ? <Button onClick={signout}>Sign Out</Button> : null}
    </div>
  );
}
