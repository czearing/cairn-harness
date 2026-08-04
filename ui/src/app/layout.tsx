import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { layerVariables } from "@/lib/layers";
import { TypographyProvider } from "@/components/Typography/Typography";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Harness",
  description: "Projects, agents, and work in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body style={layerVariables}><TypographyProvider>{children}</TypographyProvider></body>
    </html>
  );
}
