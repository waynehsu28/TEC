import { describe, expect, it } from 'vitest';
import { validCompanyLogo } from '../src/lib/logo';

const transparentPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Logo validation before PDF embedding', () => {
  it('accepts an empty logo or a real valid PNG', () => {
    expect(validCompanyLogo('')).toBe(true);
    expect(validCompanyLogo(transparentPng)).toBe(true);
  });
  it('rejects base64-encoded text posing as an image and mismatched image MIME', () => {
    expect(validCompanyLogo(`data:image/png;base64,${Buffer.from('not an image').toString('base64')}`)).toBe(false);
    expect(validCompanyLogo(transparentPng.replace('image/png', 'image/jpeg'))).toBe(false);
    expect(validCompanyLogo('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
  });
  it('rejects truncated PNG or corrupt compressed image data', () => {
    const bytes = Buffer.from(transparentPng.split(',')[1], 'base64');
    expect(validCompanyLogo(`data:image/png;base64,${bytes.subarray(0, -4).toString('base64')}`)).toBe(false);
    bytes[45] ^= 1;
    expect(validCompanyLogo(`data:image/png;base64,${bytes.toString('base64')}`)).toBe(false);
  });
  it('rejects oversized logo and invalid JPEG frames', () => {
    expect(validCompanyLogo(`data:image/png;base64,${Buffer.alloc(1_048_577).toString('base64')}`)).toBe(false);
    expect(validCompanyLogo('data:image/jpeg;base64,/9j/2Q==')).toBe(false);
  });
});
