/**
 * JPEG 의 EXIF `DateTimeOriginal` 태그를 읽어 촬영 년/월을 돌려준다.
 *
 * 라이브러리 없이 최소 구현. 앞 256KB 만 읽어 APP1 세그먼트에서 IFD0 →
 * ExifIFD → 태그 0x9003 (DateTimeOriginal) 을 찾는다. 값 형식은 "YYYY:MM:DD HH:MM:SS".
 *
 * 촬영 시점이 근무표 월과 다를 수도 있으므로 어디까지나 초기값 힌트.
 * 사용자가 UI 에서 조정할 수 있어야 한다.
 */

export interface ExifDate {
  year: number
  month: number
  day: number
}

export async function readExifDate(file: File): Promise<ExifDate | null> {
  const buf = await file.slice(0, 256 * 1024).arrayBuffer()
  const view = new DataView(buf)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null

  let offset = 2
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset)
    if ((marker & 0xFF00) !== 0xFF00) return null
    const size = view.getUint16(offset + 2)
    if (marker === 0xFFE1) return parseApp1(view, offset + 4, size - 2)
    offset += 2 + size
  }
  return null
}

function parseApp1(view: DataView, start: number, len: number): ExifDate | null {
  if (len < 14) return null
  // "Exif\0\0"
  if (view.getUint32(start) !== 0x45786966) return null
  const tiff = start + 6
  const bomBE = view.getUint16(tiff) === 0x4D4D
  const bomLE = view.getUint16(tiff) === 0x4949
  if (!bomBE && !bomLE) return null
  const little = bomLE
  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)

  if (u16(tiff + 2) !== 0x002A) return null
  const ifd0 = tiff + u32(tiff + 4)
  const exifIfd = findExifIfd(view, tiff, ifd0, u16, u32)
  if (!exifIfd) return null

  const dt = findDateTimeOriginal(view, tiff, exifIfd, u16, u32)
  return dt ? parseDateTime(dt) : null
}

function findExifIfd(
  view: DataView, tiff: number, ifd0: number,
  u16: (o: number) => number, u32: (o: number) => number,
): number | null {
  const n = u16(ifd0)
  for (let i = 0; i < n; i++) {
    const entry = ifd0 + 2 + i * 12
    if (u16(entry) === 0x8769) return tiff + u32(entry + 8)
  }
  return null
}

function findDateTimeOriginal(
  view: DataView, tiff: number, ifd: number,
  u16: (o: number) => number, u32: (o: number) => number,
): string | null {
  const n = u16(ifd)
  for (let i = 0; i < n; i++) {
    const entry = ifd + 2 + i * 12
    if (u16(entry) !== 0x9003) continue
    const count = u32(entry + 4)
    if (count < 10 || count > 20) return null
    const valOff = count <= 4 ? entry + 8 : tiff + u32(entry + 8)
    let s = ''
    for (let j = 0; j < count - 1; j++) s += String.fromCharCode(view.getUint8(valOff + j))
    return s
  }
  return null
}

function parseDateTime(s: string): ExifDate | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  return { year: +m[1], month: +m[2], day: +m[3] }
}
