import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="no-print border-b border-edge">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-strong font-mono text-sm text-background">
            EG
          </span>
          EntitleGuard
          <span className="rounded-full border border-edge px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
            Audit
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/audit?demo=1" className="text-muted hover:text-foreground">
            Example report
          </Link>
          <Link
            href="/audit"
            className="rounded-lg bg-accent-strong px-3.5 py-1.5 font-semibold text-background hover:opacity-90"
          >
            Run free local audit
          </Link>
        </nav>
      </div>
    </header>
  );
}
