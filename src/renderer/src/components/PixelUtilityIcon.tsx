const utilityIconPaths = {
  lock: 'M4 2h3v1H4zM3 3h1v1H3zM7 3h1v1H7zM3 4h5v1H3zM2 5h7v1H2zM2 6h3v2H2zM6 6h3v2H6zM2 8h7v1H2z',
  unlock: 'M4 1h3v1H4zM3 2h1v2H3zM7 2h1v1H7zM3 4h5v1H3zM2 5h7v1H2zM2 6h3v2H2zM6 6h3v2H6zM2 8h7v1H2z',
  eye: 'M3 2h4v1H3zM2 3h3v1H2zM6 3h2v1H6zM1 4h1v2H1zM3 4h4v1H3zM8 4h1v2H8zM4 5h2v1H4zM2 6h1v1H2zM7 6h1v1H7zM3 7h4v1H3z',
  eyeOff: 'M1 4h1v2H1zM8 4h1v2H8zM2 6h1v1H2zM7 6h1v1H7zM3 7h4v1H3z',
  properties: 'M2 2h3v1H2zM2 3h1v1H2zM4 3h4v1H4zM2 4h3v1H2zM6 5h3v1H6zM3 6h4v1H3zM8 6h1v1H8zM6 7h3v1H6z',
  delete: 'M4 2h3v1H4zM2 3h7v1H2zM3 4h5v1H3zM3 5h1v3H3zM5 5h1v3H5zM7 5h1v3H7zM3 8h5v1H3z',
  newFolder: 'M2 2h3v1H2zM1 3h7v1H1zM1 4h4v1H1zM6 4h3v1H6zM1 5h3v1H1zM7 5h2v1H7zM1 6h4v1H1zM6 6h3v1H6zM1 7h8v2H1z',
  ungroupFolder: 'M2 2h3v1H2zM1 3h7v1H1zM1 4h8v1H1zM1 5h3v1H1zM7 5h2v1H7zM1 6h8v3H1z',
  plus: 'M2 0h1v5H2zM0 2h5v1H0z',
  minus: 'M3 5h5v1H3z',
  close: 'M0 0h1v1H0zM4 0h1v1H4zM1 1h1v1H1zM3 1h1v1H3zM2 2h1v1H2zM1 3h1v1H1zM3 3h1v1H3zM0 4h1v1H0zM4 4h1v1H4z',
  up: 'M2 1h1v1H2zM1 2h1v1H1zM3 2h1v1H3zM0 3h1v1H0zM4 3h1v1H4z',
  down: 'M0 1h1v1H0zM4 1h1v1H4zM1 2h1v1H1zM3 2h1v1H3zM2 3h1v1H2z',
  left: 'M3 0h1v1H3zM2 1h1v1H2zM1 2h1v1H1zM2 3h1v1H2zM3 4h1v1H3z',
  right: 'M1 0h1v1H1zM2 1h1v1H2zM3 2h1v1H3zM2 3h1v1H2zM1 4h1v1H1z',
  onion: 'M2 2h5v1H2zM2 3h1v1H2zM6 3h1v1H6zM2 4h1v1H2zM6 4h1v1H6zM2 5h1v1H2zM6 5h1v1H6zM2 6h5v1H2z',
  more: 'M3 5h1v1H3zM5 5h1v1H5zM7 5h1v1H7z',
  moreLines: 'M2 3h7v1H2zM2 5h7v1H2zM2 7h7v1H2z',
  paletteLocal: 'M2 2h4v1H2zM2 3h5v1H2zM2 4h6v5H2z',
  paletteCenter: 'M2 2h6v6H2z',
  restore: 'M1 0h4v1H1zM0 1h1v1H0zM5 1h1v1H5zM5 2h1v1H5zM0 3h5v1H0zM1 4h2v1H1zM2 5h1v1H2z',
  undo: 'M2 0h1v1H2zM1 1h2v1H1zM0 2h5v1H0zM1 3h2v1H1zM5 3h1v2H5zM2 4h1v1H2zM4 5h1v1H4z',
  redo: 'M3 0h1v1H3zM3 1h2v1H3zM1 2h5v1H1zM0 3h1v1H0zM3 3h2v1H3zM0 4h1v1H0zM3 4h1v1H3zM1 5h1v1H1z',
  workspace: 'M2 2h7v3H2zM2 6h4v2H2zM7 6h2v2H7z',
  copy: 'M3 3h5v3H3zM3 6h5v2H3z',
  link: 'M2 3h2v1H2zM7 3h2v1H7zM2 4h1v1H2zM8 4h1v1H8zM4 5h3v1H4zM2 6h1v1H2zM8 6h1v1H8zM2 7h2v1H2zM7 7h2v1H7z',
  paste: 'M2 2h6v3H2zM2 5h4v1H2zM2 6h3v1H2zM7 6h1v1H7zM2 7h3v1H2zM6 7h3v1H6zM2 8h3v1H2zM7 8h1v1H7z',
  mergeDown: 'M2 2h2v2H2zM5 2h1v2H5zM7 2h1v2H7zM2 5h1v3H2zM3 7h1v1H3zM5 5h3v3H5z',
  mergeVisible: 'M4 2h2v1H4zM2 3h6v2H2zM4 5h2v1H4zM2 6h1v1H2zM7 6h1v1H7zM2 7h6v1H2zM4 8h2v1H4z',
  clippingMask: 'M5 2h4v1H5zM4 3h1v3H4zM2 6h5v1H2zM3 7h3v1H3zM4 8h1v1H4z',
  layerMask: 'M5 2h2v1H5zM8 2h2v1H8zM5 3h1v1H5zM9 3h1v1H9zM7 4h1v1H7zM2 5h6v1H2zM2 6h1v1H2zM7 6h1v1H7zM1 7h3v1H1zM5 7h1v1H5zM9 7h1v1H9zM2 8h1v1H2zM5 8h2v1H5zM8 8h2v1H8z',
  folder: 'M2 2h3v1H2zM1 3h7v1H1zM1 4h8v4H1z',
  folderOpen: 'M5 4h5v1H5zM4 5h6v1H4zM3 6h6v1H3zM2 7h7v1H2z',
  move: 'M4 3h1v1H4zM6 3h1v1H6zM4 5h1v1H4zM6 5h1v1H6zM4 7h1v1H4zM6 7h1v1H6z',
  save: 'M3 2h5v1H3zM2 3h1v1H2zM7 3h2v1H7zM2 4h7v2H2zM2 6h2v2H2zM7 6h2v2H7zM2 8h7v1H2z',
  export: 'M3 2h5v1H3zM2 3h4v1H2zM8 3h1v1H8zM2 4h7v1H2zM2 5h1v1H2zM5 5h4v1H5zM2 6h1v2H2zM7 6h2v1H7zM5 7h4v1H5zM2 8h7v1H2z',
  roadmapPlanned: 'M4 2h3v1H4zM3 3h1v1H3zM7 3h1v1H7zM2 4h1v3H2zM8 4h1v3H8zM3 7h1v1H3zM7 7h1v1H7zM4 8h3v1H4z',
  roadmapCompleted: 'M4 2h3v1H4zM3 3h1v1H3zM7 3h1v1H7zM2 4h1v3H2zM6 4h1v2H6zM8 4h1v3H8zM4 5h1v1H4zM5 6h1v1H5zM3 7h1v1H3zM7 7h1v1H7zM4 8h3v1H4z',
  canvasCenter: 'M4 2h3v1H4zM3 3h1v1H3zM7 3h1v1H7zM2 4h1v3H2zM8 4h1v3H8zM5 5h1v1H5zM3 7h1v1H3zM7 7h1v1H7zM4 8h3v1H4z',
  image: 'M2 2h6v1H2zM2 3h1v1H2zM4 3h4v1H4zM2 4h6v1H2zM2 5h4v1H2zM7 5h1v1H7zM2 6h3v1H2zM7 6h1v1H7zM2 7h2v1H2zM7 7h1v1H7zM2 8h6v1H2z',
  info: 'M4 2h3v1H4zM3 3h1v1H3zM7 3h1v1H7zM2 4h1v3H2zM8 4h1v3H8zM5 5h1v2H5zM3 7h1v1H3zM7 7h1v1H7zM4 8h3v1H4z',
  canvasTop: 'M5 2h1v1H5zM4 3h3v1H4zM3 4h5v1H3zM2 5h7v1H2zM5 6h1v3H5z',
  canvasBottom: 'M5 2h1v3H5zM2 5h7v1H2zM3 6h5v1H3zM4 7h3v1H4zM5 8h1v1H5z',
  canvasLeft: 'M5 2h1v1H5zM4 3h2v1H4zM3 4h3v1H3zM2 5h7v1H2zM3 6h3v1H3zM4 7h2v1H4zM5 8h1v1H5z',
  canvasRight: 'M5 2h1v1H5zM5 3h2v1H5zM5 4h3v1H5zM2 5h7v1H2zM5 6h3v1H5zM5 7h2v1H5zM5 8h1v1H5z',
  canvasTopLeft: 'M2 2h5v1H2zM2 3h4v1H2zM2 4h3v1H2zM2 5h2v1H2zM5 5h1v1H5zM2 6h1v1H2zM6 6h1v1H6zM7 7h1v1H7z',
  canvasTopRight: 'M4 2h5v1H4zM5 3h4v1H5zM6 4h3v1H6zM5 5h1v1H5zM7 5h2v1H7zM4 6h1v1H4zM8 6h1v1H8zM3 7h1v1H3z',
  canvasBottomLeft: 'M7 3h1v1H7zM2 4h1v1H2zM6 4h1v1H6zM2 5h2v1H2zM5 5h1v1H5zM2 6h3v1H2zM2 7h4v1H2zM2 8h5v1H2z',
  canvasBottomRight: 'M3 3h1v1H3zM4 4h1v1H4zM8 4h1v1H8zM5 5h1v1H5zM7 5h2v1H7zM6 6h3v1H6zM5 7h4v1H5zM4 8h5v1H4z',
  checkboxUnchecked: 'M3 2h5v1H3zM2 3h1v5H2zM8 3h1v5H8zM3 8h5v1H3z',
  checkboxChecked: 'M3 2h5v1H3zM2 3h7v1H2zM2 4h5v1H2zM8 4h1v1H8zM2 5h1v1H2zM4 5h2v1H4zM7 5h2v1H7zM2 6h2v1H2zM6 6h3v1H6zM2 7h7v1H2zM3 8h5v1H3z',
  pin: 'M5 1h1v1H5zM4 2h3v3H4zM3 5h5v2H3zM5 7h1v2H5z',
  clearRecords: 'M6 2h1v1H6zM5 3h3v1H5zM4 4h5v1H4zM3 5h5v1H3zM2 6h5v1H2zM3 7h3v1H3zM4 8h4v1H4z',
  refresh: 'M3 2h4v1H3zM2 3h2v1H2zM7 3h1v1H7zM1 4h4v1H1zM2 5h2v1H2zM6 5h2v1H6zM5 6h4v1H5zM2 7h1v1H2zM6 7h2v1H6zM3 8h4v1H3z',
  extractColors: 'M2 2h2v1H2zM7 2h2v1H7zM2 3h1v1H2zM8 3h1v1H8zM5 4h1v1H5zM4 5h1v1H4zM6 5h1v1H6zM5 6h1v1H5zM2 7h1v1H2zM8 7h1v1H8zM2 8h2v1H2zM7 8h2v1H7z',
  follow: 'M0 0h2v1H0zM5 0h2v1H5zM0 1h1v1H0zM6 1h1v1H6zM0 5h1v1H0zM6 5h1v1H6zM0 6h2v1H0zM5 6h2v1H5z',
  check: 'M6 1h1v1H6zM5 2h1v1H5zM0 3h1v1H0zM4 3h1v1H4zM1 4h1v1H1zM3 4h1v1H3zM2 5h1v1H2z'
} as const

