import type { RgbaColor } from '@shared/types'

export interface BuiltInPalette {
  id: string
  name: string
  colors: RgbaColor[]
}

const opaque = (hex: string): RgbaColor => {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return { r: value >>> 16, g: (value >>> 8) & 0xff, b: value & 0xff, a: 255 }
}

const colors = (...values: string[]): RgbaColor[] => values.map(opaque)

export const builtInPalettes: BuiltInPalette[] = [
  {
    id: 'moonlight-12',
    name: '月光 12',
    colors: colors('#101014', '#24232B', '#44404D', '#655561', '#8D7A8B', '#C2B6C0', '#F1EDF1', '#173A65', '#2979FF', '#55B6E8', '#8DE4D0', '#F7D46A')
  },
  {
    id: 'tiny-console-16',
    name: '微型主机 16',
    colors: colors('#16171D', '#2E3039', '#555867', '#8A8E9C', '#D8D9DE', '#F7F4EA', '#712F45', '#C44554', '#ED7B5F', '#F4C06A', '#436B45', '#69A14C', '#A5D76E', '#274A70', '#3D79B8', '#73C4D8')
  },
  {
    id: 'forest-dusk-12',
    name: '林间暮色 12',
    colors: colors('#141A1A', '#27332B', '#3E5540', '#607A4E', '#8BA35D', '#C0CA78', '#E9D99A', '#553F43', '#815054', '#B86A5B', '#D89467', '#F0C985')
  },
  {
    id: 'sunset-12',
    name: '落日余晖 12',
    colors: colors('#211629', '#43213B', '#712B48', '#A93B4F', '#D95B59', '#F48263', '#F7B267', '#FFE29A', '#324267', '#426A8C', '#58A0A3', '#86D1B2')
  },
  {
    id: 'mono-10',
    name: '像素灰阶 10',
    colors: colors('#0B0C0F', '#1B1D22', '#30333A', '#484C55', '#626771', '#7F848D', '#9EA2A9', '#BEC1C6', '#DEDFE2', '#F7F7F7')
  }
]
