import { describe, it, expect } from 'vitest';
import { extFromMime, sanitize } from './capcut';

describe('extFromMime', () => {
  it('maps common video/image MIME types to their extension', () => {
    expect(extFromMime('video/webm;codecs=vp9', 'mp4')).toBe('webm');
    expect(extFromMime('video/mp4', 'webm')).toBe('mp4');
    expect(extFromMime('video/quicktime', 'mp4')).toBe('mov');
    expect(extFromMime('image/png', 'jpg')).toBe('png');
    expect(extFromMime('image/jpeg', 'png')).toBe('jpg');
    expect(extFromMime('image/gif', 'png')).toBe('gif');
  });

  it('is case-insensitive', () => {
    expect(extFromMime('IMAGE/PNG', 'jpg')).toBe('png');
  });

  it('falls back when the MIME type is unrecognized or empty', () => {
    expect(extFromMime('application/octet-stream', 'mp4')).toBe('mp4');
    expect(extFromMime('', 'png')).toBe('png');
  });
});

describe('sanitize', () => {
  it('replaces disallowed characters with a single hyphen', () => {
    expect(sanitize('Lollys Product / Shoot!!')).toBe('Lollys-Product-Shoot');
  });

  it('preserves word characters, dots, and hyphens', () => {
    expect(sanitize('my-file_v2.final')).toBe('my-file_v2.final');
  });

  it('trims leading/trailing hyphens produced by sanitizing', () => {
    expect(sanitize('  !!weird name!!  ')).toBe('weird-name');
  });

  it('falls back to a default name when nothing usable remains', () => {
    expect(sanitize('!!!')).toBe('lollys-asset');
    expect(sanitize('')).toBe('lollys-asset');
  });
});