const utilityIconTranslucentPaths: Partial<Record<PixelUtilityIconKind, string>> = {
  lock: 'M2 4h1v1H2zM8 4h1v1H8zM5 7h1v1H5z',
  unlock: 'M2 4h1v1H2zM8 4h1v1H8zM5 7h1v1H5z',
  properties: 'M8 3h1v1H8zM2 6h1v1H2z',
  delete: 'M4 5h1v1H4zM6 5h1v1H6z',
  newFolder: 'M1 2h1v1H1zM5 2h1v1H5zM8 3h1v1H8z',
  ungroupFolder: 'M1 2h1v1H1zM5 2h1v1H5zM8 3h1v1H8z',
  restore: 'M0 0h1v1H0zM5 0h1v1H5zM5 3h1v1H5z',
  undo: 'M5 2h1v1H5zM5 5h1v1H5z',
  redo: 'M0 2h1v1H0zM0 5h1v1H0z',
  onion: 'M7 4h2v1H7zM8 5h1v3H8zM4 7h1v1H4zM4 8h5v1H4z',
  copy: 'M2 2h4v1H2zM2 3h1v3H2z',
  link: 'M4 3h1v1H4zM6 3h1v1H6zM4 7h1v1H4zM6 7h1v1H6z',
  mergeDown: 'M3 6h1v1H3z',
  mergeVisible: 'M3 6h1v1H3zM6 6h1v1H6z',
  clippingMask: 'M5 3h1v1H5z',
  folder: 'M1 2h1v1H1zM5 2h1v1H5zM8 3h1v1H8z',
  folderOpen: 'M2 3h5v1H2zM2 4h3v1H2zM2 5h2v1H2zM2 6h1v1H2zM9 6h1v1H9z',
  save: 'M2 2h1v1H2zM8 2h1v1H8zM3 3h1v1H3zM6 3h1v1H6z',
  export: 'M2 2h1v1H2zM8 2h1v1H8zM6 3h1v1H6zM3 5h1v1H3zM3 7h1v1H3z',
  image: 'M6 7h1v1H6z',
  info: 'M5 4h1v1H5z',
  checkboxUnchecked: 'M2 2h1v1H2zM8 2h1v1H8zM2 8h1v1H2zM8 8h1v1H8z',
  checkboxChecked: 'M2 2h1v1H2zM8 2h1v1H8zM2 8h1v1H2zM8 8h1v1H8z',
  pin: 'M3 4h1v1H3zM7 4h1v1H7z',
  clearRecords: 'M7 2h1v1H7zM8 3h1v1H8zM2 7h1v1H2zM3 8h1v1H3zM8 8h1v1H8z',
  refresh: 'M2 2h1v1H2zM7 2h1v1H7zM2 8h1v1H2zM7 8h1v1H7z',
  extractColors: 'M4 4h1v1H4zM6 4h1v1H6zM4 6h1v1H4zM6 6h1v1H6z'
}

