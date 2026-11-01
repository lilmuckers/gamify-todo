/**
 * A minimal JPEG whose EXIF says it was taken at `original` ("YYYY:MM:DD HH:MM:SS"): SOI, an
 * APP1 Exif segment (big- or little-endian TIFF, IFD0 with DateTime and a pointer to an Exif
 * IFD holding DateTimeOriginal), then EOI. Enough for exifDate; not a viewable image.
 */
export function jpegTakenOn(original: string, opts: { littleEndian?: boolean; dateTime?: string } = {}): Uint8Array<ArrayBuffer> {
  const le = !!opts.littleEndian;
  const dateTime = opts.dateTime ?? '2000:01:01 00:00:00';
  const tiff = new DataView(new ArrayBuffer(100));
  const u16 = (o: number, v: number) => tiff.setUint16(o, v, le);
  const u32 = (o: number, v: number) => tiff.setUint32(o, v, le);
  const ascii = (o: number, s: string) => [...`${s}\0`].forEach((c, i) => tiff.setUint8(o + i, c.charCodeAt(0)));
  tiff.setUint16(0, le ? 0x4949 : 0x4d4d);
  u16(2, 42);
  u32(4, 8);
  // IFD0 at 8: two entries (DateTime, ExifIFD pointer), then next-IFD 0.
  u16(8, 2);
  u16(10, 0x0132), u16(12, 2), u32(14, 20), u32(18, 50);
  u16(22, 0x8769), u16(24, 4), u32(26, 1), u32(30, 36);
  u32(34, 0);
  // Exif IFD at 36: one entry (DateTimeOriginal).
  u16(36, 1);
  u16(38, 0x9003), u16(40, 2), u32(42, 20), u32(46, 72);
  ascii(50, dateTime);
  ascii(72, original);
  const body = new Uint8Array(tiff.buffer);
  const app1 = new Uint8Array(4 + 6 + body.length);
  const v = new DataView(app1.buffer);
  v.setUint16(0, 0xffe1);
  v.setUint16(2, 2 + 6 + body.length);
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  app1.set(body, 10);
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]);
}
