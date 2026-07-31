import { zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { decodeAseprite, encodeAseprite } from './aseprite'
import { compositeDocument, createDocument, getActiveLayer, readLayerColor, writeLayerColor } from './document'

const encoder = new TextEncoder()

const putString = (name: string): Uint8Array => {
  const value = encoder.encode(name)
  const output = new Uint8Array(value.length + 2)
  new DataView(output.buffer).setUint16(0, value.length, true)
  output.set(value, 2)
  return output
}

const chunk = (type: number, payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(payload.length + 6)
  const view = new DataView(output.buffer)
  view.setUint32(0, output.length, true)
  view.setUint16(4, type, true)
  output.set(payload, 6)
  return output
}

const layerChunk = (name = 'Ink', layerType = 0, childLevel = 0): Uint8Array => {
  const encodedName = putString(name)
  const payload = new Uint8Array(16 + encodedName.length)
  const view = new DataView(payload.buffer)
  view.setUint16(0, 3, true)
  view.setUint16(2, layerType, true)
  view.setUint16(4, childLevel, true)
  view.setUint8(12, 255)
  payload.set(encodedName, 16)
  return chunk(0x2004, payload)
}

const celChunk = (pixels: Uint8Array, compressed = false, layerIndex = 0): Uint8Array => {
  const data = compressed ? zlibSync(pixels) : pixels
  const payload = new Uint8Array(20 + data.length)
  const view = new DataView(payload.buffer)
  view.setUint16(0, layerIndex, true)
  view.setUint8(6, 255)
  view.setUint16(7, compressed ? 2 : 0, true)
  view.setUint16(16, 2, true)
  view.setUint16(18, 1, true)
  payload.set(data, 20)
  return chunk(0x2005, payload)
}

const paletteChunk = (): Uint8Array => {
  const payload = new Uint8Array(32)
  const view = new DataView(payload.buffer)
  view.setUint32(0, 2, true)
  view.setUint32(8, 1, true)
  payload.set([0, 0, 0, 0], 22)
  payload.set([255, 64, 32, 255], 28)
  return chunk(0x2019, payload)
}

const aseprite = (chunks: Uint8Array[], colorDepth = 32): Uint8Array => {
  const frameSize = 16 + chunks.reduce((size, entry) => size + entry.length, 0)
  const output = new Uint8Array(128 + frameSize)
  const view = new DataView(output.buffer)
  view.setUint32(0, output.length, true)
  view.setUint16(4, 0xa5e0, true)
  view.setUint16(6, 1, true)
  view.setUint16(8, 2, true)
  view.setUint16(10, 1, true)
  view.setUint16(12, colorDepth, true)
  view.setUint8(28, 0)
  view.setUint32(128, frameSize, true)
  view.setUint16(132, 0xf1fa, true)
  view.setUint16(134, chunks.length, true)
  let offset = 144
  for (const entry of chunks) { output.set(entry, offset); offset += entry.length }
  return output
}

describe('Aseprite import', () => {
  it('exports a project that can be opened again as an Aseprite file', () => {
    const source = createDocument('exported', 3, 2, 'rgba')
    const layer = getActiveLayer(source)
    writeLayerColor(source, layer, 0, { r: 255, g: 64, b: 32, a: 255 })
    writeLayerColor(source, layer, 4, { r: 8, g: 16, b: 32, a: 128 })

    const decoded = decodeAseprite(encodeAseprite(source), 'round-trip')
    const decodedLayer = getActiveLayer(decoded)
    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(2)
    expect(readLayerColor(decoded, decodedLayer, 0)).toEqual({ r: 255, g: 64, b: 32, a: 255 })
    expect(readLayerColor(decoded, decodedLayer, 4)).toEqual({ r: 8, g: 16, b: 32, a: 128 })
  })

  it('imports raw RGBA cels', () => {
    const document = decodeAseprite(aseprite([layerChunk(), celChunk(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]))]), 'raw')
    const layer = getActiveLayer(document)
    expect(document.name).toBe('raw')
    expect(layer.name).toBe('Ink')
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(readLayerColor(document, layer, 1)).toEqual({ r: 0, g: 0, b: 255, a: 128 })
  })

  it('imports zlib-compressed RGBA cels', () => {
    const document = decodeAseprite(aseprite([layerChunk(), celChunk(new Uint8Array([8, 16, 32, 255, 255, 255, 0, 255]), true)]))
    const layer = getActiveLayer(document)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 8, g: 16, b: 32, a: 255 })
    expect(readLayerColor(document, layer, 1)).toEqual({ r: 255, g: 255, b: 0, a: 255 })
  })

  it('uses the transparent color index for indexed cels', () => {
    const document = decodeAseprite(aseprite([paletteChunk(), layerChunk(), celChunk(new Uint8Array([1, 0]))], 8))
    const layer = getActiveLayer(document)
    expect(readLayerColor(document, layer, 0)).toEqual({ r: 255, g: 64, b: 32, a: 255 })
    expect(readLayerColor(document, layer, 1)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('opens projects that include tilemap layers and imports their raster layers', () => {
    const document = decodeAseprite(aseprite([
      layerChunk('Tilemap', 2),
      layerChunk('Paint'),
      celChunk(new Uint8Array([255, 64, 32, 255, 0, 0, 0, 0]), false, 1)
    ]))
    expect(document.layers.map((layer) => layer.name)).toEqual(['Paint'])
    expect(readLayerColor(document, getActiveLayer(document), 0)).toEqual({ r: 255, g: 64, b: 32, a: 255 })
  })

  it('preserves nested group ownership', () => {
    const document = decodeAseprite(aseprite([
      layerChunk('Characters', 1, 0),
      layerChunk('Hero', 1, 1),
      layerChunk('Ink', 0, 2),
      celChunk(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), false, 2)
    ]))
    const characters = document.groups.find((group) => group.name === 'Characters')
    const hero = document.groups.find((group) => group.name === 'Hero')
    expect(characters).toBeDefined()
    expect(hero?.parentGroupId).toBe(characters?.id)
    expect(document.layers[0].groupId).toBe(hero?.id)
  })

  it('keeps Aseprite layers ordered from bottom to top', () => {
    const document = decodeAseprite(aseprite([
      layerChunk('Bottom'),
      layerChunk('Top'),
      celChunk(new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]), false, 0),
      celChunk(new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255]), false, 1)
    ]))
    expect(document.layers.map((layer) => layer.name)).toEqual(['Bottom', 'Top'])
    expect([...compositeDocument(document).subarray(0, 4)]).toEqual([0, 255, 0, 255])
  })

})
