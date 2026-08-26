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

const neighborTransitionCount = (index: number, width: number, mask: Uint8Array): number => {
  const north = mask[index - width]
  const northEast = mask[index - width + 1]
  const east = mask[index + 1]
  const southEast = mask[index + width + 1]
  const south = mask[index + width]
  const southWest = mask[index + width - 1]
  const west = mask[index - 1]
  const northWest = mask[index - width - 1]
  return Number(north === 0 && northEast === 1)
    + Number(northEast === 0 && east === 1)
    + Number(east === 0 && southEast === 1)
    + Number(southEast === 0 && south === 1)
    + Number(south === 0 && southWest === 1)
    + Number(southWest === 0 && west === 1)
    + Number(west === 0 && northWest === 1)
    + Number(northWest === 0 && north === 1)
}

const thinBarrier = (barrier: Uint8Array, width: number, height: number): Uint8Array => {
  const paddedWidth = width + 2
  const paddedHeight = height + 2
  const skeleton = new Uint8Array(paddedWidth * paddedHeight)
  for (let y = 0; y < height; y += 1) {
    skeleton.set(barrier.subarray(y * width, (y + 1) * width), (y + 1) * paddedWidth + 1)
  }

  const removals = new Uint32Array(skeleton.length)
  const thinningPass = (secondPass: boolean): number => {
    let removalCount = 0
    for (let y = 1; y + 1 < paddedHeight; y += 1) for (let x = 1; x + 1 < paddedWidth; x += 1) {
      const index = y * paddedWidth + x
      if (skeleton[index] !== 1) continue
      const north = skeleton[index - paddedWidth]
      const northEast = skeleton[index - paddedWidth + 1]
      const east = skeleton[index + 1]
      const southEast = skeleton[index + paddedWidth + 1]
      const south = skeleton[index + paddedWidth]
      const southWest = skeleton[index + paddedWidth - 1]
      const west = skeleton[index - 1]
      const northWest = skeleton[index - paddedWidth - 1]
      const neighborCount = north + northEast + east + southEast + south + southWest + west + northWest
      if (neighborCount < 2 || neighborCount > 6) continue
      const transitions = Number(north === 0 && northEast === 1)
        + Number(northEast === 0 && east === 1)
        + Number(east === 0 && southEast === 1)
        + Number(southEast === 0 && south === 1)
        + Number(south === 0 && southWest === 1)
        + Number(southWest === 0 && west === 1)
        + Number(west === 0 && northWest === 1)
        + Number(northWest === 0 && north === 1)
      if (transitions !== 1) continue
      if (neighborCount === 2) continue
      if (secondPass) {
        if (north * east * west !== 0 || north * south * west !== 0) continue
      } else if (north * east * south !== 0 || east * south * west !== 0) continue
      removals[removalCount++] = index
    }
    for (let index = 0; index < removalCount; index += 1) skeleton[removals[index]] = 0
    return removalCount
  }

  let changed = false
  do {
    changed = thinningPass(false) > 0
    changed = thinningPass(true) > 0 || changed
  } while (changed)

  const result = new Uint8Array(barrier.length)
  for (let y = 0; y < height; y += 1) {
    result.set(skeleton.subarray((y + 1) * paddedWidth + 1, (y + 1) * paddedWidth + width + 1), y * width)
  }
  return result
}

const endpointDirection = (
  endpoint: PixelPoint,
  skeleton: Uint8Array,
  width: number,
  height: number,
  sampleDepth: number
): { x: number; y: number } | null => {
  const queue: number[] = [endpoint.index]
  const distances: number[] = [0]
  const visited = new Set<number>(queue)
  let read = 0
  let displacementX = 0
  let displacementY = 0
  let visitedCount = 0
  while (read < queue.length) {
    const index = queue[read]
    const distance = distances[read++]
    const x = index % width
    const y = Math.floor(index / width)
    displacementX += x - endpoint.x
    displacementY += y - endpoint.y
    visitedCount += 1
    if (distance >= sampleDepth) continue
    for (const neighbor of neighbors8(index, width, height, skeleton)) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      queue.push(neighbor)
      distances.push(distance + 1)
    }
  }
  if (visitedCount < 2) return null
  const direction = { x: -displacementX / visitedCount, y: -displacementY / visitedCount }
  return Math.hypot(direction.x, direction.y) >= 0.5 ? direction : null
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

