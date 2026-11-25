import { Suspense, lazy, type ComponentProps } from 'react';

// The PRD editor (CodeMirror) is loaded on first render rather than with the app, so its heavy
// dependencies stay out of the bundle every page load parses.
const PRDEditorImpl = lazy(() => import('@/modules/prd-editor/PRDEditor'));

/** Used by task-master's TaskMasterPanel through this module's barrel: PRDEditor, fetched when first shown. */
export default function LazyPRDEditor(props: ComponentProps<typeof PRDEditorImpl>) {
  return (
    <Suspense fallback={null}>
      <PRDEditorImpl {...props} />
    </Suspense>
  );
}
