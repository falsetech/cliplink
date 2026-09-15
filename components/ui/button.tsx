import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Capsule buttons in the Apple manner. Feedback lands on press, not release —
 * `active:scale` is instant — and the transition names its properties, since
 * the bare `transition-all` also spans `backdrop-filter` on blurred chrome.
 *
 * Disabled buttons keep their pointer events so a `title` can still explain
 * why they are disabled.
 *
 * Touch targets grow to 44px on coarse pointers and tighten under a mouse.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover disabled:hover:bg-primary",
        tinted:
          "bg-tint text-link hover:bg-tint-hover aria-expanded:bg-tint-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-foreground/12 aria-expanded:bg-foreground/12",
        outline:
          "border-border bg-card text-foreground hover:bg-muted aria-expanded:bg-muted",
        ghost:
          "text-foreground hover:bg-accent aria-expanded:bg-accent disabled:hover:bg-transparent",
        destructive:
          "bg-destructive/12 text-destructive hover:bg-destructive/18 focus-visible:ring-destructive/30 dark:bg-destructive/20 dark:hover:bg-destructive/28",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 pointer-coarse:h-11 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2.5 text-xs pointer-coarse:h-9 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 pointer-coarse:h-10 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-6 text-base font-semibold has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        icon: "size-9 pointer-coarse:size-11",
        "icon-xs": "size-7 pointer-coarse:size-9 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 pointer-coarse:size-10 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
