export function Footer() {
  return (
    <footer className="py-5 mt-auto border-t border-border bg-card backdrop-blur-sm">
      <div className="flex flex-col md:flex-row items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 text-sm text-muted-foreground">
        <p className="text-center md:text-left">
          &copy; {new Date().getFullYear()} SaaS Platform. All rights reserved.
        </p>
        <p className="text-center md:text-right font-mono opacity-70">
          v1.0.0
        </p>
      </div>
    </footer>
  );
}
