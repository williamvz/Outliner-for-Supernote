import {computeLayout, writingSlot} from '../layout';

describe('computeLayout', () => {
  it('lays out fourteen task rows with a done box and a not-today box on a Nomad page', () => {
    const l = computeLayout(1404, 1872);
    expect(l.rows).toHaveLength(14);
    expect(l.rows[0].band.top).toBe(196);
    expect(l.rows[13].band.bottom).toBe(l.taskZone.bottom);
    expect(l.taskZone.bottom).toBeLessThan(l.footerBaseline);
    expect(l.footerBaseline).toBeLessThanOrEqual(1872);
    for (const r of l.rows) {
      expect(r.checkbox.top).toBeGreaterThanOrEqual(r.band.top);
      expect(r.checkbox.bottom).toBeLessThanOrEqual(r.band.bottom);
      expect(r.checkbox.right).toBeLessThan(r.text.left);
      expect(r.text.right).toBeLessThan(r.meta.left);
      expect(r.meta.right).toBeLessThan(r.skip.left);
    }
  });

  it('keeps the SYNC box in the header, clear of the title', () => {
    const l = computeLayout();
    expect(l.syncBox.bottom).toBeLessThanOrEqual(l.header.bottom);
    expect(l.syncBox.right).toBeLessThanOrEqual(l.marginRight);
    expect(l.syncBox.left).toBeGreaterThan(l.width / 2);
  });

  it('lays out the Notes page as ruled lines only', () => {
    const l = computeLayout(1404, 1872, 'notes');
    expect(l.rows).toHaveLength(0);
    expect(l.writingZone.top).toBeGreaterThan(l.header.bottom);
    expect(l.writingZone.bottom).toBeLessThanOrEqual(1872);
    expect(l.lineCount).toBe(17);
  });

  it('scales to a larger page', () => {
    const l = computeLayout(1920, 2560);
    expect(l.rows[0].band.top).toBeCloseTo((196 * 2560) / 1872);
    expect(l.marginLeft).toBeCloseTo((96 * 1920) / 1404);
  });

  it('numbers ruled-line slots from the top of the writing zone', () => {
    const l = computeLayout(undefined, undefined, 'notes');
    expect(writingSlot(l, 0).top).toBe(l.writingZone.top);
    expect(writingSlot(l, 1).top).toBe(l.writingZone.top + l.lineSpacing);
  });
});
