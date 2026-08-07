import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary, AppFailureView } from '../AppErrorBoundary';

const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

const here = dirname(fileURLToPath(import.meta.url));

describe('AppErrorBoundary', () => {
  it('turns an unexpected child render failure into its fallback state', () => {
    expect(AppErrorBoundary.getDerivedStateFromError(new Error('broken page'))).toEqual({
      hasError: true,
    });
  });

  it('shows a plain recovery screen with a reload action', () => {
    const markup = renderToStaticMarkup(<AppFailureView onReload={vi.fn()} />);

    expect(markup).toContain('This page hit a problem');
    expect(markup).toContain('Reload page');
  });

  it('wraps every provider and page, not just 1 route', () => {
    const appSource = readFileSync(resolve(here, '../../../App.tsx'), 'utf8');
    const boundaryStart = appSource.indexOf('<AppErrorBoundary>');
    const providersStart = appSource.indexOf('<AppProviders>');
    const providersEnd = appSource.indexOf('</AppProviders>');
    const boundaryEnd = appSource.indexOf('</AppErrorBoundary>');

    expect(boundaryStart).toBeGreaterThan(-1);
    expect(boundaryStart).toBeLessThan(providersStart);
    expect(boundaryEnd).toBeGreaterThan(providersEnd);
  });
});
