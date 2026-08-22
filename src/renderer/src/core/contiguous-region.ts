export const MIN_GAP_CLOSING_THRESHOLD = 1
export const MAX_GAP_CLOSING_THRESHOLD = 16
export const DEFAULT_GAP_CLOSING_THRESHOLD = 2

export const normalizeGapClosingThreshold = (value: number): number => {
  const rounded = Number.isFinite(value) ? Math.round(value) : DEFAULT_GAP_CLOSING_THRESHOLD
  return Math.max(MIN_GAP_CLOSING_THRESHOLD, Math.min(MAX_GAP_CLOSING_THRESHOLD, rounded))
}

interface PixelPoint {
  x: number
  y: number
  index: number
}

const neighbors8 = (index: number, width: number, height: number, mask: Uint8Array): number[] => {
  const x = index % width
  const y = Math.floor(index / width)
  const neighbors: number[] = []
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    if (offsetX === 0 && offsetY === 0) continue
    const nextX = x + offsetX
    const nextY = y + offsetY
    if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
    const nextIndex = nextY * width + nextX
    if (mask[nextIndex] === 1) neighbors.push(nextIndex)
  }
  return neighbors
}

const endpointDirection = (
  endpoint: PixelPoint,
  barrier: Uint8Array,
  width: number,
  height: number,
  visited: Uint32Array,
  visit: number
): { x: number; y: number } | null => {
  const queue = new Uint32Array(Math.min(barrier.length, 128))
  const distances = new Uint8Array(queue.length)
  let read = 0
  let written = 1
  queue[0] = endpoint.index
  visited[endpoint.index] = visit
  const furthest: number[] = []
  let furthestDistance = 0
  while (read < written) {
    const index = queue[read++]
    const distance = distances[read - 1]
    if (distance > furthestDistance) { furthestDistance = distance; furthest.length = 0 }
    if (distance === furthestDistance) furthest.push(index)
    if (distance >= 4) continue
    for (const neighbor of neighbors8(index, width, height, barrier)) {
      if (visited[neighbor] === visit || written >= queue.length) continue
      visited[neighbor] = visit
      distances[written] = distance + 1
      queue[written++] = neighbor
    }
  }
  if (furthestDistance < 1) return null
  const inward = furthest.reduce((point, index) => ({
    x: point.x + index % width,
    y: point.y + Math.floor(index / width)
  }), { x: 0, y: 0 })
  return {
    x: endpoint.x - inward.x / furthest.length,
    y: endpoint.y - inward.y / furthest.length
  }
}

const rasterLine = (from: PixelPoint, to: PixelPoint): PixelPoint[] => {
  const points: PixelPoint[] = []
  let x = from.x
  let y = from.y
  const deltaX = Math.abs(to.x - from.x)
  const deltaY = Math.abs(to.y - from.y)
  const stepX = from.x < to.x ? 1 : -1
  const stepY = from.y < to.y ? 1 : -1
  let error = deltaX - deltaY
  while (true) {
    points.push({ x, y, index: 0 })
    if (x === to.x && y === to.y) break
    const doubled = error * 2
    if (doubled > -deltaY) { error -= deltaY; x += stepX }
    if (doubled < deltaX) { error += deltaX; y += stepY }
  }
  return points
}

const directionMatches = (direction: { x: number; y: number }, deltaX: number, deltaY: number): boolean => {
  const directionLength = Math.hypot(direction.x, direction.y)
  const deltaLength = Math.hypot(deltaX, deltaY)
  return directionLength > 0 && deltaLength > 0 && (direction.x * deltaX + direction.y * deltaY) / (directionLength * deltaLength) >= 0.2
}

