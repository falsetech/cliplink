"use client";

import { ThemeProvider } from "next-themes";

export function AppThemeProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={["dark", "light"]}
    >
      {children}
    </ThemeProvider>
  );
}
