export const TOP_MENU_IDS = ['file', 'edit', 'canvas', 'layer', 'window', 'help'] as const
const topMenuIds = new Set<string>(TOP_MENU_IDS)

export const nextTopMenuOnHover = (openMenu: string | null, hoveredMenu: string): string | null =>
  openMenu && topMenuIds.has(openMenu) && topMenuIds.has(hoveredMenu) ? hoveredMenu : openMenu
