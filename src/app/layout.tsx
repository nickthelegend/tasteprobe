import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TasteProbe — AI visibility, by audience",
  description: "Measure how AI assistants recommend your business to real taste segments.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
