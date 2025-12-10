import * as fs from 'fs';
import * as path from 'path';

export interface GatekeeperResult {
  passed: boolean;
  error?: string;
  timestamp: number;
}

export interface StateFile {
  results: Record<string, GatekeeperResult>;
  dependencies: Record<string, string[]>;
}

export interface FailedDependencyInfo {
  key: string;
  error?: string;
  chain: string[];
}

const STATE_FILE_NAME = '.playwright-gatekeeper-state.json';
const LOCK_FILE_NAME = '.playwright-gatekeeper-state.lock';

export class GatekeeperState {
  private stateFilePath: string;
  private lockFilePath: string;

  constructor(baseDir: string = process.cwd()) {
    this.stateFilePath = path.join(baseDir, STATE_FILE_NAME);
    this.lockFilePath = path.join(baseDir, LOCK_FILE_NAME);
  }

  /**
   * Acquire a file lock for atomic operations
   */
  private acquireLock(timeoutMs: number = 5000): boolean {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to create lock file exclusively
        fs.writeFileSync(this.lockFilePath, String(process.pid), { flag: 'wx' });
        return true;
      } catch {
        // Lock exists, wait and retry
        const delay = Math.random() * 20 + 5;
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy wait
        }
      }
    }

    return false;
  }

  /**
   * Release the file lock
   */
  private releaseLock(): void {
    try {
      fs.unlinkSync(this.lockFilePath);
    } catch {
      // Ignore - lock may not exist
    }
  }

  /**
   * Execute a function with file locking
   */
  private withLock<T>(fn: () => T): T {
    if (!this.acquireLock()) {
      throw new Error('Failed to acquire lock for gatekeeper state');
    }

    try {
      return fn();
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Initialize/reset the state file at the start of a test run
   */
  initialize(): void {
    const initialState: StateFile = {
      results: {},
      dependencies: {},
    };
    this.writeState(initialState);
  }

  /**
   * Clean up the state file after a test run
   */
  cleanup(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        fs.unlinkSync(this.stateFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Read the current state from the file
   */
  private readState(): StateFile {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const content = fs.readFileSync(this.stateFilePath, 'utf-8');
        return JSON.parse(content) as StateFile;
      }
    } catch {
      // If file is corrupted or being written, return empty state
    }
    return { results: {}, dependencies: {} };
  }

  /**
   * Write state to file atomically with retry logic for concurrent access
   */
  private writeState(state: StateFile): void {
    const tempPath = `${this.stateFilePath}.tmp.${process.pid}.${Date.now()}`;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tempPath, this.stateFilePath);
        return;
      } catch {
        // Clean up temp file on error
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch {
          // Ignore
        }

        if (attempt < maxRetries - 1) {
          // Small random delay before retry to reduce contention
          const delay = Math.random() * 50 + 10;
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait (sync)
          }
        }
      }
    }

    throw new Error(`Failed to write gatekeeper state after ${maxRetries} attempts`);
  }

  /**
   * Register a test as a gatekeeper for a key
   */
  registerGatekeeper(key: string, dependencies: string[] = []): void {
    this.withLock(() => {
      const state = this.readState();
      if (dependencies.length > 0) {
        state.dependencies[key] = dependencies;
      }
      this.writeState(state);
    });
  }

  /**
   * Record the result of a gatekeeper test
   */
  setResult(key: string, passed: boolean, error?: string): void {
    this.withLock(() => {
      const state = this.readState();
      state.results[key] = {
        passed,
        error,
        timestamp: Date.now(),
      };
      this.writeState(state);
    });
  }

  /**
   * Get the result of a gatekeeper test
   */
  getResult(key: string): GatekeeperResult | undefined {
    const state = this.readState();
    return state.results[key];
  }

  /**
   * Wait for a gatekeeper result to be available (polling)
   * @param key - The gatekeeper key to wait for
   * @param timeoutMs - Maximum time to wait (default 30s)
   * @param pollIntervalMs - How often to check (default 100ms)
   * @returns The gatekeeper result, or undefined if timeout
   */
  async waitForResult(
    key: string,
    timeoutMs: number = 30000,
    pollIntervalMs: number = 100
  ): Promise<GatekeeperResult | undefined> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = this.getResult(key);
      if (result !== undefined) {
        return result;
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    return undefined; // Timeout - gatekeeper never completed
  }

  /**
   * Wait for multiple gatekeeper results
   */
  async waitForResults(
    keys: string[],
    timeoutMs: number = 30000,
    pollIntervalMs: number = 100
  ): Promise<Map<string, GatekeeperResult | undefined>> {
    const results = new Map<string, GatekeeperResult | undefined>();

    // Wait for all keys in parallel
    await Promise.all(
      keys.map(async (key) => {
        const result = await this.waitForResult(key, timeoutMs, pollIntervalMs);
        results.set(key, result);
      })
    );

    return results;
  }

  /**
   * Check if a key has been registered as a gatekeeper
   */
  isRegistered(key: string): boolean {
    const state = this.readState();
    return key in state.results || key in state.dependencies;
  }

  /**
   * Get the dependencies registered for a key
   */
  getDependencies(key: string): string[] {
    const state = this.readState();
    return state.dependencies[key] || [];
  }

  /**
   * Resolve the full dependency chain for given keys, returning the first failed dependency
   * Returns null if all dependencies passed or haven't run yet
   */
  getFailedDependency(keys: string[], visited: Set<string> = new Set()): FailedDependencyInfo | null {
    const state = this.readState();

    for (const key of keys) {
      // Prevent infinite loops from circular dependencies
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      const result = state.results[key];

      // If the dependency failed, return it
      if (result && !result.passed) {
        return {
          key,
          error: result.error,
          chain: [key],
        };
      }

      // If the dependency hasn't run yet, check its dependencies recursively
      // This handles the case where a transitive dependency failed
      const transitiveDeps = state.dependencies[key] || [];
      if (transitiveDeps.length > 0) {
        const transitiveFailed = this.getFailedDependency(transitiveDeps, visited);
        if (transitiveFailed) {
          return {
            ...transitiveFailed,
            chain: [key, ...transitiveFailed.chain],
          };
        }
      }
    }

    return null;
  }

  /**
   * Check if all given dependencies have passed
   */
  allDependenciesPassed(keys: string[]): boolean {
    return this.getFailedDependency(keys) === null;
  }

  /**
   * Get all registered gatekeepers and their results
   */
  getAllResults(): Record<string, GatekeeperResult> {
    const state = this.readState();
    return { ...state.results };
  }

  /**
   * Get summary statistics
   */
  getSummary(): { total: number; passed: number; failed: number } {
    const results = this.getAllResults();
    const entries = Object.values(results);
    return {
      total: entries.length,
      passed: entries.filter(r => r.passed).length,
      failed: entries.filter(r => !r.passed).length,
    };
  }
}

// Global singleton instance
let globalState: GatekeeperState | null = null;

export function getGlobalState(): GatekeeperState {
  if (!globalState) {
    globalState = new GatekeeperState();
  }
  return globalState;
}

export function resetGlobalState(): void {
  globalState = null;
}
