"use client";

import { ThemeProvider } from "next-themes";

export function AppThemeProvider({
  children,
  nonce,
}: Readonly<{
  children: React.ReactNode;
  /** Lets the inline script that sets the theme before paint past the CSP. */
  nonce?: string;
}>) {
  return (
    <ThemeProvider
      attribute="data-theme"
      nonce={nonce}
      defaultTheme="system"
      enableSystem
      themes={["dark", "light"]}
    >
      {children}
    </ThemeProvider>
  );
}