const virtualGapBarrier = (matching: Uint8Array, width: number, height: number, threshold: number): Uint8Array => {
  const barrier = new Uint8Array(matching.length)
  for (let index = 0; index < matching.length; index += 1) barrier[index] = matching[index] === 1 ? 0 : 1
  const endpoints: PixelPoint[] = []
  const directions: Array<{ x: number; y: number }> = []
  const visited = new Uint32Array(barrier.length)
  let visit = 1
  for (let index = 0; index < barrier.length; index += 1) {
    if (barrier[index] !== 1 || neighbors8(index, width, height, matching).length === 0) continue
    const endpoint = { x: index % width, y: Math.floor(index / width), index }
    const direction = endpointDirection(endpoint, barrier, width, height, visited, visit++)
    if (!direction || Math.hypot(direction.x, direction.y) < 2.25) continue
    endpoints.push(endpoint)
    directions.push(direction)
  }
  const endpointAt = new Int32Array(barrier.length).fill(-1)
  for (let index = 0; index < endpoints.length; index += 1) endpointAt[endpoints[index].index] = index
  const candidates: Array<{ first: number; second: number; gap: number; distance: number; path: PixelPoint[] }> = []
  const searchRadius = threshold + 1
  for (let first = 0; first < endpoints.length; first += 1) {
    const from = endpoints[first]
    const left = Math.max(0, from.x - searchRadius)
    const top = Math.max(0, from.y - searchRadius)
    const right = Math.min(width - 1, from.x + searchRadius)
    const bottom = Math.min(height - 1, from.y + searchRadius)
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
      const second = endpointAt[y * width + x]
      if (second <= first) continue
      const to = endpoints[second]
      const deltaX = to.x - from.x
      const deltaY = to.y - from.y
      const gap = Math.max(Math.abs(deltaX), Math.abs(deltaY)) - 1
      if (gap < 1 || gap > threshold) continue
      if (!directionMatches(directions[first], deltaX, deltaY) || !directionMatches(directions[second], -deltaX, -deltaY)) continue
      const path = rasterLine(from, to).slice(1, -1)
      if (path.length !== gap || path.some((point) => matching[point.y * width + point.x] !== 1)) continue
      candidates.push({ first, second, gap, distance: Math.hypot(deltaX, deltaY), path })
    }
  }
  candidates.sort((left, right) => left.gap - right.gap || left.distance - right.distance)
  const paired = new Uint8Array(endpoints.length)
  const nearbyVisited = new Uint32Array(barrier.length)
  let nearbyVisit = 1
  const blockNearbyEndpoints = (endpointIndex: number): void => {
    const queue = new Uint32Array(Math.min(barrier.length, 128))
    const distances = new Uint8Array(queue.length)
    const visitId = nearbyVisit++
    let read = 0
    let written = 1
    queue[0] = endpoints[endpointIndex].index
    nearbyVisited[queue[0]] = visitId
    while (read < written) {
      const index = queue[read]
      const distance = distances[read++]
      const nearbyEndpoint = endpointAt[index]
      if (nearbyEndpoint >= 0) paired[nearbyEndpoint] = 1
      if (distance >= 3) continue
      for (const neighbor of neighbors8(index, width, height, barrier)) {
        if (nearbyVisited[neighbor] === visitId || written >= queue.length) continue
        nearbyVisited[neighbor] = visitId
        queue[written] = neighbor
        distances[written++] = distance + 1
      }
    }
  }
  const virtualBarrier = new Uint8Array(matching.length)
  for (const candidate of candidates) {
    if (paired[candidate.first] === 1 || paired[candidate.second] === 1) continue
    blockNearbyEndpoints(candidate.first)
    blockNearbyEndpoints(candidate.second)
    for (const point of candidate.path) virtualBarrier[point.y * width + point.x] = 1
  }
  return virtualBarrier
}

const floodBinaryRegion = (
  width: number,
  height: number,
  startIndex: number,
  matches: (index: number) => boolean,
  virtualBarrier?: Uint8Array
): Uint8Array | null => {
  if (!matches(startIndex) || virtualBarrier?.[startIndex] === 1) return null
  const total = width * height
  const selected = new Uint8Array(total)
  let stack = new Uint32Array(Math.min(total, 1024))
  let stackLength = 0
  const push = (index: number): void => {
    if (selected[index] === 1 || virtualBarrier?.[index] === 1 || !matches(index)) return
    selected[index] = 1
    if (stackLength === stack.length) {
      const expanded = new Uint32Array(Math.min(total, Math.max(stack.length * 2, 1024)))
      expanded.set(stack)
      stack = expanded
    }
    stack[stackLength++] = index
  }

  push(startIndex)
  while (stackLength > 0) {
    const index = stack[--stackLength]
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) push(index - 1)
    if (x + 1 < width) push(index + 1)
    if (y > 0) push(index - width)
    if (y + 1 < height) push(index + width)
  }
  return selected
}

const includeAdjacentVirtualBarrier = (selected: Uint8Array, virtualBarrier: Uint8Array, width: number, height: number): void => {
  const queue = new Uint32Array(virtualBarrier.length)
  const queued = new Uint8Array(virtualBarrier.length)
  let read = 0
  let written = 0
  const touchesSelected = (index: number): boolean => {
    const x = index % width
    const y = Math.floor(index / width)
    return (x > 0 && selected[index - 1] === 1)
      || (x + 1 < width && selected[index + 1] === 1)
      || (y > 0 && selected[index - width] === 1)
      || (y + 1 < height && selected[index + width] === 1)
  }
  for (let index = 0; index < virtualBarrier.length; index += 1) {
    if (virtualBarrier[index] !== 1 || !touchesSelected(index)) continue
    queued[index] = 1
    queue[written++] = index
  }
  while (read < written) {
    const index = queue[read++]
    selected[index] = 1
    for (const neighbor of neighbors8(index, width, height, virtualBarrier)) {
      if (queued[neighbor] === 1) continue
      queued[neighbor] = 1
      queue[written++] = neighbor
    }
  }
}

export const contiguousMatchingRegion = (
  width: number,
  height: number,
  startX: number,
  startY: number,
  matches: (index: number) => boolean,
  gapClosingThreshold = 0
): Uint8Array | null => {
  if (width < 1 || height < 1 || startX < 0 || startY < 0 || startX >= width || startY >= height) return null
  const startIndex = startY * width + startX
  if (gapClosingThreshold <= 0) return floodBinaryRegion(width, height, startIndex, matches)

  const matching = new Uint8Array(width * height)
  for (let index = 0; index < matching.length; index += 1) matching[index] = matches(index) ? 1 : 0
  if (matching[startIndex] === 0) return null
  const virtualBarrier = virtualGapBarrier(matching, width, height, normalizeGapClosingThreshold(gapClosingThreshold))
  const region = floodBinaryRegion(width, height, startIndex, (index) => matching[index] === 1, virtualBarrier)
    ?? floodBinaryRegion(width, height, startIndex, (index) => matching[index] === 1)
  if (region) includeAdjacentVirtualBarrier(region, virtualBarrier, width, height)
  return region
}
