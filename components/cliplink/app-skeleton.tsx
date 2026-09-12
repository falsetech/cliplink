/**
 * Static first paint for the Suspense boundary around the client app. It mirrors
 * the real header and hero so the page has structure before hydration rather
 * than flashing an empty document.
 */
export function AppSkeleton() {
  return (
    <div className="flex min-h-screen flex-col" aria-hidden="true">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line px-3.5 py-3 sm:px-5 sm:py-3.5 md:px-8 md:py-4.5">
        <div className="font-display text-xl font-extrabold tracking-display md:text-2xl">
          CLIP
          <span className="text-logo">LINK</span>
        </div>
        <div className="h-11 w-11 rounded-full border border-line-strong md:h-9 md:w-9" />
      </header>
      <main className="flex flex-1 justify-center px-3 py-5.5 pb-12 sm:px-4 sm:py-7 sm:pb-14 md:px-6 md:py-14 md:pb-18">
        <div className="w-full max-w-190">
          <div className="mx-auto flex max-w-180 flex-col items-center gap-5 sm:gap-6 md:gap-9">
            <h1 className="font-display mb-4 text-center text-[clamp(1.7rem,15vw,2.45rem)] leading-[0.98] tracking-display text-balance text-fg sm:text-[clamp(2rem,11vw,3rem)] md:text-[clamp(4.8rem,7.1vw,6.35rem)] md:leading-[0.82]">
              <span className="block">Copy here.</span>
              <span className="block text-hero">
                Paste anywhere.
              </span>
            </h1>
          </div>
        </div>
      </main>
    </div>
  );
}
