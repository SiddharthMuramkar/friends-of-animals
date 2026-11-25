export type Point = { x: number; y: number };
type Size = { width: number; height: number };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function zoomBy(current: number, delta: number) {
  return clamp(current + delta, 1, 4);
}
export function pinchZoom(
  startZoom: number,
  startDistance: number,
  distance: number
) {
  return startDistance > 0
    ? clamp((startZoom * distance) / startDistance, 1, 4)
    : startZoom;
}
export function clampPan(
  point: Point,
  zoom: number,
  image: Size,
  viewport: Size
): Point {
  const x = Math.max(0, (image.width * zoom - viewport.width) / 2),
    y = Math.max(0, (image.height * zoom - viewport.height) / 2);
  return { x: clamp(point.x, -x, x), y: clamp(point.y, -y, y) };
}
