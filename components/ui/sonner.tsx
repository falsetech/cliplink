"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Notifications as a floating material: translucent, blurred, and deeper in
 * shadow than a row, so they read as above the page rather than on it. Colour
 * lives in the icon, not in the text, so the message stays legible over
 * whatever scrolls beneath. The materials fall back to solid under reduced
 * transparency through the tokens in globals.css.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4.5 text-success" />
        ),
        info: (
          <InfoIcon className="size-4.5 text-link" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4.5 text-warning" />
        ),
        error: (
          <OctagonXIcon className="size-4.5 text-destructive" />
        ),
        loading: (
          <Loader2Icon className="size-4.5 animate-spin text-muted-foreground" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--toast-bg)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "transparent",
          "--border-radius": "calc(var(--radius) * 1.8)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "cn-toast gap-2.5! px-4! py-3! text-sm! shadow-toast! backdrop-blur-(--toast-blur) backdrop-saturate-180 ring-1 ring-foreground/5",
          title: "font-medium!",
          description: "text-muted-foreground!",
          closeButton:
            "bg-popover! border-border! text-muted-foreground! hover:text-foreground!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
