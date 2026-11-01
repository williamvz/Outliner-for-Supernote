import {computeLayout, writingSlot} from '../layout';

describe('computeLayout', () => {
  it('lays out six task rows above the writing zone on a Nomad page', () => {
    const l = computeLayout(1404, 1872);
    expect(l.rows).toHaveLength(6);
    expect(l.rows[0].band.top).toBe(196);
    expect(l.rows[5].band.bottom).toBe(l.taskZone.bottom);
    expect(l.taskZone.bottom).toBeLessThan(l.writingZone.top);
    expect(l.writingZone.bottom).toBeLessThanOrEqual(1872);
    for (const r of l.rows) {
      expect(r.checkbox.top).toBeGreaterThanOrEqual(r.band.top);
      expect(r.checkbox.bottom).toBeLessThanOrEqual(r.band.bottom);
      expect(r.checkbox.right).toBeLessThan(r.text.left);
      expect(r.meta.right).toBeLessThan(r.skip.left);
      expect(r.text.right).toBeLessThan(r.meta.left);
    }
  });

  it('scales to a larger page', () => {
    const l = computeLayout(1920, 2560);
    expect(l.rows[0].band.top).toBeCloseTo((196 * 2560) / 1872);
    expect(l.marginLeft).toBeCloseTo((96 * 1920) / 1404);
  });

  it('numbers ruled-line slots from the top of the writing zone', () => {
    const l = computeLayout();
    expect(writingSlot(l, 0).top).toBe(l.writingZone.top);
    expect(writingSlot(l, 1).top).toBe(l.writingZone.top + l.lineSpacing);
  });
});
