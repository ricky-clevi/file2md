import { AsyncLocalStorage } from 'node:async_hooks';
import { ResourceLimitError, SecurityError } from '../types/errors.js';
import type { ConvertOptions } from '../types/interfaces.js';

/**
 * Resource monitoring configuration
 */
export interface ResourceConfig {
  /** Maximum file size in bytes */
  readonly maxFileSize: number;
  /** Maximum memory usage in bytes */
  readonly maxMemoryUsage: number;
  /** Processing timeout in milliseconds */
  readonly timeout: number;
  /** Memory check interval in milliseconds */
  readonly memoryCheckInterval: number;
}

/**
 * Default resource configuration - conservative for backwards compatibility
 */
export const DEFAULT_RESOURCE_CONFIG: ResourceConfig = {
  maxFileSize: 100 * 1024 * 1024, // 100MB
  maxMemoryUsage: 500 * 1024 * 1024, // 500MB
  timeout: 60000, // 60 seconds
  memoryCheckInterval: 1000 // Check every 1 second
};

/**
 * Strict resource configuration for high-security environments
 */
export const STRICT_RESOURCE_CONFIG: ResourceConfig = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxMemoryUsage: 100 * 1024 * 1024, // 100MB
  timeout: 30000, // 30 seconds
  memoryCheckInterval: 500 // Check every 500ms
};

/**
 * Create resource configuration from ConvertOptions
 */
export function createResourceConfig(options: ConvertOptions): ResourceConfig {
  return {
    maxFileSize: options.maxFileSize ?? DEFAULT_RESOURCE_CONFIG.maxFileSize,
    maxMemoryUsage:
      options.maxMemoryUsage ?? DEFAULT_RESOURCE_CONFIG.maxMemoryUsage,
    timeout: options.timeout ?? DEFAULT_RESOURCE_CONFIG.timeout,
    memoryCheckInterval: DEFAULT_RESOURCE_CONFIG.memoryCheckInterval
  };
}

/**
 * Resource monitoring and enforcement class
 */
export class ResourceMonitor {
  private readonly config: ResourceConfig;
  private readonly startTime: number;
  private readonly initialMemory: NodeJS.MemoryUsage;
  private memoryCheckTimer?: NodeJS.Timeout;
  private isMonitoring = false;
  private failure?: Error;

  constructor(config: ResourceConfig) {
    for (const [name, value] of Object.entries(config)) {
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new SecurityError(
          `Invalid resource limit: ${name}`,
          'INVALID_LIMIT'
        );
    }
    this.config = config;
    this.startTime = Date.now();
    this.initialMemory = process.memoryUsage();
  }

  /**
   * Validate initial file size
   */
  validateFileSize(buffer: Buffer): void {
    if (buffer.length > this.config.maxFileSize) {
      throw new ResourceLimitError(
        'file size',
        this.config.maxFileSize,
        buffer.length
      );
    }
  }

  /**
   * Check current memory usage
   */
  checkMemoryUsage(): void {
    const currentMemory = process.memoryUsage();

    // Check heap usage
    if (currentMemory.heapUsed > this.config.maxMemoryUsage) {
      throw new ResourceLimitError(
        'heap memory',
        this.config.maxMemoryUsage,
        currentMemory.heapUsed
      );
    }

    // Check external memory (for native modules like Sharp)
    if (currentMemory.external > this.config.maxMemoryUsage * 0.5) {
      throw new ResourceLimitError(
        'external memory',
        Math.floor(this.config.maxMemoryUsage * 0.5),
        currentMemory.external
      );
    }

    // Check RSS (Resident Set Size) for overall process memory
    if (currentMemory.rss > this.config.maxMemoryUsage * 1.5) {
      throw new ResourceLimitError(
        'resident memory',
        Math.floor(this.config.maxMemoryUsage * 1.5),
        currentMemory.rss
      );
    }
  }

