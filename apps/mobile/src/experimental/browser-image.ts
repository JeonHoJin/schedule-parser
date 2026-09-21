/**
 * 브라우저에서 이미지 파일을 RGBA로 디코딩한다.
 *
 * @sp/vision 은 { width, height, data: Uint8Array } 형태의 RGBA 를 받는다.
 * Node 에서는 tools/io.ts 의 readJpeg 가 이 역할을 하고, 브라우저에서는
 * createImageBitmap + <canvas>.getImageData 로 같은 형태를 만든다.
 *
 * iPhone/Android 사진은 회전을 EXIF 태그로만 표시하고 픽셀은 회전하지 않는 경우가 많다.
 * `imageOrientation: 'from-image'` 로 그 태그를 반영해 픽셀 자체를 회전시킨다.
 */
import type { Rgba } from '@sp/vision'

async function bitmapToRgba(bitmap: ImageBitmap): Promise<Rgba> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas 2d 컨텍스트를 얻지 못했습니다')
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: new Uint8Array(imageData.data.buffer.slice(0)),
    }
  } finally {
    bitmap.close()
  }
}

export async function fileToRgba(file: File): Promise<Rgba> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  return bitmapToRgba(bitmap)
}

/**
 * 사용자가 지정한 각도(0/90/180/270 CW)만큼 이미지를 회전한다.
 * 90/270 은 canvas 를 회전 후 다시 그려 새 Rgba 를 만든다.
 */
export function rotateRgba(src: Rgba, degCw: 0 | 90 | 180 | 270): Rgba {
  if (degCw === 0) return src
  const w = src.width, h = src.height
  const out = degCw === 180
    ? { width: w, height: h, data: new Uint8Array(w * h * 4) }
    : { width: h, height: w, data: new Uint8Array(w * h * 4) }
  const s = src.data
  const d = out.data
  const W = out.width
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4
      let dx: number, dy: number
      if (degCw === 90) { dx = h - 1 - y; dy = x }
      else if (degCw === 180) { dx = w - 1 - x; dy = h - 1 - y }
      else { dx = y; dy = w - 1 - x }
      const di = (dy * W + dx) * 4
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = 255
    }
  }
  return out
}

/** Rgba → data URL (미리보기용) */
export function rgbaToDataUrl(img: Rgba, maxWidth = 400): string {
  const scale = Math.min(1, maxWidth / img.width)
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const src = document.createElement('canvas')
  src.width = img.width
  src.height = img.height
  const sctx = src.getContext('2d')!
  const id = sctx.createImageData(img.width, img.height)
  id.data.set(img.data)
  sctx.putImageData(id, 0, 0)
  const dst = document.createElement('canvas')
  dst.width = w
  dst.height = h
  const dctx = dst.getContext('2d')!
  dctx.imageSmoothingEnabled = true
  dctx.drawImage(src, 0, 0, w, h)
  return dst.toDataURL('image/png')
}
