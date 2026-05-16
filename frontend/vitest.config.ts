import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.tsx"],
    testTimeout: 15000,
    // Deterministic single-process run avoids jsdom/worker contention flakiness
    pool: "forks",
    singleFork: true,
  },
});
