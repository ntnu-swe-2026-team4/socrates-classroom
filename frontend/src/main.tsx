import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "@/app/theme";
import { router } from "./router";
import "./index.css";
import { AudioProvider } from './lib/AudioContext';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* 🌟 用 AudioProvider 把路由套件包起來 */}
        <AudioProvider>
          <RouterProvider router={router} context={{ queryClient }} />
        </AudioProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
