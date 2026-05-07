import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: false,
    environment: "node",
    include: [
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "workers/**/*.test.ts",
    ],
    exclude: ["node_modules", "e2e", ".react-router"],
    setupFiles: [],
    typecheck: {
      tsconfig: "./tsconfig.cloudflare.json",
    },
  },
});
