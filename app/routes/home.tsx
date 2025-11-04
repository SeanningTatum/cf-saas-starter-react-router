import { Suspense } from "react";
import { api } from "@/trpc/client";
import type { Route } from "./+types/home";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: "Cloudflare SaaS Starter" },
    { name: "description", content: "Full-stack SaaS starter with Cloudflare, React Router, tRPC, and Better Auth" },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  return {
    message: "Cloudflare SaaS Starter",
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="container min-h-screen py-16 mx-auto">
      <div className="flex flex-col items-center justify-center gap-8">
        {/* Hero Section */}
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            Create{" "}
            <span className="bg-linear-to-r from-orange-500 to-yellow-500 bg-clip-text text-transparent">
              Cloudflare
            </span>{" "}
            SaaS
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Full-stack TypeScript starter with{" "}
            <span className="font-semibold text-foreground">Cloudflare Workers</span>,{" "}
            <span className="font-semibold text-foreground">React Router</span>,{" "}
            <span className="font-semibold text-foreground">tRPC</span>,{" "}
            <span className="font-semibold text-foreground">Better Auth</span>, and{" "}
            <span className="font-semibold text-foreground">Drizzle ORM</span>
          </p>
        </div>

        {/* Authentication Pages Showcase */}
        <div className="w-full max-w-4xl">
          <h2 className="mb-6 text-center text-2xl font-bold">Authentication Showcase</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <Link to="/login" className="transition-transform hover:scale-105">
              <Card className="h-full cursor-pointer border-2 hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-2xl">🔐</span>
                    Login Page
                  </CardTitle>
                  <CardDescription>
                    Experience our authentication system
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Try out the login form with Better Auth integration, including email/password authentication and session management.
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link to="/sign-up" className="transition-transform hover:scale-105">
              <Card className="h-full cursor-pointer border-2 hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-2xl">✨</span>
                    Sign Up Page
                  </CardTitle>
                  <CardDescription>
                    Create a new account easily
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Check out our registration flow with form validation, password requirements, and seamless user creation.
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

        {/* Auth Showcase */}
        <AuthShowcase />

        {/* User List */}
        <div className="w-full max-w-2xl">
          <h2 className="mb-4 text-2xl font-bold">Registered Users</h2>
          <Suspense
            fallback={
              <div className="flex w-full flex-col gap-4">
                <UserCardSkeleton />
                <UserCardSkeleton />
                <UserCardSkeleton />
              </div>
            }
          >
            <UserList />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

function AuthShowcase() {
  const session = authClient.useSession();
  const utils = api.useUtils();

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
    void utils.user.getUsers.invalidate();
    void utils.user.getUsersProtected.reset();
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border bg-card p-8 shadow-sm">
      <div className="text-center">
        {session.data?.user ? (
          <>
            <p className="mb-2 text-lg">
              Signed in as{" "}
              <span className="font-semibold text-primary">
                {session.data.user.name || session.data.user.email}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              {session.data.user.email}
            </p>
          </>
        ) : (
          <p className="text-lg text-muted-foreground">
            You are not signed in
          </p>
        )}
      </div>
      <div className="flex gap-2">
        {!session.data?.user ? (
          <Button onClick={createRandomUser} size="lg">
            Sign Up (Demo)
          </Button>
        ) : (
          <Button onClick={signout} variant="outline" size="lg">
            Sign Out
          </Button>
        )}
      </div>
    </div>
  );
}


function UserList() {
  const session = authClient.useSession();
  const { data: users, isLoading } = api.user.getUsers.useQuery();
  const { data: usersProtected, isLoading: isLoadingProtected } =
    api.user.getUsersProtected.useQuery(undefined, {
      retry: false,
      enabled: !!session.data?.user,
    });

  if (isLoading) {
    return (
      <div className="flex w-full flex-col gap-4">
        <UserCardSkeleton />
        <UserCardSkeleton />
      </div>
    );
  }

  if (!users || users.length === 0) {
    return (
      <div className="relative flex w-full flex-col gap-4">
        <UserCardSkeleton pulse={false} />
        <UserCardSkeleton pulse={false} />
        <UserCardSkeleton pulse={false} />
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/10">
          <p className="text-2xl font-bold text-white">No users yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex w-full flex-col gap-3">
        {users.map((user) => (
          <UserCard key={user.id} user={user} />
        ))}
      </div>

      {/* Protected Users Section */}
      <div className="mt-8">
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          Protected Query Result
          <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-500">
            Auth Required
          </span>
        </h3>
        {isLoadingProtected ? (
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">Loading protected data...</p>
          </div>
        ) : usersProtected ? (
          <div className="rounded-lg border bg-green-500/10 p-4">
            <p className="text-sm font-medium text-green-600 dark:text-green-500">
              ✓ Successfully fetched {usersProtected.length} users from protected endpoint
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-red-500/10 p-4">
            <p className="text-sm font-medium text-red-600 dark:text-red-500">
              ✗ Unauthorized - Sign in to access protected data
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function UserCard(props: { user: { id: string; name: string | null; email: string } }) {
  const session = authClient.useSession();
  const utils = api.useUtils();
  const deleteUserMutation = api.user.deleteUser.useMutation({
    onSuccess: () => {
      // Invalidate and refetch user queries after deletion
      void utils.user.getUsers.invalidate();
      void utils.user.getUsersProtected.invalidate();
    },
  });

  const handleDelete = async () => {
    await deleteUserMutation.mutateAsync(props.user.id);
  };

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm">
      <div>
        <h3 className="font-semibold text-primary">
          {props.user.name || "Anonymous User"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{props.user.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="size-10 rounded-full bg-linear-to-br from-orange-500 to-yellow-500" />
        {session.data?.user && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteUserMutation.isPending}
          >
            {deleteUserMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>
    </div>
  );
}

function UserCardSkeleton(props: { pulse?: boolean }) {
  const { pulse = true } = props;
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex-1">
        <div
          className={cn(
            "mb-2 h-5 w-32 rounded bg-primary/20",
            pulse && "animate-pulse"
          )}
        />
        <div
          className={cn(
            "h-4 w-48 rounded bg-muted",
            pulse && "animate-pulse"
          )}
        />
      </div>
      <div
        className={cn(
          "size-10 rounded-full bg-muted",
          pulse && "animate-pulse"
        )}
      />
    </div>
  );
}
