import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-outfit", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "TasteProbe — does AI recommend you to your own audience?",
  description: "TasteProbe builds personas from a venue's real Qloo taste neighbourhood, asks live AI assistants for recommendations as each persona, and reports share of voice per taste segment with bootstrap confidence intervals. NVIDIA Nemotron on Nebius extracts every answer and writes the fix.",
  applicationName: "TasteProbe",
};

export const viewport: Viewport = { themeColor: "#2a0f2e", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${outfit.variable} ${mono.variable}`}><body>{children}</body></html>;
}
