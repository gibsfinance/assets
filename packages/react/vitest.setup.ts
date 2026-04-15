import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

// Mock IntersectionObserver — immediately marks elements as visible
class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    // Immediately trigger as intersecting so lazy images render
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve() { /* noop */ }
  disconnect() { /* noop */ }
  get root() { return null }
  get rootMargin() { return '0px' }
  get thresholds() { return [0] }
  takeRecords() { return [] as IntersectionObserverEntry[] }
}

globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