const directionCosine = (direction: { x: number; y: number }, deltaX: number, deltaY: number): number => {
  const directionLength = Math.hypot(direction.x, direction.y)
  const deltaLength = Math.hypot(deltaX, deltaY)
  return directionLength > 0 && deltaLength > 0
    ? (direction.x * deltaX + direction.y * deltaY) / (directionLength * deltaLength)
    : -1
}

const PAIR_DIRECTION_COSINE = Math.cos(Math.PI / 6)

const directionMatches = (direction: { x: number; y: number }, deltaX: number, deltaY: number): boolean => (
  directionCosine(direction, deltaX, deltaY) >= PAIR_DIRECTION_COSINE
)

const bridgePathBetweenEndpoints = (
  from: PixelPoint,
  to: PixelPoint,
  barrier: Uint8Array,
  width: number,
  threshold: number
): PixelPoint[] | null => {
  const path: PixelPoint[] = []
  const line = rasterLine(from, to)
  let leftOriginStroke = false
  let reachedTargetStroke = false
  for (let pointIndex = 1; pointIndex < line.length; pointIndex += 1) {
    const point = line[pointIndex]
    const isBarrier = barrier[point.y * width + point.x] === 1
    if (!leftOriginStroke) {
      if (isBarrier) continue
      leftOriginStroke = true
      path.push(point)
      continue
    }
    if (!isBarrier) {
      if (reachedTargetStroke) return null
      path.push(point)
      if (path.length > threshold) return null
      continue
    }
    reachedTargetStroke = true
  }
  return reachedTargetStroke && path.length > 0 && path.length <= threshold ? path : null
}

const rotatedDirection = (direction: { x: number; y: number }, angle: number): { x: number; y: number } => {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: direction.x * cosine - direction.y * sine,
    y: direction.x * sine + direction.y * cosine
  }
}

const rayTarget = (
  endpoint: PixelPoint,
  direction: { x: number; y: number },
  width: number,
  height: number,
  maximumSteps: number
): PixelPoint | null => {
  const length = Math.hypot(direction.x, direction.y)
  if (length === 0) return null
  const normalizedX = direction.x / length
  const normalizedY = direction.y / length
  const largestComponent = Math.max(Math.abs(normalizedX), Math.abs(normalizedY))
  const stepX = normalizedX / largestComponent
  const stepY = normalizedY / largestComponent
  let steps = maximumSteps
  if (stepX > 0) steps = Math.min(steps, (width - 1 - endpoint.x) / stepX)
  else if (stepX < 0) steps = Math.min(steps, endpoint.x / -stepX)
  if (stepY > 0) steps = Math.min(steps, (height - 1 - endpoint.y) / stepY)
  else if (stepY < 0) steps = Math.min(steps, endpoint.y / -stepY)
  const x = Math.round(endpoint.x + stepX * steps)
  const y = Math.round(endpoint.y + stepY * steps)
  if (x === endpoint.x && y === endpoint.y) return null
  return { x, y, index: y * width + x }
}

const bridgePathAlongRay = (
  endpoint: PixelPoint,
  target: PixelPoint,
  barrier: Uint8Array,
  virtualBarrier: Uint8Array,
  width: number,
  threshold: number
): { path: PixelPoint[]; hitIndex: number } | null => {
  const path: PixelPoint[] = []
  let leftOriginStroke = false
  for (const point of rasterLine(endpoint, target).slice(1)) {
    const index = point.y * width + point.x
    const isBarrier = barrier[index] === 1 || virtualBarrier[index] === 1
    if (!leftOriginStroke) {
      if (isBarrier) continue
      leftOriginStroke = true
      path.push(point)
      continue
    }
    if (isBarrier) return path.length > 0 && path.length <= threshold ? { path, hitIndex: index } : null
    path.push(point)
    if (path.length > threshold) return null
  }
  return null
}

