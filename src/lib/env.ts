/** True when running inside the Tauri native window. False in browser dev preview. */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
