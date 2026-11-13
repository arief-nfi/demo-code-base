import { type ReactNode, Children, cloneElement, isValidElement } from 'react';
import { cn } from '../lib/utils';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, htmlFor, error, required, className, children }: FormFieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-foreground"
      >
        {label}
        {required && <span className="text-destructive ml-0.5" aria-hidden="true">*</span>}
      </label>
      {error && errorId
        ? Children.map(children, (child) => {
            if (isValidElement(child)) {
              return cloneElement(child as React.ReactElement<Record<string, unknown>>, {
                'aria-describedby': errorId,
                'aria-invalid': true,
              });
            }
            return child;
          })
        : children}
      {error && (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
