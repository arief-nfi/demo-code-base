import * as React from "react"
import { cn } from "../lib/utils"
import { Loader2 } from "lucide-react"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
  | "primary"
  | "secondary"
  | "accent"
  | "destructive"
  | "warning"
  | "success"
  | "info"
  | "muted"
  | "ghost"
  | "link"
  | "outline"
  size?: "default" | "sm" | "lg" | "icon"
  isLoading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", isLoading, children, disabled, ...props }, ref) => {

    const variants = {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-xs",
      accent: "bg-accent text-accent-foreground hover:bg-accent/80 shadow-xs",
      destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs",
      warning: "bg-warning text-warning-foreground hover:bg-warning/90 shadow-xs",
      success: "bg-success text-success-foreground hover:bg-success/90 shadow-xs",
      info: "bg-info text-info-foreground hover:bg-info/90 shadow-xs",
      muted: "bg-muted text-muted-foreground hover:bg-muted/80 shadow-xs",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      link: "text-primary underline-offset-4 hover:underline",
      outline: "border border-input bg-card hover:bg-accent hover:text-accent-foreground shadow-xs"
    }

    const sizes = {
      default: "h-9 px-4 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-10 rounded-md px-8",
      icon: "h-9 w-9",
    }

    return (
      <button
        className={cn(
          "cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
          variants[variant],
          sizes[size],
          className
        )}
        ref={ref}
        disabled={isLoading || disabled}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button }