  /**
   * Check processing timeout
   */
  checkTimeout(): void {
    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.config.timeout) {
      throw new ResourceLimitError(
        'processing time',
        this.config.timeout,
        elapsed
      );
    }
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring(onLimit?: (error: Error) => void): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.memoryCheckTimer = setInterval(
      () => {
        try {
          this.checkMemoryUsage();
          this.checkTimeout();
        } catch (error) {
          // Stop monitoring on error and let it propagate
          this.stopMonitoring();
          this.failure =
            error instanceof Error ? error : new Error(String(error));
          onLimit?.(this.failure);
        }
      },
      Math.min(this.config.memoryCheckInterval, this.config.timeout + 1)
    );
    if (!onLimit) this.memoryCheckTimer.unref();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
      this.memoryCheckTimer = undefined;
    }
    this.isMonitoring = false;
  }

  /**
   * Perform a comprehensive resource check
   */
  performCheck(): void {
    if (this.failure) throw this.failure;
    this.checkMemoryUsage();
    this.checkTimeout();
  }

  /**
   * Get resource usage statistics
   */
  getResourceStats(): {
    readonly elapsedTime: number;
    readonly memoryUsage: NodeJS.MemoryUsage;
    readonly memoryDelta: {
      readonly heapUsed: number;
      readonly heapTotal: number;
      readonly external: number;
      readonly rss: number;
    };
  } {
    const currentMemory = process.memoryUsage();
    const elapsedTime = Date.now() - this.startTime;

    return {
      elapsedTime,
      memoryUsage: currentMemory,
      memoryDelta: {
        heapUsed: currentMemory.heapUsed - this.initialMemory.heapUsed,
        heapTotal: currentMemory.heapTotal - this.initialMemory.heapTotal,
        external: currentMemory.external - this.initialMemory.external,
        rss: currentMemory.rss - this.initialMemory.rss
      }
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopMonitoring();
  }
}

/**
 * Create and configure a resource monitor
 */
export function createResourceMonitor(
  options: ConvertOptions
): ResourceMonitor {
  const config = createResourceConfig(options);
  return new ResourceMonitor(config);
}

/**
 * Execute a function with resource monitoring
 */
export async function withResourceMonitoring<T>(
  options: ConvertOptions,
  operation: (monitor: ResourceMonitor) => Promise<T>
): Promise<T> {
  const monitor = createResourceMonitor(options);

  try {
    monitor.performCheck();
    const failure = new Promise<never>((_resolve, reject) =>
      monitor.startMonitoring(reject)
    );
    const result = await Promise.race([
      activeMonitor.run(monitor, () => operation(monitor)),
      failure
    ]);
    monitor.performCheck();
    return result;
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      throw error;
    }

    // Check if we hit resource limits during error
    try {
      monitor.performCheck();
    } catch (resourceError) {
      if (resourceError instanceof ResourceLimitError) {
        throw resourceError;
      }
    }

    throw error;
  } finally {
    monitor.dispose();
  }
}

/**
 * Validate buffer size and content safely
 */
export function validateBuffer(
  buffer: Buffer,
  options: ConvertOptions,
  contentType?: string
): void {
  const config = createResourceConfig(options);

  // Check file size
  if (buffer.length > config.maxFileSize) {
    throw new ResourceLimitError(
      'file size',
      config.maxFileSize,
      buffer.length
    );
  }

  // Basic content validation
  if (buffer.length === 0) {
    throw new SecurityError('Empty file detected', 'EMPTY_FILE', 'medium');
  }

  // Check for null bytes (potential binary confusion)
  if (contentType === 'text' || contentType === 'xml') {
    const nullByteIndex = buffer.indexOf(0);
    if (nullByteIndex !== -1 && nullByteIndex < Math.min(1024, buffer.length)) {
      throw new SecurityError(
        `Null byte detected at position ${nullByteIndex} in text content`,
        'NULL_BYTE_DETECTED',
        'medium'
      );
    }
  }
}

/**
 * Memory-aware processing wrapper
 */
export async function processWithMemoryLimit<T>(
  options: ConvertOptions,
  operation: () => Promise<T> | T
): Promise<T> {
  return withResourceMonitoring(options, async () => operation());
}

const activeMonitor = new AsyncLocalStorage<ResourceMonitor>();
export function checkResources(): void {
  activeMonitor.getStore()?.performCheck();
}
