import type { Metadata } from "next";
import { JetBrains_Mono, Syne, Geist } from "next/font/google";
import { ServiceWorker } from "@/components/cliplink/service-worker";

import { AppThemeProvider } from "./theme-provider";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


// Self-hosted and preloaded. Loading these through an `@import` in globals.css
// serialised the request behind the stylesheet and cost a round trip to two
// extra origins before any text could paint.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--font-syne",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://cliplink.thebkht.com"),
  title: "CLIPLINK",
  description: "Copy here. Paste anywhere. Fast cross-device clipboard sync.",
  openGraph: {
    title: "CLIPLINK",
    description: "Copy here. Paste anywhere. Fast cross-device clipboard sync.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "CLIPLINK",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CLIPLINK",
    description: "Copy here. Paste anywhere. Fast cross-device clipboard sync.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(jetbrainsMono.variable, syne.variable, "font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <AppThemeProvider>{children}</AppThemeProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
