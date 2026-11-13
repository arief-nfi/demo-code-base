'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-start pt-24 px-4 text-center sm:px-6 lg:px-8">
      <div className="rounded-full bg-destructive/10 p-4 mb-6">
        <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
      </div>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
        Something went wrong
      </h1>
      <p className="mt-4 text-base text-muted-foreground max-w-lg mx-auto">
        We apologize for the inconvenience. An unexpected error has occurred. 
        Our team has been notified and is working to fix the issue.
      </p>
      <div className="mt-8 flex gap-4">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
        >
          <RefreshCcw className="mr-2 h-5 w-5" />
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-5 py-3 text-base font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
        >
          <Home className="mr-2 h-5 w-5" />
          Go back home
        </Link>
      </div>
      {error.digest && (
        <p className="mt-8 text-xs text-muted-foreground">
          Error ID: {error.digest}
        </p>
      )}
    </div>
  );
}
