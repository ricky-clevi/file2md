/**
 * Browser API polyfills for Node.js environment
 * Provides minimal implementations of browser APIs needed by hwp.js
 */

/**
 * IntersectionObserver polyfill for Node.js
 * Provides a minimal implementation that doesn't actually observe anything
 */
export class IntersectionObserver {
  public root: Element | Document | null = null;
  public rootMargin: string = '0px';
  public thresholds: ReadonlyArray<number> = [0];
  
  private callback: IntersectionObserverCallback;
  private options: IntersectionObserverInit | undefined;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    
    if (options) {
      this.root = options.root || null;
      this.rootMargin = options.rootMargin || '0px';
      this.thresholds = Array.isArray(options.threshold) ? options.threshold : [options.threshold || 0];
    }
  }

  observe(target: Element): void {
    // In Node.js, we immediately trigger the callback with a mock entry
    // indicating the element is intersecting
    const mockEntry: IntersectionObserverEntry = {
      target,
      boundingClientRect: {
        x: 0, y: 0, width: 100, height: 100,
        top: 0, left: 0, bottom: 100, right: 100,
        toJSON: () => ({})
      } as DOMRectReadOnly,
      intersectionRatio: 1.0,
      intersectionRect: {
        x: 0, y: 0, width: 100, height: 100,
        top: 0, left: 0, bottom: 100, right: 100,
        toJSON: () => ({})
      } as DOMRectReadOnly,
      isIntersecting: true,
      rootBounds: null,
      time: Date.now()
    };

    // Trigger callback asynchronously
    setTimeout(() => {
      this.callback([mockEntry], this as any);
    }, 0);
  }

  unobserve(target: Element): void {
    // No-op in Node.js
  }

  disconnect(): void {
    // No-op in Node.js
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/**
 * ResizeObserver polyfill for Node.js
 */
export class ResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element, options?: ResizeObserverOptions): void {
    // Mock resize entry
    const mockEntry: ResizeObserverEntry = {
      target,
      contentRect: {
        x: 0, y: 0, width: 100, height: 100,
        top: 0, left: 0, bottom: 100, right: 100,
        toJSON: () => ({})
      } as DOMRectReadOnly,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: []
    };

    setTimeout(() => {
      this.callback([mockEntry], this);
    }, 0);
  }

  unobserve(target: Element): void {
    // No-op
  }

  disconnect(): void {
    // No-op
  }
}

/**
 * MutationObserver polyfill for Node.js
 */
export class MutationObserver {
  private callback: MutationCallback;

  constructor(callback: MutationCallback) {
    this.callback = callback;
  }

  observe(target: Node, options?: MutationObserverInit): void {
    // No-op in Node.js - just don't call the callback
  }

  disconnect(): void {
    // No-op
  }

  takeRecords(): MutationRecord[] {
    return [];
  }
}

/**
 * Setup polyfills in the global scope
 * This should be called before importing hwp.js
 */
export function setupBrowserPolyfills(): void {
  // Only set up if not already defined (avoid overriding in browser environment)
  if (typeof global !== 'undefined') {
    if (!global.IntersectionObserver) {
      global.IntersectionObserver = IntersectionObserver as any;
    }
    
    if (!global.ResizeObserver) {
      global.ResizeObserver = ResizeObserver as any;
    }
    
    if (!global.MutationObserver) {
      global.MutationObserver = MutationObserver as any;
    }

    // Add requestAnimationFrame polyfill if needed
    if (!global.requestAnimationFrame) {
      global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
        return setTimeout(callback, 16) as any; // ~60fps
      };
    }

    if (!global.cancelAnimationFrame) {
      global.cancelAnimationFrame = (id: number): void => {
        clearTimeout(id);
      };
    }

    // Add performance.now polyfill if needed
    if (!global.performance) {
      global.performance = {
        now: () => Date.now(),
        timeOrigin: Date.now()
      } as any;
    }
  }
}

/**
 * Cleanup polyfills from global scope
 */
export function cleanupBrowserPolyfills(): void {
  if (typeof global !== 'undefined') {
    // Note: We don't actually delete these as other code might depend on them
    // This is mainly for documentation purposes
  }
}