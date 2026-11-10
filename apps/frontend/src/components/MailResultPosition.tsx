import { Component, createRef, type ReactNode } from 'react';

type Anchor = { element: HTMLElement; top: number; scrollOwner: Window | HTMLElement };
type Snapshot = { anchor: Anchor | null; focused: HTMLElement | null; headings: HTMLElement[] };

/** Keep a reader's place when completed results arrive or supersede old evidence. */
export class MailResultPosition extends Component<{ children: ReactNode }, object, Snapshot> {
  private container = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(): Snapshot {
    const focused =
      document.activeElement instanceof HTMLElement &&
      this.container.current?.contains(document.activeElement)
        ? document.activeElement
        : null;
    const headings = [
      focused?.closest('article')?.querySelector<HTMLElement>('h3'),
      focused?.closest('section')?.querySelector<HTMLElement>('h2'),
    ].filter((node): node is HTMLElement => !!node);
    const snapshot: Snapshot = { anchor: null, focused, headings };
    let scrollOwner: Window | HTMLElement = window;
    let ancestor = this.container.current?.parentElement;
    while (ancestor) {
      if (
        /(auto|scroll)/.test(getComputedStyle(ancestor).overflowY) &&
        ancestor.scrollHeight > ancestor.clientHeight
      ) {
        scrollOwner = ancestor;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if ((scrollOwner instanceof HTMLElement ? scrollOwner.scrollTop : window.scrollY) <= 0)
      return snapshot;
    const viewport =
      scrollOwner instanceof HTMLElement
        ? scrollOwner.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
    const nodes = [
      ...(this.container.current?.querySelectorAll<HTMLElement>('[data-mail-anchor]') ?? []),
    ];
    for (const element of focused ? [focused, ...nodes] : nodes) {
      const rect = element.getBoundingClientRect();
      if (rect.height && rect.bottom > viewport.top && rect.top < viewport.bottom) {
        snapshot.anchor = { element, top: rect.top, scrollOwner };
        break;
      }
    }
    return snapshot;
  }

  componentDidUpdate(_props: { children: ReactNode }, _state: object, snapshot: Snapshot) {
    const { anchor, focused, headings } = snapshot;
    if (anchor?.element.isConnected) {
      const delta = anchor.element.getBoundingClientRect().top - anchor.top;
      // Native scroll anchoring may already have corrected the shift.
      if (Math.abs(delta) > 1) anchor.scrollOwner.scrollBy({ top: delta, behavior: 'instant' });
    }
    if (focused && !focused.isConnected && document.activeElement === document.body) {
      const destination =
        headings.find((heading) => heading.isConnected) ??
        this.container.current?.querySelector<HTMLElement>('.session-recovery') ??
        this.container.current?.querySelector<HTMLElement>(
          'h2, [role="status"][tabindex], [role="alert"][tabindex], button',
        );
      destination?.focus({ preventScroll: true });
      if (destination) {
        const rect = destination.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight)
          destination.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }

  render() {
    return (
      <div className="mail-results" ref={this.container}>
        {this.props.children}
      </div>
    );
  }
}
