import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node18",
  outDir: "dist",
  clean: true,
  external: ["@modelcontextprotocol/sdk", "youtube-transcript", "ytdlp-nodejs"],
});
