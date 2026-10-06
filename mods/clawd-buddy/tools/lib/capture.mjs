// Werkzeug-Hülle um hooks/capture.ts (eine Quelle für Tests und Werkzeuge): Clip mit der echten Engine abspielen und jedes Bild aufnehmen.
import { ALL_CLIPS, ALL_PROPS } from '../../hooks/library.ts'
import { captureClip as capture, mulberry32, newEngine as engine } from '../../hooks/capture.ts'

const LIB = { clips: ALL_CLIPS, props: ALL_PROPS }

export { mulberry32 }
export const newEngine = (seed = 1, extra = {}) => engine(LIB, seed, extra)
export const captureClip = (name, opts = {}) => capture(LIB, name, opts)
