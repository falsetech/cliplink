import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "@/components/cliplink/service-worker";
import { Analytics } from "@vercel/analytics/next";

import { AppThemeProvider } from "./theme-provider";
import "./globals.css";

// No web fonts. The system stack is SF on Apple platforms, which already ships
// optical sizing and tracking tables, and costs nothing to load.

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <AppThemeProvider>{children}</AppThemeProvider>
        <ServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
