// Werkzeug-Hülle um hooks/lint.ts (eine Quelle für Tests und Werkzeuge).
import { ALL_PROPS } from '../../hooks/library.ts'
import { lintFrames as lint } from '../../hooks/lint.ts'

export const lintFrames = (frames, props = ALL_PROPS) => lint(frames, props)
