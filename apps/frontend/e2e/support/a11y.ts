import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** WCAG 2.0 and 2.1, levels A and AA. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Scans what the page shows right now, and fails on any serious or critical violation.
 *
 * Called on every page and dialog a test visits, so accessibility is checked wherever the suite
 * already goes rather than by a separate crawl. Minor and moderate findings are left out — they are
 * real, but a gate that fails on them is one nobody keeps on.
 */
export async function expectAccessible(page: Page, where: string): Promise<void> {
  await test.step(`axe: ${where}`, async () => {
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

    const report = blocking
      .map(
        (v) =>
          `${v.id} (${v.impact}): ${v.help}\n` +
          v.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n'),
      )
      .join('\n');

    expect(blocking.length, `accessibility violations on ${where}:\n${report}`).toBe(0);
  });
}
