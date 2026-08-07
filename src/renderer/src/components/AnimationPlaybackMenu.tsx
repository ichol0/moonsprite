import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, Pause, Play, RotateCcw } from 'lucide-react'
import { ensureAnimationDocument } from '@/core/animation'
import { useWorkspace, type DocumentSession } from '@/store/workspace'
import { useI18n } from './I18nProvider'

const playbackRates = [0.25, 0.5, 1, 1.5, 2, 3]

export interface AnimationPlaybackState {
  playing: boolean
  rate: number
  loop: boolean
  returnToStart: boolean
  setPlaying: (playing: boolean) => void
  setRate: (rate: number) => void
  setLoop: (loop: boolean) => void
  setReturnToStart: (enabled: boolean) => void
}

export function AnimationPlaybackMenu({ session, x, y, onClose, playback: controlledPlayback }: { session: DocumentSession; x: number; y: number; onClose: () => void; playback?: AnimationPlaybackState }) {
  const { t } = useI18n()
  const store = useWorkspace.getState()
  const timeline = ensureAnimationDocument(session.document)
  const playback: AnimationPlaybackState = controlledPlayback ?? {
    playing: session.animationPlaying,
    rate: session.animationPlaybackRate ?? 1,
    loop: timeline.loop,
    returnToStart: session.animationReturnToStart ?? false,
    setPlaying: (playing) => store.setAnimationPlaying(playing),
    setRate: (rate) => store.setAnimationPlaybackRate(rate),
    setLoop: (loop) => store.setAnimationLoop(loop),
    setReturnToStart: (enabled) => store.setAnimationReturnToStart(enabled)
  }

  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      if ((event.target as HTMLElement | null)?.closest('.animation-context-menu')) return
      onClose()
    }
    const close = (): void => onClose()
    const keyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', keyDown)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', keyDown)
    }
  }, [onClose])

  return createPortal(<div className="context-menu animation-context-menu" role="menu" aria-label={t('timeline.playbackSettings')} style={{ left: Math.min(x, Math.max(8, window.innerWidth - 244)), top: Math.max(8, Math.min(y, window.innerHeight - 390)) }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
    <button className="context-menu-item" type="button" role="menuitem" onClick={() => { playback.setPlaying(!playback.playing); onClose() }}>{playback.playing ? <Pause size={15} /> : <Play size={15} />}<span>{t(playback.playing ? 'timeline.pause' : 'timeline.play')}</span></button>
    <span className="context-menu-divider" />
    {playbackRates.map((rate) => <button key={rate} className="context-menu-item" type="button" role="menuitemradio" aria-checked={playback.rate === rate} onClick={() => { playback.setRate(rate); onClose() }}>{playback.rate === rate ? <Check size={15} /> : <span />}<span>{t('timeline.playbackSpeedValue', { rate })}</span></button>)}
    <span className="context-menu-divider" />
    <button className="context-menu-item" type="button" role="menuitemradio" aria-checked={!playback.loop} onClick={() => { playback.setLoop(false); onClose() }}>{!playback.loop ? <Check size={15} /> : <span />}<span>{t('timeline.playOnce')}</span></button>
    <button className="context-menu-item" type="button" role="menuitemradio" aria-checked={playback.loop} onClick={() => { playback.setLoop(true); onClose() }}>{playback.loop ? <Check size={15} /> : <span />}<span>{t('timeline.loopAll')}</span></button>
    <span className="context-menu-divider" />
    <button className="context-menu-item" type="button" role="menuitemcheckbox" aria-checked={playback.returnToStart} onClick={() => { playback.setReturnToStart(!playback.returnToStart); onClose() }}>{playback.returnToStart ? <Check size={15} /> : <RotateCcw size={15} />}<span>{t('timeline.returnToStart')}</span></button>
  </div>, document.body)
}
