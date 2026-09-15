import { Wordmark } from "./wordmark";

/**
 * Static first paint for the Suspense boundary around the client app. It mirrors
 * the real header and hero so the page has structure before hydration rather
 * than flashing an empty document.
 */
export function AppSkeleton() {
  return (
    <div className="flex min-h-screen flex-col" aria-hidden="true">
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 sm:px-5 md:px-8 md:py-4">
        <Wordmark />
        <div className="size-11 rounded-full bg-secondary md:size-9" />
      </header>
      <main className="flex flex-1 justify-center px-4 py-8 pb-12 md:px-6 md:py-16 md:pb-18">
        <div className="w-full max-w-3xl">
          <div className="mx-auto flex max-w-lg flex-col items-center">
            <h1 className="mb-3 text-center text-5xl leading-[1.05] font-bold tracking-display text-balance text-foreground md:text-7xl">
              Copy here.
              <span className="block text-link">Paste anywhere.</span>
            </h1>
          </div>
        </div>
      </main>
    </div>
  );
}
