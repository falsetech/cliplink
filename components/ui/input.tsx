import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

/**
 * A filled field rather than an outlined one. Text stays at 16px on phones so
 * iOS Safari does not zoom the page on focus.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-transparent bg-secondary px-3 py-1 text-base text-foreground transition-[background-color,border-color,box-shadow] duration-150 ease-out outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 pointer-coarse:h-11 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
