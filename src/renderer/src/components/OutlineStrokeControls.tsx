import type { OutlineDirection, OutlineDirections, OutlineKernel, OutlinePosition } from '@shared/types'
import { outlineDirectionsForKernel, outlineDirectionsMatchKernel } from '@/core/outline-settings'
import { RangeField } from './RangeField'
import { SegmentedControl } from './SegmentedControl'
import { useI18n } from './I18nProvider'

const directionGrid: Array<OutlineDirection | 'center'> = ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se']
const quickShapeIds: OutlineKernel[] = ['round', 'square', 'horizontal', 'vertical']

const kernelMasks: Record<OutlineKernel, string[]> = {
  round: ['010', '101', '010'],
  square: ['111', '101', '111'],
  horizontal: ['000', '101', '000'],
  vertical: ['010', '000', '010']
}

function OutlineKernelIcon({ kernel }: { kernel: OutlineKernel }) {
  return <span className="outline-kernel-icon" aria-hidden="true">{kernelMasks[kernel].flatMap((row, y) => [...row].map((cell, x) => <i key={`${x}-${y}`} className={`${cell === '1' ? 'active' : ''} ${x === 1 && y === 1 ? 'source' : ''}`} />))}</span>
}

interface OutlineStrokeControlsProps {
  directions: OutlineDirections
  kernel: OutlineKernel
  maxThickness?: number
  onPatternChange: (kernel: OutlineKernel, directions: OutlineDirections) => void
  onPositionChange: (position: OutlinePosition) => void
  onThicknessChange: (thickness: number) => void
  position: OutlinePosition
  positions?: readonly OutlinePosition[]
  thickness: number
}

export function OutlineStrokeControls({ directions, kernel, maxThickness = 64, onPatternChange, onPositionChange, onThicknessChange, position, positions = ['outside', 'inside'], thickness }: OutlineStrokeControlsProps) {
  const { t } = useI18n()
  const activeQuickShape = outlineDirectionsMatchKernel(kernel, directions) ? kernel : null
  const applyQuickShape = (nextKernel: OutlineKernel): void => onPatternChange(nextKernel, outlineDirectionsForKernel(nextKernel))
  const toggleDirection = (direction: OutlineDirection): void => onPatternChange('square', { ...directions, [direction]: !directions[direction] })
  const quickShapes = quickShapeIds.map((id) => ({ id, label: t(`outline.shape.${id}`) }))

  return <>
    <section className="outline-width-setting"><RangeField className="outline-width-row" label={t('outline.width')} min={1} max={maxThickness} suffix="px" value={thickness} onChange={onThicknessChange} /></section>
    <fieldset className="outline-settings-fieldset"><legend>{t('outline.settings')}</legend>
      <div className="outline-setting-group"><span>{t('outline.position')}</span><SegmentedControl className={`outline-position-control positions-${positions.length}`} label={t('outline.position')} options={positions.map((value) => ({ value, label: t(`outline.${value}`) }))} value={position} onChange={onPositionChange} /></div>
      <div className="outline-pattern-layout">
        <div className="outline-setting-group"><span>{t('outline.quickShapes')}</span><div className="outline-quick-shapes">{quickShapes.map((shape) => <button key={shape.id} type="button" className={activeQuickShape === shape.id ? 'selected' : ''} title={shape.label} aria-label={shape.label} onClick={() => applyQuickShape(shape.id)}><OutlineKernelIcon kernel={shape.id} /></button>)}</div></div>
        <div className="outline-setting-group outline-direction-setting"><span>{t('outline.pixelDirections')}</span><div className="outline-direction-grid" aria-label={t('outline.pixelDirectionsAria')}>{directionGrid.map((direction) => {
          if (direction === 'center') return <span key={direction} className="outline-direction-center" aria-hidden="true"><i /></span>
          return <button key={direction} type="button" className={directions[direction] ? 'selected' : ''} title={t('outline.allowDirection', { direction })} aria-label={t('outline.allowDirection', { direction })} onClick={() => toggleDirection(direction)}><span /></button>
        })}</div></div>
      </div>
    </fieldset>
  </>
}
