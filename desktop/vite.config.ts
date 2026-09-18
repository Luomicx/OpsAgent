import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 会在固定端口上等待前端就绪，因此这里禁用端口漂移。
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Tauri 期望一个确定的开发地址
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5184 } : undefined,
    watch: {
      // src-tauri 由 cargo 自己监听，避免前端 watcher 重复触发
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // Tauri 使用 WebView2 / WKWebView，可安全面向现代语法
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    outDir: "dist",
  },
});
