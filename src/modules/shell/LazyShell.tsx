import { Suspense, lazy, type ComponentProps } from 'react';

// The terminal (xterm) is loaded on first render rather than with the app, so its heavy
// dependencies stay out of the bundle every page load parses.
const ShellImpl = lazy(() => import('@/modules/shell/Shell'));

/** Used by standalone-shell and task-master's setup modal through this module's barrel: Shell, fetched when first shown. */
export default function LazyShell(props: ComponentProps<typeof ShellImpl>) {
  return (
    <Suspense fallback={null}>
      <ShellImpl {...props} />
    </Suspense>
  );
}
