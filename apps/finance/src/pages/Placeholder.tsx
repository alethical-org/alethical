/** A route whose screen waits for Design's final drawing. */
export function Placeholder({ title }: { title: string }) {
  return (
    <main id="main" className="page">
      <h1>{title}</h1>
      <p>This page is waiting for its final design.</p>
    </main>
  );
}
