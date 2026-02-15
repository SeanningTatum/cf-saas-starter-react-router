import { Suspense } from "react";
import { api } from "@/trpc/client";
import type { Route } from "./+types/home";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

export const handle = { i18n: ["home"] };

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
  const { t } = useTranslation("home");

  return (
    <main className="container min-h-screen py-16 mx-auto">
      <div className="flex flex-col items-center justify-center gap-8">
        {/* Hero Section */}
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            {t("hero.create")}{" "}
            <span className="bg-linear-to-r from-orange-500 to-yellow-500 bg-clip-text text-transparent">
              {t("hero.cloudflare")}
            </span>{" "}
            {t("hero.saas")}
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            {t("hero.description")}{" "}
            <span className="font-semibold text-foreground">{t("hero.workers")}</span>,{" "}
            <span className="font-semibold text-foreground">{t("hero.react_router")}</span>,{" "}
            <span className="font-semibold text-foreground">{t("hero.trpc")}</span>,{" "}
            <span className="font-semibold text-foreground">{t("hero.better_auth")}</span>, {t("hero.and")}{" "}
            <span className="font-semibold text-foreground">{t("hero.drizzle")}</span>
          </p>
        </div>

        {/* Authentication Pages Showcase */}
        <div className="w-full max-w-4xl">
          <h2 className="mb-6 text-center text-2xl font-bold">{t("auth_showcase.title")}</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <Link to="/login" className="transition-transform hover:scale-105">
              <Card className="h-full cursor-pointer border-2 hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-2xl">🔐</span>
                    {t("auth_showcase.login_title")}
                  </CardTitle>
                  <CardDescription>
                    {t("auth_showcase.login_description")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {t("auth_showcase.login_detail")}
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link to="/sign-up" className="transition-transform hover:scale-105">
              <Card className="h-full cursor-pointer border-2 hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-2xl">✨</span>
                    {t("auth_showcase.signup_title")}
                  </CardTitle>
                  <CardDescription>
                    {t("auth_showcase.signup_description")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {t("auth_showcase.signup_detail")}
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
          <h2 className="mb-4 text-2xl font-bold">{t("user_list.title")}</h2>
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
  const { t } = useTranslation("home");

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
              {t("auth_showcase.signed_in_as")}{" "}
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
            {t("auth_showcase.not_signed_in")}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        {!session.data?.user ? (
          <Button onClick={createRandomUser} size="lg">
            {t("auth_showcase.sign_up_demo")}
          </Button>
        ) : (
          <Button onClick={signout} variant="outline" size="lg">
            {t("auth_showcase.sign_out")}
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
  const { t } = useTranslation("home");
  const { t: tc } = useTranslation("common");

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
          <p className="text-2xl font-bold text-white">{t("user_list.no_users")}</p>
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
          {t("user_list.protected_query")}
          <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-500">
            {t("user_list.auth_required")}
          </span>
        </h3>
        {isLoadingProtected ? (
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">{tc("loading_protected_data")}</p>
          </div>
        ) : usersProtected ? (
          <div className="rounded-lg border bg-green-500/10 p-4">
            <p className="text-sm font-medium text-green-600 dark:text-green-500">
              ✓ {t("user_list.protected_success", { count: usersProtected.length })}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-red-500/10 p-4">
            <p className="text-sm font-medium text-red-600 dark:text-red-500">
              ✗ {t("user_list.protected_unauthorized")}
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
  const { t } = useTranslation("home");
  const deleteUserMutation = api.user.deleteUser.useMutation({
    onSuccess: () => {
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
          {props.user.name || t("user_list.anonymous_user")}
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
            {deleteUserMutation.isPending ? t("user_list.deleting") : t("user_list.delete")}
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
