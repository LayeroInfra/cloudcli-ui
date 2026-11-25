import { Suspense, lazy, type ComponentProps } from 'react';

// The code editor (CodeMirror) is loaded on first render rather than with the app, so its heavy
// dependencies stay out of the bundle every page load parses.
const EditorSidebarImpl = lazy(() => import('@/modules/code-editor/EditorSidebar'));

/** Used by project-workspace's WorkspaceMain through this module's barrel: EditorSidebar, fetched when first shown. */
export default function LazyEditorSidebar(props: ComponentProps<typeof EditorSidebarImpl>) {
  return (
    <Suspense fallback={null}>
      <EditorSidebarImpl {...props} />
    </Suspense>
  );
}
