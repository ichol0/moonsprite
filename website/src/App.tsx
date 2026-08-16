import { useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ExternalLink, GitFork, Languages, Menu, Monitor, Play, ShieldCheck, X } from 'lucide-react'
import { SITE_CONFIG } from './config'
import { copy, type Language } from './content'

type ProductImageName = 'workspace-v3' | 'timeline-v3' | 'luminance-v3' | 'export'

const imageDimensions: Record<ProductImageName, { width: number; height: number }> = {
  'workspace-v3': { width: 2560, height: 1392 },
  'timeline-v3': { width: 2560, height: 1392 },
  'luminance-v3': { width: 2560, height: 1392 },
  export: { width: 440, height: 621 },
}

function ProductImage({ name, alt, priority = false }: { name: ProductImageName; alt: string; priority?: boolean }) {
  const dimensions = imageDimensions[name]
  const wide = name !== 'export'
  return <img
    src={`/assets/product/${name}-${wide ? 2560 : 1600}.webp`}
    srcSet={wide ? `/assets/product/${name}-1280.webp 1280w, /assets/product/${name}-2560.webp 2560w` : `/assets/product/${name}-960.webp 960w, /assets/product/${name}-1600.webp 1600w`}
    sizes={wide ? '(max-width: 760px) 94vw, 1180px' : '(max-width: 760px) 80vw, 440px'}
    width={dimensions.width}
    height={dimensions.height}
    loading={priority ? 'eager' : 'lazy'}
    fetchPriority={priority ? 'high' : 'auto'}
    decoding="async"
    alt={alt}
  />
}

function SteamButton({ label, soon, compact = false }: { label: string; soon: string; compact?: boolean }) {
  if (!SITE_CONFIG.steamUrl) return <span className={`button primary disabled ${compact ? 'compact' : ''}`} aria-disabled="true"><Play aria-hidden="true" />{soon}</span>
  return <a className={`button primary ${compact ? 'compact' : ''}`} href={SITE_CONFIG.steamUrl} target="_blank" rel="noopener noreferrer"><Play aria-hidden="true" />{label}<ExternalLink aria-hidden="true" /></a>
}

function useReveal() {
  useEffect(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('[data-reveal]')]
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach((element) => element.dataset.revealed = 'true')
      return
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      ;(entry.target as HTMLElement).dataset.revealed = 'true'
      observer.unobserve(entry.target)
    }), { threshold: 0.08 })
    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])
}

