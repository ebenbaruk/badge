"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Client-side providers shared by every page: theme, tooltips and toasts. The site opens in light mode for every
 * visitor (the stage projector and the recordings are light); the toggle switches to dark on request.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster position="bottom-left" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}
