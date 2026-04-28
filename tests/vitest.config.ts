import { defineConfig } from "vitest/config";

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
      "@pipecat-ai/openai-realtime-webrtc-transport": new URL(
        "../transports/openai-realtime-webrtc-transport/src/index.ts",
        import.meta.url
      ).pathname,
      "@pipecat-ai/gemini-live-websocket-transport": new URL(
        "../transports/gemini-live-websocket-transport/src/index.ts",
        import.meta.url
      ).pathname,
    },
  },
});
