import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "../lib/utils"

export interface CheckboxProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  indeterminate?: boolean
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, checked, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null)
    const [internalChecked, setInternalChecked] = React.useState(props.defaultChecked || false)

    React.useImperativeHandle(ref, () => inputRef.current!)

    React.useEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = indeterminate || false
      }
    }, [indeterminate])

    // Determine if this is controlled or uncontrolled
    const isControlled = checked !== undefined
    const isChecked = isControlled ? checked : internalChecked

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) {
        setInternalChecked(e.target.checked)
      }
      props.onChange?.(e)
    }

    return (
      <div className="relative flex items-center justify-center w-4 h-4">
        <input
          type="checkbox"
          className="peer absolute h-4 w-4 cursor-pointer opacity-0 z-10"
          ref={inputRef}
          checked={isControlled ? checked : undefined}
          {...props}
          onChange={handleChange}
        />
        <div
          className={cn(
            "h-4 w-4 rounded border border-input bg-background dark:bg-card ring-offset-background transition-all duration-75",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
            "peer-checked:bg-primary peer-checked:border-primary peer-checked:text-primary-foreground",
            "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
            "flex items-center justify-center",
            className
          )}
        >
          {isChecked && (
            <Check className="h-3 w-3 stroke-[3]" />
          )}
          {indeterminate && !isChecked && (
            <div className="h-0.5 w-2 bg-primary rounded-full" />
          )}
        </div>
      </div>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
