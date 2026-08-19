// vite.config.ts
import { defineConfig } from "file:///D:/PROGEs/chatBot/frontend/node_modules/vitest/dist/config.js";
import react from "file:///D:/PROGEs/chatBot/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (normalizedId.includes("/node_modules/recharts/")) {
            return "recharts-vendor";
          }
          if (normalizedId.includes("/node_modules/victory-vendor/") || normalizedId.includes("/node_modules/d3-")) {
            return "chart-math-vendor";
          }
          return void 0;
        }
      }
    }
  },
  server: {
    host: true,
    proxy: {
      "/api": "http://127.0.0.1:3000"
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"]
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxQUk9HRXNcXFxcY2hhdEJvdFxcXFxmcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcUFJPR0VzXFxcXGNoYXRCb3RcXFxcZnJvbnRlbmRcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L1BST0dFcy9jaGF0Qm90L2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZXN0L2NvbmZpZyc7XHJcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcclxuICBidWlsZDoge1xyXG4gICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICBvdXRwdXQ6IHtcclxuICAgICAgICBtYW51YWxDaHVua3MoaWQpIHtcclxuICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRJZCA9IGlkLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcclxuICAgICAgICAgIGlmIChub3JtYWxpemVkSWQuaW5jbHVkZXMoJy9ub2RlX21vZHVsZXMvcmVjaGFydHMvJykpIHtcclxuICAgICAgICAgICAgcmV0dXJuICdyZWNoYXJ0cy12ZW5kb3InO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKFxyXG4gICAgICAgICAgICBub3JtYWxpemVkSWQuaW5jbHVkZXMoJy9ub2RlX21vZHVsZXMvdmljdG9yeS12ZW5kb3IvJykgfHxcclxuICAgICAgICAgICAgbm9ybWFsaXplZElkLmluY2x1ZGVzKCcvbm9kZV9tb2R1bGVzL2QzLScpXHJcbiAgICAgICAgICApIHtcclxuICAgICAgICAgICAgcmV0dXJuICdjaGFydC1tYXRoLXZlbmRvcic7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAgc2VydmVyOiB7XHJcbiAgICBob3N0OiB0cnVlLFxyXG4gICAgcHJveHk6IHtcclxuICAgICAgJy9hcGknOiAnaHR0cDovLzEyNy4wLjAuMTozMDAwJyxcclxuICAgIH0sXHJcbiAgfSxcclxuICB0ZXN0OiB7XHJcbiAgICBlbnZpcm9ubWVudDogJ2pzZG9tJyxcclxuICAgIHNldHVwRmlsZXM6IFsnLi9zcmMvdGVzdC9zZXR1cC50cyddLFxyXG4gIH0sXHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXdRLFNBQVMsb0JBQW9CO0FBQ3JTLE9BQU8sV0FBVztBQUVsQixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsT0FBTztBQUFBLElBQ0wsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sYUFBYSxJQUFJO0FBQ2YsZ0JBQU0sZUFBZSxHQUFHLFFBQVEsT0FBTyxHQUFHO0FBQzFDLGNBQUksYUFBYSxTQUFTLHlCQUF5QixHQUFHO0FBQ3BELG1CQUFPO0FBQUEsVUFDVDtBQUNBLGNBQ0UsYUFBYSxTQUFTLCtCQUErQixLQUNyRCxhQUFhLFNBQVMsbUJBQW1CLEdBQ3pDO0FBQ0EsbUJBQU87QUFBQSxVQUNUO0FBQ0EsaUJBQU87QUFBQSxRQUNUO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsSUFDVjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE1BQU07QUFBQSxJQUNKLGFBQWE7QUFBQSxJQUNiLFlBQVksQ0FBQyxxQkFBcUI7QUFBQSxFQUNwQztBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
