import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { RepositoryProvider } from "@/components/providers/RepositoryProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { AuthBar } from "@/components/AuthBar";

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Flashy",
  description: "Local-first flashcard study app with spaced repetition",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${hankenGrotesk.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface-0 text-ink-1 font-sans">
        <AuthProvider>
          <RepositoryProvider>
            <AuthBar />
            {children}
          </RepositoryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
