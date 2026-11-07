// electron-vite copies the file next to the main bundle and resolves this to its path.
import wasmPath from './ghostty-vt.wasm?asset'

export const LIBGHOSTTY_VT_WASM_PATH: string = wasmPath
