import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "Badge", template: "%s · Badge" },
  description: "La mémoire confidentielle de l'entreprise AI-native : chaque partage signé sur le Ledger.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the `class` attribute before hydration: the mismatch warning is expected.
    <html lang="fr" className={cn("font-sans", geist.variable, geistMono.variable)} suppressHydrationWarning>
      <body className="min-h-svh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
