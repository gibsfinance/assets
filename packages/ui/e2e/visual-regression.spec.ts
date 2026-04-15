import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForImages(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle')
  // Give images a moment to render skeletons → loaded
  await page.waitForTimeout(1000)
}

async function setDarkMode(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme-mode', 'dark')
  })
}

async function setLightMode(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme-mode', 'light')
  })
}

// ---------------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------------

test.describe('Home page', () => {
  // Higher tolerance: conveyor belt icons are randomly shuffled per load
  test('light mode', async ({ page }) => {
    await page.goto('/#/')
    await setLightMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('home-light.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    })
  })

  test('dark mode', async ({ page }) => {
    await page.goto('/#/')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('home-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    })
  })
})

// ---------------------------------------------------------------------------
// Docs page
// ---------------------------------------------------------------------------

test.describe('Docs page', () => {
  test('light mode', async ({ page }) => {
    await page.goto('/#/docs')
    await setLightMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('docs-light.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    })
  })

  test('dark mode', async ({ page }) => {
    await page.goto('/#/docs')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('docs-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    })
  })
})

// ---------------------------------------------------------------------------
// Studio page
// ---------------------------------------------------------------------------

test.describe('Studio page', () => {
  test('light mode - empty state', async ({ page }) => {
    await page.goto('/#/studio')
    await setLightMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('studio-empty-light.png', {
      maxDiffPixelRatio: 0.01,
    })
  })

  test('dark mode - empty state', async ({ page }) => {
    await page.goto('/#/studio')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('studio-empty-dark.png', {
      maxDiffPixelRatio: 0.01,
    })
  })

  test('dark mode - with chain selected', async ({ page }) => {
    await page.goto('/#/studio')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)

    // Select Ethereum
    const chainButton = page.getByRole('button', { name: /Ethereum/i })
    if (await chainButton.isVisible()) {
      await chainButton.click()
      await page.waitForTimeout(2000) // wait for tokens to load
    }

    await expect(page).toHaveScreenshot('studio-chain-selected-dark.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('toolbar controls', async ({ page }) => {
    await page.goto('/#/studio')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)

    // Screenshot just the toolbar area
    const toolbar = page.locator('.flex.flex-wrap.items-center.gap-3').first()
    if (await toolbar.isVisible()) {
      await expect(toolbar).toHaveScreenshot('studio-toolbar-dark.png', {
        maxDiffPixelRatio: 0.01,
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Studio configurator with token
// ---------------------------------------------------------------------------

test.describe('Studio configurator', () => {
  test('code panel open', async ({ page }) => {
    await page.goto('/#/studio')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)

    // Open code panel
    const codeButton = page.getByRole('button', { name: 'Show code output' })
    if (await codeButton.isVisible()) {
      await codeButton.click()
      await page.waitForTimeout(500)
    }

    await expect(page).toHaveScreenshot('studio-code-panel-dark.png', {
      maxDiffPixelRatio: 0.01,
    })
  })
})

// ---------------------------------------------------------------------------
// Mobile viewport
// ---------------------------------------------------------------------------

test.describe('Mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('home page - dark mode', async ({ page }) => {
    await page.goto('/#/')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('home-mobile-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    })
  })

  test('studio page - dark mode', async ({ page }) => {
    await page.goto('/#/studio')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('studio-mobile-dark.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('docs page - dark mode', async ({ page }) => {
    await page.goto('/#/docs')
    await setDarkMode(page)
    await page.reload()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('docs-mobile-dark.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    })
  })
})
