export interface AirbrushPoint {
  x: number
  y: number
}

export interface AirbrushSettings {
  particleRadius: number
  scatterRadius: number
  density: number
}

export const airbrushParticleSize = (radius: number): number => Math.max(1, Math.round(radius) * 2 - 1)

export function generateAirbrushParticles(
  center: AirbrushPoint,
  settings: AirbrushSettings,
  random: () => number = Math.random
): AirbrushPoint[] {
  const density = Math.max(1, Math.round(settings.density))
  const scatterRadius = Math.max(0, settings.scatterRadius)
  const particles: AirbrushPoint[] = []
  for (let index = 0; index < density; index += 1) {
    const angle = random() * Math.PI * 2
    const distance = Math.sqrt(random()) * scatterRadius
    particles.push({
      x: Math.round(center.x + Math.cos(angle) * distance),
      y: Math.round(center.y + Math.sin(angle) * distance)
    })
  }
  return particles
}
