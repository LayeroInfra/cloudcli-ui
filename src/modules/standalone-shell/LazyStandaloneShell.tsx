import { Suspense, lazy, type ComponentProps } from 'react';

// The standalone terminal (xterm) is loaded on first render rather than with the app, so its heavy
// dependencies stay out of the bundle every page load parses.
const StandaloneShellImpl = lazy(() => import('@/modules/standalone-shell/StandaloneShell'));

/** Used by project-workspace's TerminalDock and provider-auth's login modal through this module's barrel: StandaloneShell, fetched when first shown. */
export default function LazyStandaloneShell(props: ComponentProps<typeof StandaloneShellImpl>) {
  return (
    <Suspense fallback={null}>
      <StandaloneShellImpl {...props} />
    </Suspense>
  );
}
