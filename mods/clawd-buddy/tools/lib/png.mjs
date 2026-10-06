// Minimaler PNG-Schreiber (RGBA, 8 Bit) nur mit Node-Bordmitteln, dazu eine kleine Zeichenfläche und 3×5-Ziffern.
import { deflateSync } from 'node:zlib'

const table = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export class Canvas {
  constructor(w, h, bg = [20, 20, 20]) {
    this.w = w
    this.h = h
    this.px = Buffer.alloc(w * h * 4)
    this.rect(0, 0, w, h, bg)
  }
  rect(x, y, w, h, [r, g, b]) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) {
        const o = (j * this.w + i) * 4
        this.px[o] = r
        this.px[o + 1] = g
        this.px[o + 2] = b
        this.px[o + 3] = 255
      }
    }
  }
  png() {
    return encodePng(this.w, this.h, this.px)
  }
}

export const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]

// 3×5-Ziffern für Beschriftungen (Zeile für Zeile, 1 = gesetzt)
const GLYPH = {
  0: '111101101101111',
  1: '010110010010111',
  2: '111001111100111',
  3: '111001111001111',
  4: '101101111001001',
  5: '111100111001111',
  6: '111100111101111',
  7: '111001001001001',
  8: '111101111101111',
  9: '111101111001111',
  x: '101101010101101',
  '/': '001001010100100',
  '+': '000010111010000',
  '-': '000000111000000',
}

export function text(cv, x, y, s, scale, color) {
  let cx = x
  for (const ch of String(s)) {
    const g = GLYPH[ch]
    if (g) {
      for (let i = 0; i < 15; i++) {
        if (g[i] === '1') cv.rect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, color)
      }
    }
    cx += 4 * scale
  }
  return cx
}
