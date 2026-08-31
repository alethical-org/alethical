// react-dom does not bundle types for its server entry point, and this workspace
// does not install `@types/react-dom`. One test renders real components to compare
// the text served in the first response against the text the app draws
// (src/lib/__tests__/pageSnapshot.test.tsx, issue #1325), so it needs this one
// function and nothing else.
declare module 'react-dom/server' {
  import type { ReactNode } from 'react';
  export function renderToStaticMarkup(node: ReactNode): string;
}
