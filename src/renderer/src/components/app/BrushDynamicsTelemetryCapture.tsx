import { useEffect, useRef } from 'react'
import { BRUSH_SPEED_STOP_MS, coalescedPointerClientPoints, updateBrushSpeedTracking, type BrushSpeedState } from '@/core/canvas-input'
import { clearBrushDynamicsTelemetry, publishBrushDynamicsTelemetry } from '@/core/brush-dynamics-telemetry'
import { calibrateBrushPressure } from '@/core/pressure'

export function BrushDynamicsTelemetryCapture({ documentId }: { documentId: string | null }) {
  const documentIdRef = useRef(documentId)
  const speedRef = useRef<BrushSpeedState | undefined>(undefined)
  const pointerRef = useRef<{ pressure: number | null; pointerType: string | null }>({ pressure: null, pointerType: null })
  const stopTimerRef = useRef<number | null>(null)

  useEffect(() => {
    documentIdRef.current = documentId
    speedRef.current = undefined
    pointerRef.current = { pressure: null, pointerType: null }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    if (documentId) publishBrushDynamicsTelemetry({ documentId, pressure: null, speed: 0, pointerType: null, active: false })
    else clearBrushDynamicsTelemetry()
  }, [documentId])

  useEffect(() => {
    const clearStopTimer = (): void => {
      if (stopTimerRef.current === null) return
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    const publishInactive = (): void => {
      clearStopTimer()
      speedRef.current = undefined
      pointerRef.current = { pressure: null, pointerType: null }
      const activeDocumentId = documentIdRef.current
      if (!activeDocumentId) {
        clearBrushDynamicsTelemetry()
        return
      }
      publishBrushDynamicsTelemetry({ documentId: activeDocumentId, pressure: null, speed: 0, pointerType: null, active: false })
    }
    const scheduleStoppedSpeed = (): void => {
      clearStopTimer()
      stopTimerRef.current = window.setTimeout(() => {
        stopTimerRef.current = null
        const activeDocumentId = documentIdRef.current
        if (!activeDocumentId) return
        if (speedRef.current) speedRef.current = { ...speedRef.current, speed: 0 }
        const latest = pointerRef.current
        publishBrushDynamicsTelemetry({ documentId: activeDocumentId, pressure: latest.pressure, speed: 0, pointerType: latest.pointerType, active: true })
      }, BRUSH_SPEED_STOP_MS)
    }
    const publishSample = (sample: { clientX: number; clientY: number; timeStamp?: number; pressure?: number; pointerType?: string }): void => {
      const activeDocumentId = documentIdRef.current
      if (!activeDocumentId) return
      const tracked = updateBrushSpeedTracking(speedRef.current, sample)
      speedRef.current = tracked.state
      const pointerType = sample.pointerType ?? pointerRef.current.pointerType
      const pressure = pointerType === 'pen' ? calibrateBrushPressure(sample.pressure) : null
      pointerRef.current = { pressure, pointerType: pointerType ?? null }
      publishBrushDynamicsTelemetry({ documentId: activeDocumentId, pressure, speed: tracked.speed, pointerType: pointerType ?? null, active: true })
      scheduleStoppedSpeed()
    }
    const pointerDown = (event: PointerEvent): void => {
      speedRef.current = undefined
      for (const sample of coalescedPointerClientPoints(event)) publishSample({ ...sample, pointerType: sample.pointerType ?? event.pointerType })
    }
    const pointerMove = (event: PointerEvent): void => {
      for (const sample of coalescedPointerClientPoints(event)) publishSample({ ...sample, pointerType: sample.pointerType ?? event.pointerType })
    }
    const pointerUp = (event: PointerEvent): void => {
      clearStopTimer()
      if (speedRef.current) speedRef.current = { ...speedRef.current, speed: 0 }
      const activeDocumentId = documentIdRef.current
      if (!activeDocumentId) return
      const pointerType = event.pointerType || null
      const pressure = pointerType === 'pen' ? 0 : null
      pointerRef.current = { pressure, pointerType }
      publishBrushDynamicsTelemetry({ documentId: activeDocumentId, pressure, speed: 0, pointerType, active: true })
    }
    const pointerOut = (event: PointerEvent): void => {
      if (event.relatedTarget === null) publishInactive()
    }
    const visibilityChange = (): void => {
      if (document.visibilityState === 'hidden') publishInactive()
    }

    window.addEventListener('pointerdown', pointerDown, true)
    window.addEventListener('pointermove', pointerMove, true)
    window.addEventListener('pointerup', pointerUp, true)
    window.addEventListener('pointercancel', publishInactive, true)
    window.addEventListener('pointerout', pointerOut, true)
    window.addEventListener('blur', publishInactive)
    document.addEventListener('visibilitychange', visibilityChange)
    return () => {
      window.removeEventListener('pointerdown', pointerDown, true)
      window.removeEventListener('pointermove', pointerMove, true)
      window.removeEventListener('pointerup', pointerUp, true)
      window.removeEventListener('pointercancel', publishInactive, true)
      window.removeEventListener('pointerout', pointerOut, true)
      window.removeEventListener('blur', publishInactive)
      document.removeEventListener('visibilitychange', visibilityChange)
      clearStopTimer()
      clearBrushDynamicsTelemetry()
    }
  }, [])

  return null
}
