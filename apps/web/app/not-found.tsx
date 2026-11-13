'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileQuestion, Home, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="flex h-full flex-col items-center justify-start pt-24 px-4 text-center sm:px-6 lg:px-8">
      <div className="rounded-full bg-primary/10 p-4 mb-6">
        <FileQuestion className="h-12 w-12 text-primary" aria-hidden="true" />
      </div>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
        Page not found
      </h1>
      <p className="mt-4 text-base text-muted-foreground max-w-lg mx-auto">
        Sorry, we couldn&apos;t find the page you&apos;re looking for. It might have been moved, deleted, or never existed.
      </p>
      <div className="mt-8 flex gap-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-5 py-3 text-base font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
        >
          <ArrowLeft className="mr-2 h-5 w-5" />
          Go back
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
        >
          <Home className="mr-2 h-5 w-5" />
          Go home
        </Link>
      </div>
    </div>
  );
}