// Adapted from OpenToonz TAutocloser: topology-preserving thinning, oriented
// skeleton endpoints, endpoint pairing, then endpoint-to-stroke ray searches.
// OpenToonz is BSD-3-Clause licensed; see THIRD_PARTY_NOTICES.md.
const virtualGapBarrier = (matching: Uint8Array, width: number, height: number, threshold: number): Uint8Array => {
  const barrier = new Uint8Array(matching.length)
  for (let index = 0; index < matching.length; index += 1) barrier[index] = matching[index] === 1 ? 0 : 1
  const skeleton = thinBarrier(barrier, width, height)
  const sampleDepth = Math.max(1, Math.min(threshold - 1, 8))
  const endpoints: Array<PixelPoint & { direction: { x: number; y: number } | null; isolated: boolean }> = []
  for (let index = 0; index < skeleton.length; index += 1) {
    if (skeleton[index] !== 1) continue
    const skeletonNeighbors = neighbors8(index, width, height, skeleton)
    const endpoint = { x: index % width, y: Math.floor(index / width), index }
    if (endpoint.x === 0 || endpoint.y === 0 || endpoint.x === width - 1 || endpoint.y === height - 1) continue
    const isolated = skeletonNeighbors.length === 0
    if (!isolated && (skeletonNeighbors.length > 3 || neighborTransitionCount(index, width, skeleton) !== 1)) continue
    endpoints.push({
      ...endpoint,
      direction: isolated ? null : endpointDirection(endpoint, skeleton, width, height, sampleDepth),
      isolated
    })
  }
  const endpointAt = new Int32Array(barrier.length).fill(-1)
  for (let index = 0; index < endpoints.length; index += 1) endpointAt[endpoints[index].index] = index
  const candidates: Array<{ first: number; second: number; gap: number; distance: number; alignment: number; path: PixelPoint[] }> = []
  const searchRadius = threshold + 2
  for (let first = 0; first < endpoints.length; first += 1) {
    const from = endpoints[first]
    for (let second = first + 1; second < endpoints.length; second += 1) {
      const to = endpoints[second]
      const deltaX = to.x - from.x
      const deltaY = to.y - from.y
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) > searchRadius) continue
      if ((from.direction && !directionMatches(from.direction, deltaX, deltaY))
        || (to.direction && !directionMatches(to.direction, -deltaX, -deltaY))) continue
      const path = bridgePathBetweenEndpoints(from, to, barrier, width, threshold)
      if (!path) continue
      const firstAlignment = from.direction ? directionCosine(from.direction, deltaX, deltaY) : 1
      const secondAlignment = to.direction ? directionCosine(to.direction, -deltaX, -deltaY) : 1
      candidates.push({
        first,
        second,
        gap: path.length,
        distance: Math.hypot(deltaX, deltaY),
        alignment: Math.min(firstAlignment, secondAlignment),
        path
      })
    }
  }
  candidates.sort((left, right) => left.gap - right.gap || right.alignment - left.alignment || left.distance - right.distance)
  const uses = new Uint8Array(endpoints.length)
  const inferredDirections: Array<{ x: number; y: number } | null> = Array.from({ length: endpoints.length }, () => null)
  const endpointAvailable = (endpointIndex: number, towardOther: { x: number; y: number }): boolean => {
    if (!endpoints[endpointIndex].isolated) return uses[endpointIndex] === 0
    if (uses[endpointIndex] === 0) return true
    const inferredDirection = inferredDirections[endpointIndex]
    return uses[endpointIndex] === 1
      && Boolean(inferredDirection && directionMatches(inferredDirection, -towardOther.x, -towardOther.y))
  }
  const useEndpoint = (endpointIndex: number, towardOther: { x: number; y: number }): void => {
    if (endpoints[endpointIndex].isolated) {
      inferredDirections[endpointIndex] ??= { ...towardOther }
      uses[endpointIndex] += 1
      return
    }
    uses[endpointIndex] = 1
  }
  const virtualBarrier = new Uint8Array(matching.length)
  for (const candidate of candidates) {
    const from = endpoints[candidate.first]
    const to = endpoints[candidate.second]
    const firstTowardSecond = { x: to.x - from.x, y: to.y - from.y }
    const secondTowardFirst = { x: -firstTowardSecond.x, y: -firstTowardSecond.y }
    if (!endpointAvailable(candidate.first, firstTowardSecond) || !endpointAvailable(candidate.second, secondTowardFirst)) continue
    if (candidate.path.some((point) => virtualBarrier[point.y * width + point.x] === 1)) continue
    useEndpoint(candidate.first, firstTowardSecond)
    useEndpoint(candidate.second, secondTowardFirst)
    for (const point of candidate.path) virtualBarrier[point.y * width + point.x] = 1
  }

  const rayHalfAngle = Math.PI / 3
  const rayAngleStep = Math.max(Math.PI / 180, Math.atan2(1, threshold + 1))
  const rayCandidates: Array<{ endpoint: number; gap: number; angle: number; hitIndex: number; path: PixelPoint[] }> = []
  for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex += 1) {
    const endpoint = endpoints[endpointIndex]
    if (uses[endpointIndex] > 0 || endpoint.isolated || !endpoint.direction) continue
    let best: { gap: number; angle: number; hitIndex: number; path: PixelPoint[] } | null = null
    const seenTargets = new Set<number>()
    const angleCount = Math.ceil(rayHalfAngle / rayAngleStep)
    for (let angleIndex = 0; angleIndex <= angleCount; angleIndex += 1) {
      const angles = angleIndex === 0 ? [0] : [angleIndex * rayAngleStep, -angleIndex * rayAngleStep]
      for (const angle of angles) {
        if (Math.abs(angle) > rayHalfAngle + Number.EPSILON) continue
        const target = rayTarget(endpoint, rotatedDirection(endpoint.direction, angle), width, height, threshold + 1)
        if (!target || seenTargets.has(target.index)) continue
        seenTargets.add(target.index)
        const bridge = bridgePathAlongRay(endpoint, target, barrier, virtualBarrier, width, threshold)
        if (!bridge) continue
        if (!best || bridge.path.length < best.gap
          || (bridge.path.length === best.gap && Math.abs(angle) < Math.abs(best.angle))) {
          best = { gap: bridge.path.length, angle, hitIndex: bridge.hitIndex, path: bridge.path }
        }
      }
    }
    if (best) rayCandidates.push({ endpoint: endpointIndex, ...best })
  }
  rayCandidates.sort((left, right) => left.gap - right.gap || Math.abs(left.angle) - Math.abs(right.angle))
  for (const candidate of rayCandidates) {
    if (uses[candidate.endpoint] > 0 || candidate.path.some((point) => virtualBarrier[point.y * width + point.x] === 1)) continue
    uses[candidate.endpoint] = 1
    const hitEndpoint = endpointAt[candidate.hitIndex]
    if (hitEndpoint >= 0 && !endpoints[hitEndpoint].isolated) uses[hitEndpoint] = 1
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

export const includeSmartClosurePixels = (
  selected: Uint8Array,
  virtualBarrier: Uint8Array,
  matching: Uint8Array,
  width: number,
  height: number,
  threshold: number
): void => {
  const queue = new Uint32Array(virtualBarrier.length)
  const activeVirtualBarrier = new Uint8Array(virtualBarrier.length)
  const touchesSelected = (index: number): boolean => {
    return neighbors8(index, width, height, selected).length > 0
  }
  const activateVirtualBarrier = (seed: number): void => {
    if (virtualBarrier[seed] !== 1 || activeVirtualBarrier[seed] === 1) return
    let read = 0
    let written = 1
    activeVirtualBarrier[seed] = 1
    queue[0] = seed
    while (read < written) {
      const index = queue[read++]
      selected[index] = 1
      for (const neighbor of neighbors8(index, width, height, virtualBarrier)) {
        if (activeVirtualBarrier[neighbor] === 1) continue
        activeVirtualBarrier[neighbor] = 1
        queue[written++] = neighbor
      }
    }
  }
  for (let index = 0; index < virtualBarrier.length; index += 1) {
    if (virtualBarrier[index] === 1 && touchesSelected(index)) activateVirtualBarrier(index)
  }

  const maximumPocketArea = Math.max(8, threshold * 4)
  const maximumPocketSpan = threshold + 2
  const pocketVisited = new Uint8Array(matching.length)
  const pocketQueue = new Uint32Array(matching.length)
  const visitPocket = (seed: number): void => {
    if (matching[seed] !== 1 || selected[seed] === 1 || activeVirtualBarrier[seed] === 1 || pocketVisited[seed] === 1) return
    let pocketRead = 0
    let pocketWritten = 1
    let minimumX = seed % width
    let maximumX = minimumX
    let minimumY = Math.floor(seed / width)
    let maximumY = minimumY
    let touchesCanvasEdge = false
    let touchesFilledRegion = false
    let touchesActiveClosure = false
    let containsClosure = false
    pocketVisited[seed] = 1
    pocketQueue[0] = seed
    const pushPocket = (index: number): void => {
      if (matching[index] !== 1 || selected[index] === 1 || activeVirtualBarrier[index] === 1 || pocketVisited[index] === 1) return
      pocketVisited[index] = 1
      pocketQueue[pocketWritten++] = index
    }
    while (pocketRead < pocketWritten) {
      const index = pocketQueue[pocketRead++]
      const x = index % width
      const y = Math.floor(index / width)
      minimumX = Math.min(minimumX, x)
      maximumX = Math.max(maximumX, x)
      minimumY = Math.min(minimumY, y)
      maximumY = Math.max(maximumY, y)
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesCanvasEdge = true
      containsClosure ||= virtualBarrier[index] === 1
      for (const neighbor of neighbors8(index, width, height, selected)) {
        touchesFilledRegion = true
        if (activeVirtualBarrier[neighbor] === 1) touchesActiveClosure = true
      }
      if (x > 0) pushPocket(index - 1)
      if (x + 1 < width) pushPocket(index + 1)
      if (y > 0) pushPocket(index - width)
      if (y + 1 < height) pushPocket(index + width)
    }
    if (!touchesFilledRegion || (!containsClosure && !touchesActiveClosure)
      || touchesCanvasEdge || pocketWritten > maximumPocketArea
      || maximumX - minimumX + 1 > maximumPocketSpan
      || maximumY - minimumY + 1 > maximumPocketSpan) return
    for (let index = 0; index < pocketWritten; index += 1) {
      const pocketIndex = pocketQueue[index]
      selected[pocketIndex] = 1
      if (virtualBarrier[pocketIndex] === 1) activateVirtualBarrier(pocketIndex)
    }
  }
  for (let index = 0; index < virtualBarrier.length; index += 1) {
    if (virtualBarrier[index] === 1 && activeVirtualBarrier[index] !== 1) visitPocket(index)
  }
  for (let index = 0; index < activeVirtualBarrier.length; index += 1) {
    if (activeVirtualBarrier[index] !== 1) continue
    for (const neighbor of neighbors8(index, width, height, matching)) visitPocket(neighbor)
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
  if (region) includeSmartClosurePixels(region, virtualBarrier, matching, width, height, normalizeGapClosingThreshold(gapClosingThreshold))
  return region
}
