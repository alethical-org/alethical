import { createPortal } from 'react-dom';

import { SERVICES_PRINT_CSS, servicesPrintHtml } from '../lib/servicesPrint';

/** Outside the app's scrolling and modal containers; visible only on paper. */
export function ServicesPrint() {
  return createPortal(
    <>
      <style>{SERVICES_PRINT_CSS}</style>
      <div className="services-print" dangerouslySetInnerHTML={{ __html: servicesPrintHtml() }} />
    </>,
    document.body,
  );
}
