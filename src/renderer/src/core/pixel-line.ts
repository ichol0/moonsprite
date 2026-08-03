export interface PixelLinePoint { x: number; y: number }

/**
 * 将主轴像素平均分配到每一级台阶，避免 Bresenham 在线段两端产生明显短阶。
 * 计算始终从主轴较小的一端开始，因此反向绘制会得到完全相同的像素集合。
 */
export function balancedStairLinePoints(from: PixelLinePoint, to: PixelLinePoint): PixelLinePoint[] {
  const deltaX = Math.abs(to.x - from.x)
  const deltaY = Math.abs(to.y - from.y)
  const xMajor = deltaX >= deltaY
  const reverse = xMajor ? from.x > to.x : from.y > to.y
  const start = reverse ? to : from
  const end = reverse ? from : to
  const majorLength = (xMajor ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) + 1
  const minorSteps = xMajor ? Math.abs(end.y - start.y) : Math.abs(end.x - start.x)
  const stairCount = minorSteps + 1
  const minorDirection = xMajor
    ? end.y >= start.y ? 1 : -1
    : end.x >= start.x ? 1 : -1
  const points: PixelLinePoint[] = []
  let majorOffset = 0

  for (let stair = 0; stair < stairCount; stair += 1) {
    const stairEnd = Math.floor(((stair + 1) * majorLength) / stairCount)
    while (majorOffset < stairEnd) {
      points.push(xMajor
        ? { x: start.x + majorOffset, y: start.y + stair * minorDirection }
        : { x: start.x + stair * minorDirection, y: start.y + majorOffset })
      majorOffset += 1
    }
  }

  return reverse ? points.reverse() : points
}
