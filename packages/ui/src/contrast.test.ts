import { describe, expect, it } from 'vitest';
import { contrastRatio, tokensFrom } from './contrast';
// Bundler raw import (no fs: this is a pure library, see scripts/boundaries.rules.mjs).
import css from './styles.css?raw';

const light = tokensFrom(css, css.indexOf(':root {'));
const dark = { ...light, ...tokensFrom(css, css.indexOf(':root {', css.indexOf('prefers-color-scheme: dark'))) };

/** [foreground, background, minimum ratio, why]. Text 4.5:1; UI components and graphics 3:1. */
const PAIRS: [string, string, number, string][] = [
  ['text', 'surface', 4.5, 'body text'],
  ['text', 'surface-2', 4.5, 'text on alerts, active tabs'],
  ['text-2', 'surface', 4.5, 'secondary text'],
  ['text-2', 'surface-2', 4.5, 'secondary text on alerts'],
  ['link', 'surface', 4.5, 'links'],
  ['link', 'surface-2', 4.5, 'links on alerts'],
  ['good', 'surface', 4.5, 'status badge text'],
  ['warn', 'surface', 4.5, 'status badge text'],
  ['bad', 'surface', 4.5, 'status badge and error text'],
  ['info', 'surface-2', 3, 'alert icon'],
  ['control-border', 'surface', 3, 'input/button/tab boundaries (1.4.11)'],
  ['focus', 'surface', 3, 'focus indicator (2.4.13)'],
  ['series-1', 'surface', 3, 'chart line (graphics, 1.4.11)'],
  ['text-3', 'surface', 3, 'non-text marks (separators, crosshair)'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme meets WCAG 2.2 AA contrast', (_theme, t) => {
  it.each(PAIRS)('%s on %s ≥ %s (%s)', (fg, bg, min) => {
    expect(t[fg], `token --${fg}`).toBeDefined();
    expect(t[bg], `token --${bg}`).toBeDefined();
    expect(contrastRatio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min);
  });

  it('keeps decorative borders out of control boundaries (documents the 1.4.11 fix)', () => {
    expect(contrastRatio(t.border!, t.surface!)).toBeLessThan(3);
    expect(contrastRatio(t['control-border']!, t.surface!)).toBeGreaterThanOrEqual(3);
  });
});

describe('token source', () => {
  it('parses both themes from styles.css (an empty import would hide every check)', () => {
    expect(Object.keys(light).length).toBeGreaterThanOrEqual(15);
    expect(dark.surface).not.toBe(light.surface);
  });
});

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });
});
