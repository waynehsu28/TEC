import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SnapshotDetails } from '../src/components/History';
import { calculateWeights } from '../src/lib/engine';
import { formatVolumeWeight } from '../src/lib/transport';
import { quoteSnapshot, uiSettings } from './fixtures/quotation';

describe('volume weight display precision', () => {
  it.each([
    ['15.422833333333333333', '15.42'], ['15.425', '15.43'], ['420', '420.00'],
    ['0', '0.00'], ['1234567.995', '1,234,568.00'], [null, '—'], [undefined, '—'],
  ])('formats %s to %s without changing other quantity precision', (value, expected) => {
    expect(formatVolumeWeight(value)).toBe(expected);
  });

  it('formats recurring decimals in saved history while preserving the snapshot values', () => {
    const weights = calculateWeights([{ pieces: 1, length: '61', width: '41', height: '37', grossWeight: '1', weightMode: 'GROUP_TOTAL' }], uiSettings);
    expect(weights.volumeWeight).toMatch(/^15\.422833333/);
    expect(weights.chargeableWeight).toBe('15.5');
    const snapshot = { ...quoteSnapshot(), weights };
    const before = JSON.stringify(snapshot);
    const html = renderToStaticMarkup(<SnapshotDetails snapshot={snapshot} />);
    expect(html).toMatch(/材積重 Volume Weight<\/span><strong>15\.42 /);
    expect(html).not.toContain(weights.volumeWeight!);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('keeps chargeable weight above a boundary even when its displayed volume weight rounds down', () => {
    const weights = calculateWeights([{ pieces: 1, length: '60', width: '60', height: '74.166667', grossWeight: '1', weightMode: 'GROUP_TOTAL' }], uiSettings);
    const unrounded = weights.volumeWeight;
    expect(formatVolumeWeight(unrounded)).toBe('44.50');
    expect(weights.chargeableWeight).toBe('45');
    expect(weights.volumeWeight).toBe(unrounded);
    expect(weights.volumeWeight).not.toBe('44.50');
  });
});
