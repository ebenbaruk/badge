import type { Metadata } from "next";
import { JetBrains_Mono, Montserrat } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

// Variable fonts: every weight is available without listing them (500 body, 600 buttons).
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Badge", template: "%s · Badge" },
  description: "La mémoire confidentielle de l'entreprise AI-native : chaque partage signé sur le Ledger.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the `class` attribute before hydration: the mismatch warning is expected.
    <html
      lang="fr"
      className={cn("font-sans", montserrat.variable, jetbrainsMono.variable)}
      suppressHydrationWarning
    >
      <body className="min-h-svh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
