import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Speeckle — Fon Speech AI",
  description: "ASR · Général · TTS pipeline pour la langue Fon",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="font-body antialiased bg-night min-h-screen">
        {children}
      </body>
    </html>
  );
}
