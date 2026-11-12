/**
 * Smoke test for every story: each one must render, with the same providers and fixtures the
 * published Storybook uses, and throw nothing. It catches a story that a component change broke
 * before the Storybook build does, and it needs no browser.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'
import type { Meta, StoryFn } from '@storybook/react-vite'
import preview from '../../../.storybook/preview'

setProjectAnnotations([preview])

type StoryModule = { default: Meta } & Record<string, unknown>

const modules = import.meta.glob<StoryModule>('../**/*.stories.tsx', { eager: true })

/** Browser features the component stories use and jsdom does not supply. */
const stubBrowserFeatures = () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  const observer = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', observer)
  vi.stubGlobal('ResizeObserver', observer)
  Element.prototype.scrollIntoView = () => {}
}

describe('stories', () => {
  beforeAll(stubBrowserFeatures)

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('finds the stories of the reusable components', () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(15)
  })

  for (const [file, module] of Object.entries(modules)) {
    const stories = composeStories(module as never) as Record<string, StoryFn & { run: () => Promise<void> }>
    describe(file.replace(/^.*\//, ''), () => {
      for (const [name, story] of Object.entries(stories)) {
        it(`renders ${name}`, async () => {
          await expect(story.run()).resolves.toBeUndefined()
        })
      }
    })
  }
})
