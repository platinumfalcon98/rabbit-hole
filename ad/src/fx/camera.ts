// The camera: keyframed centre and zoom over the world (the UI's coordinate
// space), eased in and out; it follows the cursor because scenes key it to
// the cursor's targets. Pure.
export interface CamKey { frame: number; x: number; y: number; zoom: number; rot?: number }

const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function cameraAt(frame: number, keys: CamKey[]): Required<CamKey> {
  const fill = (k: CamKey): Required<CamKey> => ({ rot: 0, ...k })
  if (frame <= keys[0].frame) return fill({ ...keys[0], frame })
  for (let i = 0; i < keys.length - 1; i++) {
    const a = fill(keys[i]), b = fill(keys[i + 1])
    if (frame > b.frame) continue
    const t = inOut((frame - a.frame) / Math.max(1, b.frame - a.frame))
    // zoom eases in log space, so a push-in feels even
    const z = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * t)
    return { frame, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, zoom: z, rot: a.rot + (b.rot - a.rot) * t }
  }
  return fill({ ...keys[keys.length - 1], frame })
}

/** CSS transform for the world container: world point (x, y) lands at the frame centre. */
export function cameraTransform(c: Required<CamKey>, W: number, H: number): string {
  return `translate(${W / 2}px, ${H / 2}px) rotate(${c.rot}deg) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`
}
