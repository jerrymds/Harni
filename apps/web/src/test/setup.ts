import '@testing-library/jest-dom/vitest';

// Polyfills and mocks for DOM environment
if (typeof window !== 'undefined') {
  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // Mock ResizeObserver
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = MockResizeObserver as any;

  // Mock WebSocket
  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((err: any) => void) | null = null;
    send() {}
    close() {}
  }
  (window as any).WebSocket = MockWebSocket;
}
