import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
    unstable_optimizeDeps: true,
  },
} satisfies Config;
