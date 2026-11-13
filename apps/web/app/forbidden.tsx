import Link from 'next/link';
import { ShieldAlert, Home } from 'lucide-react';

export default function Forbidden() {
  return (
    <div className="flex h-full flex-col items-center justify-start pt-24 px-4 text-center sm:px-6 lg:px-8">
      <div className="rounded-full bg-destructive/10 p-4 mb-6">
        <ShieldAlert className="h-12 w-12 text-destructive" aria-hidden="true" />
      </div>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
        Access Denied
      </h1>
      <p className="mt-4 text-base text-muted-foreground max-w-lg mx-auto">
        You do not have permission to access this resource. Please contact your administrator if you believe this is a mistake.
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
        >
          <Home className="mr-2 h-5 w-5" />
          Go back home
        </Link>
      </div>
    </div>
  );
}
