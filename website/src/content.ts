export type Language = 'zh' | 'en'

export type Copy = typeof copy.zh

export const copy = {
  zh: {
    meta: {
      title: 'MoonSprite - Windows 像素画工作台',
      description: 'MoonSprite 是面向 Windows 的原创开源像素画工作台。绘制、制作动画并管理完整创作流程。',
    },
    nav: { features: '功能', interface: '界面', work: '作品', faq: '常见问题', menu: '打开导航', close: '关闭导航' },
    common: { dev: 'DEV.4 开发中', steam: '在 Steam 加入愿望单', steamSoon: '即将登陆 Steam', github: '查看 GitHub', external: '在新窗口打开' },
    hero: {
      eyebrow: '为像素创作者打造',
      title: 'MoonSprite',
      subtitle: '专注像素创作的 Windows 工作台。',
      description: '从第一笔、第一层，到逐帧动画与最终导出，在一个清晰、快速、可定制的工作空间里完成。',
      platform: 'Windows 10 / 11',
      license: 'MIT 开源',
      imageAlt: 'MoonSprite DEV.4 编辑器完整界面，中央显示像素作品，左右为颜色、图层和动画面板',
      evidence: '真实 DEV.4 软件界面',
    },
    tour: {
      eyebrow: '工作区导览',
      title: '工具待在手边，作品留在中心。',
      description: '四个真实界面切面，展示 MoonSprite 如何把像素创作、动画和输出整合进同一套工作流。',
      tabsLabel: '软件界面视图',
      items: [
        { id: 'creation', label: '创作', title: '逐像素控制，不打断思路', body: '铅笔、形状、填充、渐变和多种选区工具围绕画布排列。缩放到每一个像素，也能随时回到完整构图。', alt: 'MoonSprite 创作区，中央画布显示蓝色像素图形和预览面板' },
        { id: 'animation', label: '动画', title: '图层与时间轴自然对齐', body: '帧、cel 与图层在同一栏目中对应排列。调整帧时长、播放、复制和洋葱皮参考都不需要离开当前视线。', alt: 'MoonSprite 动画时间轴，帧列和图层行对齐显示' },
        { id: 'layers', label: '图层', title: '复杂结构仍然清楚', body: '图层、文件夹、蒙版、混合模式和调色板组成可停靠工作区。按项目习惯调整布局，界面状态不会污染撤销历史。', alt: 'MoonSprite 完整工作区，包含颜色、调色板、图层和动画栏目' },
        { id: 'export', label: '输出', title: '面向作品，也面向流程', body: '导出 PNG、WebP、GIF、逐帧图像、精灵表与缩时视频。预设与缩放倍率让重复交付更直接。', alt: 'MoonSprite GIF 导出设置，包含帧范围、动画方向和缩放倍率' },
      ],
    },
    features: {
      eyebrow: '核心能力',
      title: '一套真正围绕像素工作的流程。',
      items: [
        { index: '01', title: '画得准，也改得快', body: '像素铅笔、笔刷动态、形状、渐变、油漆桶与对称绘制覆盖从草图到精修的常用路径。矩形、椭圆、套索、多边形与魔棒选区支持组合、移动、翻转、缩放和旋转。', tags: ['像素工具', '多种选区', '对称绘制'], image: 'creation', alt: 'MoonSprite 像素创作画布' },
        { index: '02', title: '让每一帧都有上下文', body: '逐帧动画使用图层与 cel 模型，每帧拥有独立时长。播放速度、循环、帧复制、cel 连接和洋葱皮都集中在图层栏目中。', tags: ['逐帧动画', '洋葱皮', 'cel 工作流'], image: 'animation', alt: 'MoonSprite 动画帧和 cel 时间轴' },
        { index: '03', title: '先看明暗，再看颜色', body: '一键切换相对明暗视图，把色相干扰暂时拿开，直接检查主体、背景和阴影之间的层次关系。画布旋转、缩放与预览保持同步，便于从不同角度校准构图。', tags: ['相对明暗', '画布旋转', '同步预览'], image: 'luminance', alt: 'MoonSprite 相对明暗视图，画布和预览以灰度显示' },
        { index: '04', title: '可靠地带走每次成果', body: '读取常用图片和 Aseprite 工程，输出静态图、GIF、逐帧图像与精灵表。工程恢复、最近项目、文件关联和 Windows 缩略图为日常创作提供完整落点。', tags: ['多格式导入导出', '异常恢复', 'Windows 集成'], image: 'export', alt: 'MoonSprite 导出设置界面' },
      ],
    },
    work: { eyebrow: '内置展示作品', title: '从微小图标，到完整世界。', description: '以下像素作品随 MoonSprite 项目提供，用于展示不同尺度、色彩与构图下的像素表现。', itemAlt: ['MoonSprite 内置展示作品：月夜城市、海边工坊与月面基地组合', 'MoonSprite 内置展示作品：月夜海边工坊与灯塔', 'MoonSprite 内置展示作品：巨月下的未来观测城市'] },
    facts: {
      eyebrow: '开放而务实', title: '作品属于你，工具保持透明。',
      items: [
        { title: 'Windows 原生工作流', body: '面向 Windows 10 / 11，支持文件关联、系统剪贴板、恢复草稿与资源管理器缩略图。' },
        { title: 'MIT 开源', body: '源代码公开，开发过程与问题追踪可见。MoonSprite 是独立原创项目。' },
        { title: '连接现有素材', body: '可导入和导出 Aseprite 工程，并处理 PNG、JPEG、WebP、BMP 与 GIF 等常用格式。' },
      ],
    },
    faq: {
      eyebrow: '常见问题', title: '开始之前，你可能想知道。',
      items: [
        { q: 'MoonSprite 现在可以下载吗？', a: 'MoonSprite 目前仍处于 DEV.4 开发阶段，尚未公开分发。Steam 商店页面准备就绪后，官网会开放愿望单入口。' },
        { q: '支持哪些系统？', a: '当前产品专注 Windows 10 与 Windows 11，需要 WebView2 Runtime。其他桌面系统暂不在首发范围内。' },
        { q: '可以打开 Aseprite 文件吗？', a: '可以。MoonSprite 支持打开和导出 .ase 与 .aseprite 工程，也支持常见图片格式。复杂工程的兼容表现仍会随开发版持续完善。' },
        { q: '它和 Aseprite 有什么关系？', a: 'MoonSprite 是独立原创的开源像素画工作台，与 Aseprite 无隶属关系，也不使用其源码、品牌或视觉资产。' },
        { q: '项目会收费吗？', a: '当前仓库以 MIT License 开源。Steam 的发布形式与价格尚未公布，确定后会在官网与仓库同步。' },
      ],
    },
    cta: { eyebrow: '下一帧，即将开始', title: '关注 MoonSprite 的开发进度。', body: 'Steam 页面开放后即可加入愿望单。现在可以先在 GitHub 查看源代码、版本进展与已知问题。' },
    footer: { description: '原创开源 Windows 像素画工作台。', source: '源代码', license: 'MIT License', notice: 'MoonSprite 与 Aseprite 无隶属关系。' },
  },
  en: {
    meta: { title: 'MoonSprite - Pixel Art Workstation for Windows', description: 'MoonSprite is an original open-source pixel art workstation for Windows, built for drawing, animation, and a complete creative workflow.' },
    nav: { features: 'Features', interface: 'Interface', work: 'Artwork', faq: 'FAQ', menu: 'Open navigation', close: 'Close navigation' },
    common: { dev: 'DEV.4 in development', steam: 'Wishlist on Steam', steamSoon: 'Coming soon to Steam', github: 'View on GitHub', external: 'Opens in a new window' },
    hero: { eyebrow: 'Built for pixel artists', title: 'MoonSprite', subtitle: 'A Windows workstation focused on pixel art.', description: 'Take an idea from its first pixel and first layer through frame-by-frame animation and final export in one clear, fast, adaptable workspace.', platform: 'Windows 10 / 11', license: 'Open source · MIT', imageAlt: 'Full MoonSprite DEV.4 editor interface with pixel artwork in the center and color, layer, and animation panels around it', evidence: 'Actual DEV.4 interface' },
    tour: {
      eyebrow: 'Workspace tour', title: 'Tools stay close. Your work stays central.', description: 'Four real views show how MoonSprite brings drawing, animation, and delivery into one connected workflow.', tabsLabel: 'Software interface views',
      items: [
        { id: 'creation', label: 'Create', title: 'Pixel-level control without losing flow', body: 'Pencil, shapes, fill, gradients, and selection tools sit around the canvas. Work on individual pixels, then return to the whole composition instantly.', alt: 'MoonSprite creation area with blue pixel artwork and a preview panel' },
        { id: 'animation', label: 'Animate', title: 'Layers and time line up naturally', body: 'Frames, cels, and layers share one aligned panel. Adjust timing, play, duplicate, and reference onion skins without leaving your current view.', alt: 'MoonSprite animation timeline with aligned frame columns and layer rows' },
        { id: 'layers', label: 'Organize', title: 'Keep complex work readable', body: 'Layers, folders, masks, blend modes, and palettes form a dockable workspace. Arrange it around your process without adding view changes to undo history.', alt: 'MoonSprite workspace with color, palette, layer, and animation panels' },
        { id: 'export', label: 'Deliver', title: 'Output for artwork and pipelines', body: 'Export PNG, WebP, GIF, frame sequences, sprite sheets, and timelapse video. Presets and scaling make repeat delivery straightforward.', alt: 'MoonSprite GIF export settings with frame range, direction, and scale' },
      ],
    },
    features: {
      eyebrow: 'Core capabilities', title: 'A workflow built around pixels, end to end.',
      items: [
        { index: '01', title: 'Draw precisely. Revise quickly.', body: 'Pixel pencils, brush dynamics, shapes, gradients, fill, and symmetry cover the path from sketch to polish. Rectangle, ellipse, lasso, polygon, and magic selections support combining, moving, flipping, scaling, and rotating.', tags: ['Pixel tools', 'Rich selections', 'Symmetry'], image: 'creation', alt: 'MoonSprite pixel creation canvas' },
        { index: '02', title: 'Give every frame context.', body: 'Frame-by-frame animation uses a layer and cel model with independent timing. Playback rate, looping, frame duplication, cel linking, and onion skinning live in the layers panel.', tags: ['Frame animation', 'Onion skin', 'Cel workflow'], image: 'animation', alt: 'MoonSprite animation frame and cel timeline' },
        { index: '03', title: 'See value before color.', body: 'Switch to relative luminance view to remove hue distractions and inspect the hierarchy between subject, background, and shadow. Canvas rotation, zoom, and preview stay in sync while you refine the composition.', tags: ['Relative luminance', 'Canvas rotation', 'Synced preview'], image: 'luminance', alt: 'MoonSprite relative luminance view with canvas and preview shown in grayscale' },
        { index: '04', title: 'Take every result with you.', body: 'Read common images and Aseprite projects, then output stills, GIFs, frame sequences, and sprite sheets. Recovery, recent projects, file associations, and Windows thumbnails support daily work.', tags: ['Import and export', 'Recovery', 'Windows integration'], image: 'export', alt: 'MoonSprite export settings interface' },
      ],
    },
    work: { eyebrow: 'Built-in showcase', title: 'From tiny icons to complete worlds.', description: 'These pixel pieces ship with the MoonSprite project to demonstrate different scales, palettes, and compositions.', itemAlt: ['MoonSprite showcase: moonlit city, seaside workshop, and lunar base triptych', 'MoonSprite showcase: a moonlit seaside workshop and lighthouse', 'MoonSprite showcase: a future observatory city under a giant moon'] },
    facts: { eyebrow: 'Open and practical', title: 'Your work is yours. The tool stays transparent.', items: [{ title: 'Native Windows workflow', body: 'Designed for Windows 10 / 11 with file associations, system clipboard, recovery drafts, and Explorer thumbnails.' }, { title: 'Open source under MIT', body: 'The source, development history, and issue tracking are public. MoonSprite is an original independent project.' }, { title: 'Connect existing assets', body: 'Import and export Aseprite projects, plus PNG, JPEG, WebP, BMP, GIF, and other everyday formats.' }] },
    faq: { eyebrow: 'FAQ', title: 'A few things to know before you begin.', items: [{ q: 'Can I download MoonSprite now?', a: 'MoonSprite is currently in DEV.4 development and is not publicly distributed yet. The website will open its wishlist link when the Steam store page is ready.' }, { q: 'Which platforms are supported?', a: 'The current product focuses on Windows 10 and Windows 11 and requires WebView2 Runtime. Other desktop platforms are not part of the initial release scope.' }, { q: 'Can it open Aseprite files?', a: 'Yes. MoonSprite can open and export .ase and .aseprite projects and handles common image formats. Compatibility for complex projects continues to improve during development.' }, { q: 'Is it affiliated with Aseprite?', a: 'No. MoonSprite is an original, independent open-source pixel art workstation. It is not affiliated with Aseprite and does not use its source code, brand, or visual assets.' }, { q: 'Will it be paid software?', a: 'The current repository is open source under the MIT License. Steam distribution and pricing have not been announced and will be shared on the site and repository when decided.' }] },
    cta: { eyebrow: 'The next frame is coming', title: 'Follow MoonSprite as it develops.', body: 'Wishlist on Steam when the store page goes live. For now, visit GitHub for source code, version progress, and known issues.' },
    footer: { description: 'An original open-source pixel art workstation for Windows.', source: 'Source code', license: 'MIT License', notice: 'MoonSprite is not affiliated with Aseprite.' },
  },
} as const
