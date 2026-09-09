import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import type { Rgba } from '@sp/vision'

export function readJpeg(path: string): Rgba {
  const raw = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true })
  return { width: raw.width, height: raw.height, data: new Uint8Array(raw.data) }
}

export function writePng(path: string, img: Rgba): void {
  mkdirSync(dirname(path), { recursive: true })
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data)
  writeFileSync(path, PNG.sync.write(png))
}

export function grayToRgba(g: { width: number; height: number; data: Uint8Array }): Rgba {
  const d = new Uint8Array(g.width * g.height * 4)
  for (let i = 0, p = 0; i < g.data.length; i++, p += 4) {
    d[p] = d[p + 1] = d[p + 2] = g.data[i]
    d[p + 3] = 255
  }
  return { width: g.width, height: g.height, data: d }
}

export function drawRect(
  img: Rgba, x: number, y: number, w: number, h: number,
  color: [number, number, number], thickness = 1,
): void {
  const put = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return
    const o = (py * img.width + px) * 4
    img.data[o] = color[0]; img.data[o + 1] = color[1]; img.data[o + 2] = color[2]; img.data[o + 3] = 255
  }
  for (let t = 0; t < thickness; t++) {
    for (let i = 0; i < w; i++) { put(x + i, y + t); put(x + i, y + h - 1 - t) }
    for (let i = 0; i < h; i++) { put(x + t, y + i); put(x + w - 1 - t, y + i) }
  }
}

export const hsv = (h: number, s: number, v: number): [number, number, number] => {
  const i = Math.floor(h * 6), f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6]
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}
