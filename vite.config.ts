import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { sandboxBuildOn, sandboxWorkerVars } from "./app/lib/sandbox/switch";

export default defineConfig(({ command }) => {
  const sandbox = sandboxBuildOn({
    DEV: command === "serve",
    VITE_SANDBOX: process.env.VITE_SANDBOX,
  });
  return {
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
        config: { vars: sandboxWorkerVars(sandbox) },
      }),
      tailwindcss(),
      reactRouter(),
      tsconfigPaths(),
    ],
  };
});
