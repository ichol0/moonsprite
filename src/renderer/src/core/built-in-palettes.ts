import type { RgbaColor } from '@shared/types'
import type { TranslationKey } from './localization'

export interface BuiltInPalette {
  id: string
  name: string
  colors: RgbaColor[]
  columns: number
  slots: Array<number | null>
}

const opaque = (hex: string): RgbaColor => {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return { r: value >>> 16, g: (value >>> 8) & 0xff, b: value & 0xff, a: 255 }
}

const colors = (...values: string[]): RgbaColor[] => values.map(opaque)

const shadeColumns = (familyCount: number, shadesPerFamily: number): Array<number | null> => {
  const slots: Array<number | null> = []
  for (let shade = 0; shade < shadesPerFamily; shade++) {
    slots.push(shade, null)
    for (let family = 1; family < familyCount; family++) slots.push(family * shadesPerFamily + shade)
  }
  return slots
}

const SPECTRUM_COLUMNS = 13
const SPECTRUM_SLOTS = shadeColumns(12, 4)

export const builtInPaletteNameKeys: Record<string, TranslationKey> = {
  'universal-spectrum-48': 'palette.builtIn.universalSpectrum48',
  'soft-spectrum-48': 'palette.builtIn.softSpectrum48',
  'vivid-spectrum-48': 'palette.builtIn.vividSpectrum48',
  'deep-spectrum-48': 'palette.builtIn.deepSpectrum48'
}

export const builtInPalettes: BuiltInPalette[] = [
  {
    id: 'universal-spectrum-48',
    name: '通用色相 48',
    columns: SPECTRUM_COLUMNS,
    slots: [...SPECTRUM_SLOTS],
    colors: colors(
      '#F5F5F5', '#B8BCC4', '#5A606B', '#171A21',
      '#F1D0B0', '#C4875D', '#7A4933', '#35251F',
      '#FFC2C2', '#F06464', '#B52F45', '#4A1824',
      '#FFD0A3', '#F28C45', '#B94D2B', '#4D241C',
      '#FFF1A8', '#E9C94A', '#9A7727', '#40331A',
      '#E0F5A0', '#9CCC4A', '#577C2C', '#26351C',
      '#B7E8B1', '#55B86A', '#28764B', '#173626',
      '#A8E2D2', '#42B89C', '#247067', '#153738',
      '#B5EBF4', '#55C1D9', '#2A7894', '#17394A',
      '#BDD7FF', '#619AF0', '#355EB7', '#1C2D5A',
      '#D7C3FF', '#9470E8', '#5F3AA3', '#2E2055',
      '#F3B9E3', '#D95FAF', '#91366F', '#461D3B'
    )
  },
  {
    id: 'soft-spectrum-48',
    name: '柔和色相 48',
    columns: SPECTRUM_COLUMNS,
    slots: [...SPECTRUM_SLOTS],
    colors: colors(
      '#EEECE8', '#B9B5B2', '#706D70', '#2F3036',
      '#E7CDB7', '#BE9579', '#80604F', '#463832',
      '#E9B9B8', '#C77D7F', '#92535F', '#4F303A',
      '#EBC7A5', '#C89568', '#8F654A', '#503B32',
      '#E9D9A7', '#B9A464', '#7E713F', '#464126',
      '#D8DFAC', '#9BA56C', '#687444', '#3A402A',
      '#BDD7B8', '#7DA27A', '#507052', '#2D4132',
      '#B5D5CA', '#70A198', '#486F6C', '#294044',
      '#B7D6DC', '#72A2B0', '#496E7D', '#293E4C',
      '#BFCCE2', '#7F91B5', '#536488', '#303A55',
      '#D0C3DE', '#9882AD', '#6A577E', '#3D324F',
      '#DFC0D1', '#B17D99', '#7D536D', '#472F43'
    )
  },
  {
    id: 'vivid-spectrum-48',
    name: '鲜亮色相 48',
    columns: SPECTRUM_COLUMNS,
    slots: [...SPECTRUM_SLOTS],
    colors: colors(
      '#FFFFFF', '#BFC6D4', '#596273', '#10131A',
      '#FFD1A3', '#F68B3C', '#A94B19', '#421D10',
      '#FFB6BE', '#FF4767', '#C20D3D', '#4D0A20',
      '#FFC08B', '#FF7A24', '#C63E0A', '#4F1908',
      '#FFF38A', '#FFD21F', '#B78400', '#493500',
      '#DFFF78', '#9BE31F', '#4D9D0E', '#1D4108',
      '#91F59A', '#24D65A', '#08923E', '#073D22',
      '#79F2D0', '#18D1A2', '#078977', '#053B39',
      '#80EDFF', '#20C9F2', '#057FAF', '#073650',
      '#96C8FF', '#3284FF', '#1551C5', '#10265E',
      '#C5A0FF', '#8B4DFF', '#5721BD', '#2B155F',
      '#FF9FE2', '#F23CB5', '#AD1479', '#4D0C38'
    )
  },
  {
    id: 'deep-spectrum-48',
    name: '深色色相 48',
    columns: SPECTRUM_COLUMNS,
    slots: [...SPECTRUM_SLOTS],
    colors: colors(
      '#D8DAE0', '#8A8E99', '#444954', '#0B0D12',
      '#C99F7C', '#8A5C42', '#503328', '#241A18',
      '#D9868D', '#A34354', '#672538', '#2B1521',
      '#D89562', '#9B552F', '#5D311F', '#291A16',
      '#D1B95F', '#8E782F', '#55481F', '#262216',
      '#A6C258', '#657F2C', '#3B4C20', '#1D2516',
      '#6FC082', '#36784C', '#244A35', '#14251D',
      '#5DB9A4', '#2F746A', '#204844', '#122526',
      '#65B4C8', '#347088', '#214655', '#132632',
      '#789DD5', '#4563A0', '#2B3D68', '#171F3A',
      '#9A7BCE', '#654894', '#412D61', '#231933',
      '#C078A9', '#88426F', '#572845', '#2D1726'
    )
  }
]