export function App() {
  const initialLanguage = (): Language => {
    const saved = localStorage.getItem('moonsprite-language')
    if (saved === 'zh' || saved === 'en') return saved
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
  const [language, setLanguage] = useState<Language>(initialLanguage)
  const [menuOpen, setMenuOpen] = useState(false)
  const t = copy[language]
  useReveal()

  useEffect(() => {
    localStorage.setItem('moonsprite-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    document.title = t.meta.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.meta.description)
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', t.meta.title)
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', t.meta.description)
  }, [language, t.meta])

  useEffect(() => {
    document.body.dataset.menuOpen = String(menuOpen)
    return () => { delete document.body.dataset.menuOpen }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)
  const featureImages: ProductImageName[] = ['workspace-v3', 'timeline-v3', 'luminance-v3', 'export']

  return <div className="site-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="#top" onClick={closeMenu} aria-label="MoonSprite"><img src="/assets/moonsprite-logo.svg" width="28" height="28" alt="" /><span>MoonSprite</span><small>DEV.5</small></a>
        <nav className={menuOpen ? 'site-nav open' : 'site-nav'} aria-label="Primary navigation">
          <a href="#work" onClick={closeMenu}>{t.nav.work}</a>
          <a href="#features" onClick={closeMenu}>{t.nav.features}</a>
          <a href="#faq" onClick={closeMenu}>{t.nav.faq}</a>
          <a href={SITE_CONFIG.githubUrl} target="_blank" rel="noopener noreferrer">GitHub</a>
          <button className="language-button" type="button" onClick={() => setLanguage((value) => value === 'zh' ? 'en' : 'zh')} aria-label={language === 'zh' ? 'Switch to English' : '切换到中文'}><Languages aria-hidden="true" />{language === 'zh' ? 'EN' : '中文'}</button>
          <SteamButton label={t.common.steam} soon={t.common.steamSoon} compact />
        </nav>
        <button className="menu-button" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label={menuOpen ? t.nav.close : t.nav.menu}>{menuOpen ? <X /> : <Menu />}</button>
      </div>
    </header>

    <main id="main">
      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="hero-brand"><img src="/assets/moonsprite-logo.svg" width="70" height="70" alt="" /><h1>{t.hero.title}</h1></div>
          <p className="hero-subtitle">{t.hero.subtitle}</p>
          <p className="hero-description">{t.hero.description}</p>
          <div className="hero-actions"><SteamButton label={t.common.steam} soon={t.common.steamSoon} /><a className="button secondary" href={SITE_CONFIG.githubUrl} target="_blank" rel="noopener noreferrer"><GitFork aria-hidden="true" />{t.common.github}</a></div>
          <div className="hero-meta"><span><Monitor aria-hidden="true" />{t.hero.platform}</span><span><ShieldCheck aria-hidden="true" />{t.hero.license}</span><span className="dev-state">{t.common.dev}</span></div>
        </div>
        <div className="hero-product"><ProductImage name="workspace-v3" alt={t.hero.imageAlt} priority /></div>
      </section>

      <section className="showcase" id="work">
        <div className="content-wrap" data-reveal>
          <div className="section-title"><span>{t.work.eyebrow}</span><h2>{t.work.title}</h2><p>{t.work.description}</p></div>
          <div className="showcase-grid">
            {[1, 2, 3].map((number, index) => <figure key={number} className={`showcase-item item-${number}`}>
              <img src={`/assets/showcase/showcase-${number}-1536.webp`} srcSet={`/assets/showcase/showcase-${number}-768.webp 768w, /assets/showcase/showcase-${number}-1536.webp 1536w`} sizes={number === 1 ? '(max-width: 760px) 94vw, 760px' : '(max-width: 760px) 94vw, 470px'} width="1536" height="1024" loading="lazy" decoding="async" alt={t.work.itemAlt[index]} />
            </figure>)}
          </div>
        </div>
      </section>

      <section className="trust-strip">
        <div className="content-wrap" data-reveal>{t.facts.items.map((item, index) => <article key={item.title}><span>0{index + 1}</span><div><h3>{item.title}</h3><p>{item.body}</p></div></article>)}</div>
      </section>

      <section className="features" id="features">
        <div className="content-wrap">
          <div className="section-title centered" data-reveal><span>{t.features.eyebrow}</span><h2>{t.features.title}</h2></div>
          <div className="feature-list">
            {t.features.items.map((item, index) => <article className={`feature-row row-${index + 1}`} key={item.index} data-reveal>
              <div className="feature-copy"><span className="feature-number">{item.index}</span><h3>{item.title}</h3><p>{item.body}</p><ul>{item.tags.map((tag) => <li key={tag}><Check aria-hidden="true" />{tag}</li>)}</ul></div>
              <div className={`feature-media media-${featureImages[index]}`}><ProductImage name={featureImages[index]} alt={item.alt} /></div>
            </article>)}
          </div>
        </div>
      </section>

      <section className="faq" id="faq">
        <div className="content-wrap faq-layout">
          <div className="section-title" data-reveal><span>{t.faq.eyebrow}</span><h2>{t.faq.title}</h2></div>
          <div className="faq-list" data-reveal>{t.faq.items.map((item) => <details key={item.q}><summary><strong>{item.q}</strong><ChevronDown aria-hidden="true" /></summary><p>{item.a}</p></details>)}</div>
        </div>
      </section>

      <section className="final-cta">
        <div className="content-wrap" data-reveal><img src="/assets/moonsprite-logo.svg" width="42" height="42" alt="" /><div><span>{t.cta.eyebrow}</span><h2>{t.cta.title}</h2><p>{t.cta.body}</p></div><div className="final-actions"><SteamButton label={t.common.steam} soon={t.common.steamSoon} /><a href={SITE_CONFIG.githubUrl} target="_blank" rel="noopener noreferrer">{t.common.github}<ArrowRight aria-hidden="true" /></a></div></div>
      </section>
    </main>

    <footer className="site-footer"><div className="content-wrap"><div className="footer-brand"><img src="/assets/moonsprite-logo.svg" width="28" height="28" alt="" /><strong>MoonSprite</strong></div><p>{t.footer.notice}</p><nav><a href={SITE_CONFIG.githubUrl} target="_blank" rel="noopener noreferrer">{t.footer.source}</a><a href={`${SITE_CONFIG.githubUrl}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">{t.footer.license}</a></nav></div></footer>
  </div>
}
