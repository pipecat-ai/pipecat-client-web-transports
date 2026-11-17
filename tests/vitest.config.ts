import { existsSync, realpathSync } from "node:fs";
import { defineConfig } from "vitest/config";

// When @pipecat-ai/client-js is linked to a source checkout, run against its
// source so suites that drive a real PipecatClient track client-js changes
// without a rebuild. A registry install ships only dist, so leave it alone.
const clientJsDir = new URL(
  "../node_modules/@pipecat-ai/client-js",
  import.meta.url
).pathname;
const clientJsSource = existsSync(`${clientJsDir}/index.ts`)
  ? `${realpathSync(clientJsDir)}/index.ts`
  : undefined;

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: false,
    include: ["src/**/*.spec.ts"],
  },
  resolve: {
    // Resolve each transport workspace to its source entry so vitest compiles
    // TypeScript directly rather than pulling from each package's `dist`. Keeps
    // characterization tests in lockstep with source and avoids a build step.
    alias: {
      ...(clientJsSource ? { "@pipecat-ai/client-js": clientJsSource } : {}),
      "@pipecat-ai/transport-lib": new URL(
        "../lib/src/index.ts",
        import.meta.url
      ).pathname,
      "@pipecat-ai/daily-transport": new URL(
        "../transports/daily/src/index.ts",
        import.meta.url
      ).pathname,
      "@pipecat-ai/small-webrtc-transport": new URL(
        "../transports/small-webrtc-transport/src/index.ts",
        import.meta.url
      ).pathname,
      "@pipecat-ai/websocket-transport": new URL(
        "../transports/websocket-transport/src/index.ts",
        import.meta.url
      ).pathname,
      "@pipecat-ai/moq-transport": new URL(
        "../transports/moq-transport/src/index.ts",
        import.meta.url
      ).pathname,
      "@pipecat-ai/livekit-transport": new URL(
        "../transports/livekit-transport/src/index.ts",
        import.meta.url
      ).pathname,
    },
  },
});
