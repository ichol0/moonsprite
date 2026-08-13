import { describe, expect, it } from 'vitest'
import { airbrushParticleSize, airbrushSymmetryPoints, generateAirbrushParticles } from './airbrush'

describe('airbrush particles', () => {
  it('creates the requested number of particles inside the scatter radius', () => {
    let seed = 0x12345678
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const particles = generateAirbrushParticles({ x: 20, y: 30 }, { particleRadius: 2, scatterRadius: 12, density: 40 }, random)
    expect(particles).toHaveLength(40)
    for (const particle of particles) {
      expect(Math.hypot(particle.x - 20, particle.y - 30)).toBeLessThanOrEqual(13)
    }
  })

  it('maps a pixel radius to an odd brush diameter', () => {
    expect(airbrushParticleSize(1)).toBe(1)
    expect(airbrushParticleSize(3)).toBe(5)
  })

  it('returns every deduplicated symmetry target used by preview and invalidation', () => {
    expect(airbrushSymmetryPoints(
      [{ x: 2, y: 3 }, { x: 2, y: 3 }],
      10,
      8,
      { horizontal: true, vertical: true, diagonalUp: false, diagonalDown: false }
    )).toEqual([
      { x: 2, y: 3 },
      { x: 2, y: 4 },
      { x: 7, y: 3 },
      { x: 7, y: 4 }
    ])
  })
})
