/**
 * Overpass request throttle
 * Serializes Overpass API requests with a minimum delay between calls
 * to avoid rate limits (429). Used by overpass.service.
 */

const MIN_DELAY_MS = 1500;
let lastRequestTime = 0;

interface QueuedTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

const queue: QueuedTask<unknown>[] = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing || queue.length === 0) return;
  processing = true;
  while (queue.length > 0) {
    const task = queue.shift() as QueuedTask<unknown>;
    const now = Date.now();
    const wait = Math.max(0, MIN_DELAY_MS - (now - lastRequestTime));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const result = await task.fn();
      lastRequestTime = Date.now();
      task.resolve(result);
    } catch (e) {
      task.reject(e);
    }
  }
  processing = false;
}

/**
 * Run an Overpass query through the throttle queue.
 * Ensures at least MIN_DELAY_MS between the start of each request.
 */
export async function throttledOverpassQuery<T>(
  fn: () => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    void processQueue();
  });
}
