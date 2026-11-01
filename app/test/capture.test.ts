import { describe, expect, it } from 'vitest';
import { describeDevice, deviceLine, exifDate, originalFacts, originalLine } from '../src/data/capture';
import { jpegTakenOn } from './exif-fixture';

const UA = {
  pixel: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  galaxyTab: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
};

describe('describeDevice', () => {
  it('names the kind, OS and browser from the user agent', () => {
    expect(describeDevice({ userAgent: UA.pixel, touchPoints: 5, standalone: true })).toEqual({ kind: 'phone', os: 'Android 15', browser: 'Chrome 141', installed: true });
    expect(describeDevice({ userAgent: UA.galaxyTab, touchPoints: 5, standalone: false })).toEqual({ kind: 'tablet', os: 'Android 14', browser: 'Samsung Internet 26', installed: false });
    expect(describeDevice({ userAgent: UA.iphone, touchPoints: 5, standalone: false })).toEqual({ kind: 'phone', os: 'iOS 18.1', browser: 'Safari 18.1', installed: false });
    expect(describeDevice({ userAgent: UA.edge, touchPoints: 0, standalone: false })).toEqual({ kind: 'desktop', os: 'Windows', browser: 'Edge 141', installed: false });
    expect(describeDevice({ userAgent: UA.firefoxLinux, touchPoints: 0, standalone: false })).toEqual({ kind: 'desktop', os: 'Linux', browser: 'Firefox 144', installed: false });
  });

  it('tells an iPad from a Mac by its touch screen', () => {
    expect(describeDevice({ userAgent: UA.ipad, touchPoints: 5, standalone: true })).toMatchObject({ kind: 'tablet', os: 'iPadOS' });
    expect(describeDevice({ userAgent: UA.ipad, touchPoints: 0, standalone: false })).toMatchObject({ kind: 'desktop', os: 'macOS', browser: 'Safari 18.1' });
  });
});

describe('exifDate', () => {
  const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

  it('reads DateTimeOriginal, in either byte order', () => {
    expect(exifDate(buf(jpegTakenOn('2026:10:27 18:04:11')))).toBe('2026-10-27');
    expect(exifDate(buf(jpegTakenOn('2025:02:03 07:00:00', { littleEndian: true })))).toBe('2025-02-03');
  });

  it('falls back to DateTime, and gives up on anything else', () => {
    expect(exifDate(buf(jpegTakenOn('', { dateTime: '2024:12:31 23:59:59' })))).toBe('2024-12-31');
    expect(exifDate(buf(jpegTakenOn('0000:00:00 00:00:00', { dateTime: '' })))).toBeUndefined();
    expect(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeUndefined();
    expect(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00]).buffer)).toBeUndefined();
    expect(exifDate(new ArrayBuffer(0))).toBeUndefined();
  });

  it('survives a truncated or lying EXIF block', () => {
    const bytes = jpegTakenOn('2026:10:27 18:04:11');
    expect(exifDate(buf(bytes.slice(0, 40)))).toBeUndefined();
    const lying = bytes.slice();
    new DataView(lying.buffer).setUint32(4 + 10 + 4, 0xffff0000);
    expect(() => exifDate(buf(lying))).not.toThrow();
  });
});

describe('originalFacts and the Warp Zone lines', () => {
  it('records the file as it came in', () => {
    expect(originalFacts(new File([new Uint8Array(2500)], 'IMG_1234.HEIC', { type: 'image/heic' }), { width: 4032, height: 3024 })).toEqual({
      name: 'IMG_1234.HEIC',
      type: 'image/heic',
      bytes: 2500,
      width: 4032,
      height: 3024,
    });
    expect(originalFacts(new Blob([new Uint8Array(3)]))).toEqual({ bytes: 3 });
  });

  it('describes the device and original in a line each', () => {
    expect(deviceLine({ device: 'Laptop', kind: 'phone', os: 'Android 15', browser: 'Chrome 141', installed: true, app: 'abc1234' })).toBe(
      'from Laptop · Android 15 phone · Chrome 141 · installed app · build abc1234',
    );
    expect(deviceLine({ kind: 'desktop', installed: false })).toBe('desktop');
    expect(originalLine({ name: 'IMG_1234.HEIC', bytes: 3_140_000, width: 4032, height: 3024 })).toBe('original · IMG_1234.HEIC · 4032×3024 · 3.1 MB');
    expect(originalLine({ bytes: 800 })).toBe('original · 1 KB');
  });
});
