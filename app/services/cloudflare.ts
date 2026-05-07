import { Context, Layer } from "effect";

export class CloudflareEnv extends Context.Tag("app/CloudflareEnv")<
  CloudflareEnv,
  Env
>() {}

export const CloudflareEnvLive = (env: Env) => Layer.succeed(CloudflareEnv, env);