export type PixelUtilityIconKind = keyof typeof utilityIconPaths

const fivePixelUtilityIconKinds = new Set<PixelUtilityIconKind>(['down', 'up', 'left', 'right', 'close', 'plus'])
const sixPixelUtilityIconKinds = new Set<PixelUtilityIconKind>(['undo', 'redo', 'restore'])
const sevenPixelUtilityIconKinds = new Set<PixelUtilityIconKind>(['follow', 'check'])

export function PixelUtilityIcon({ kind, scale = 2, className = '' }: { kind: PixelUtilityIconKind; scale?: 1 | 2; className?: string }) {
  const sourceSize = fivePixelUtilityIconKinds.has(kind) ? 5 : sixPixelUtilityIconKinds.has(kind) ? 6 : sevenPixelUtilityIconKinds.has(kind) ? 7 : 11
  const size = sourceSize * scale
  const translucentPath = utilityIconTranslucentPaths[kind]
  return <svg className={`pixel-utility-icon pixel-utility-icon-${sourceSize}px pixel-utility-icon-${scale}x ${className}`.trim()} data-pixel-icon={kind} width={size} height={size} viewBox={`0 0 ${sourceSize} ${sourceSize}`} shapeRendering="crispEdges" aria-hidden="true"><path fill="currentColor" d={utilityIconPaths[kind]} />{translucentPath && <path fill="currentColor" fillOpacity=".42" d={translucentPath} />}</svg>
}

type FivePixelIconProps = { size?: number; className?: string }

export const PixelDownIcon = ({ className }: FivePixelIconProps) => <PixelUtilityIcon kind="down" className={className} />
export const PixelUpIcon = ({ className }: FivePixelIconProps) => <PixelUtilityIcon kind="up" className={className} />
export const PixelLeftIcon = ({ className }: FivePixelIconProps) => <PixelUtilityIcon kind="left" className={className} />
export const PixelRightIcon = ({ className }: FivePixelIconProps) => <PixelUtilityIcon kind="right" className={className} />
export const PixelCloseIcon = ({ className }: FivePixelIconProps) => <PixelUtilityIcon kind="close" className={className} />
