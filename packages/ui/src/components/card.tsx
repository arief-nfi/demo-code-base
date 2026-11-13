'use client'

import * as React from "react"
import { cn } from "../lib/utils"
import { ChevronDown, ChevronUp } from "lucide-react"

// Context for sharing collapsed state across card components
interface CardContextValue {
  isCollapsed: boolean
  setIsCollapsed: (collapsed: boolean) => void
}

const CardContext = React.createContext<CardContextValue | undefined>(undefined)

const useCardContext = () => {
  const context = React.useContext(CardContext)
  return context
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "bordered" | "elevated" | "flat"
  accent?: "blue" | "emerald" | "violet" | "amber" | "rose" | "cyan" | "orange" | "primary"
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", accent, children, ...props }, ref) => {
    const [isCollapsed, setIsCollapsed] = React.useState(false)

    const variants = {
      default: "bg-card text-card-foreground border border-border shadow-sm",
      bordered: "bg-card text-card-foreground border-2 border-border",
      elevated: "bg-card text-card-foreground border border-border shadow-md",
      flat: "bg-card text-card-foreground",
    }

    const accents = {
      blue: "border-t-2 border-t-blue-500",
      emerald: "border-t-2 border-t-emerald-500",
      violet: "border-t-2 border-t-violet-500",
      amber: "border-t-2 border-t-amber-500",
      rose: "border-t-2 border-t-rose-500",
      cyan: "border-t-2 border-t-cyan-500",
      orange: "border-t-2 border-t-orange-500",
      primary: "border-t-2 border-t-primary",
    }

    return (
      <CardContext.Provider value={{ isCollapsed, setIsCollapsed }}>
        <div
          ref={ref}
          className={cn(
            "rounded-lg transition-all",
            variants[variant],
            accent && accents[accent],
            className
          )}
          {...props}
        >
          {children}
        </div>
      </CardContext.Provider>
    )
  }
)
Card.displayName = "Card"

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  collapsible?: boolean
  defaultCollapsed?: boolean
  onCollapseChange?: (collapsed: boolean) => void
  toolbar?: React.ReactNode
}

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ 
    className, 
    children, 
    collapsible = false,
    defaultCollapsed = false,
    onCollapseChange,
    toolbar,
    ...props 
  }, ref) => {
    const cardContext = useCardContext()
    const isCollapsed = cardContext?.isCollapsed ?? false

    React.useEffect(() => {
      if (collapsible && defaultCollapsed && cardContext) {
        cardContext.setIsCollapsed(defaultCollapsed)
      }
    }, [collapsible, defaultCollapsed, cardContext])

    const handleToggleCollapse = () => {
      if (!collapsible || !cardContext) return
      
      const newState = !isCollapsed
      cardContext.setIsCollapsed(newState)
      onCollapseChange?.(newState)
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-4 bg-card-header rounded-t-lg",
          !isCollapsed && "border-b border-border",
          collapsible && "cursor-pointer hover:bg-muted/50 transition-colors",
          className
        )}
        onClick={collapsible ? handleToggleCollapse : undefined}
        {...props}
      >
        <div className="flex-1 space-y-1 min-w-0">
          {children}
        </div>
        
        <div className="flex items-center gap-2 flex-shrink-0">
          {toolbar && (
            <div 
              className="flex items-center gap-2"
              onClick={(e) => collapsible && e.stopPropagation()}
            >
              {toolbar}
            </div>
          )}
          
          {collapsible && (
            <button
              type="button"
              className="p-1 rounded-md hover:bg-accent transition-colors"
              aria-label={isCollapsed ? "Expand" : "Collapse"}
            >
              {isCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
      </div>
    )
  }
)
CardHeader.displayName = "CardHeader"

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as: Component = "h2", ...props }, ref) => {
    return (
      <Component
        ref={ref}
        className={cn(
          "text-lg sm:text-xl font-semibold leading-tight tracking-tight text-foreground truncate",
          className
        )}
        {...props}
      />
    )
  }
)
CardTitle.displayName = "CardTitle"

export type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>

const CardDescription = React.forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn(
          "text-sm text-muted-foreground line-clamp-2 sm:line-clamp-none",
          className
        )}
        {...props}
      />
    )
  }
)
CardDescription.displayName = "CardDescription"

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean
}

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, padded = true, ...props }, ref) => {
    const cardContext = useCardContext()
    const isCollapsed = cardContext?.isCollapsed ?? false

    if (isCollapsed) {
      return null
    }

    return (
      <div
        ref={ref}
        className={cn(
          padded && "p-4 sm:p-6",
          className
        )}
        {...props}
      />
    )
  }
)
CardContent.displayName = "CardContent"

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end" | "between"
}

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, align = "end", ...props }, ref) => {
    const cardContext = useCardContext()
    const isCollapsed = cardContext?.isCollapsed ?? false

    if (isCollapsed) {
      return null
    }

    const alignments = {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-4 sm:p-4 border-t border-border",
          alignments[align],
          className
        )}
        {...props}
      />
    )
  }
)
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
