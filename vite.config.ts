import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.md": "bun run check:mermaid --",
  },
});
