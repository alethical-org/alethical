import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { homePageSnapshot, renderPageSnapshot } from '../pageSnapshot';
import { servicesPageSnapshot } from '../servicesPageSnapshot';

const shell = readFileSync(new URL('../../../public/index.html', import.meta.url), 'utf8');
const style = shell.match(/<style id="alethical-page-snapshot">([\s\S]*?)<\/style>/)?.[1];

describe('services before the interactive app starts', () => {
  it('keeps the approved dark content, readable text and light shared header', () => {
    const dom = new JSDOM(`<style>${style}</style>${renderPageSnapshot(servicesPageSnapshot())}`);
    const color = (selector: string, property: 'color' | 'backgroundColor') =>
      dom.window.getComputedStyle(dom.window.document.querySelector(selector)!)[property];
    expect(color('.page-snapshot', 'backgroundColor')).toBe('rgb(10, 10, 10)');
    expect(color('.page-snapshot', 'color')).toBe('rgb(236, 236, 236)');
    expect(color('header', 'backgroundColor')).toBe('rgb(247, 248, 250)');
    expect(color('h2', 'color')).toBe('rgb(236, 236, 236)');
    expect(color('.ps-prose', 'color')).toBe('rgb(179, 179, 179)');
    expect(color('.ps-card', 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
    expect(dom.window.document.querySelector('a[href^="mailto:"]')?.getAttribute('href')).toBe(
      'mailto:angel@alethical.com?cc=ask@alethical.com',
    );
    dom.window.close();
  });

  it('leaves the ordinary homepage first response on its existing light background', () => {
    const dom = new JSDOM(`<style>${style}</style>${renderPageSnapshot(homePageSnapshot())}`);
    expect(
      dom.window.getComputedStyle(dom.window.document.querySelector('.page-snapshot')!)
        .backgroundColor,
    ).toBe('rgb(255, 255, 255)');
    dom.window.close();
  });
});
