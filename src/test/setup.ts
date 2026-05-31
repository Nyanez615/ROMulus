import "@testing-library/jest-dom";
// Vite define globals not injected in test environment
(globalThis as Record<string, unknown>).__APP_VERSION__ = "0.0.0-test";
