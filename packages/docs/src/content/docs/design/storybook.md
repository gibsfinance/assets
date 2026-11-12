---
title: Storybook
description: A live catalog of the interface components, with every main state, in light and dark. How to open it, run it and add a story.
sidebar:
  order: 2
---

Storybook is a catalog of the interface components. Each component shows in its main states on one page: empty, loading, failed, long text, and in both themes. You can try each component with real clicks and typing, and no server is needed.

[Open the full Storybook](/storybook/)

## What you will find

- One page of documentation for each component, made from its code comments.
- Stories for each state of the component. A story is one fixed example of the component.
- A **Theme** item in the toolbar. It switches between light and dark. It sets the same `dark` class that the interface sets, so the components look as they do on the site.
- An accessibility panel that checks each story.

The stories use sample data only. A story that needs the server (for example the network picker) gets its answers from a small set of fixtures, and no story sends a request to a real server.

## Run it on your computer

From the repository root:

```bash
yarn workspace ui storybook
```

Storybook opens on port 6006 and reloads when you save a file. It uses the interface's own Vite configuration, its Tailwind styles and its fonts, so a change to `app.css` shows in Storybook at once.

To build the static files, run `yarn workspace ui run build:storybook`. The files go to `packages/ui/storybook-static`. The documentation build does this for you and copies the result to `/storybook/` on this site.

## Add a story

A story file sits next to its component and ends in `.stories.tsx`. For `Thing.tsx`, create `Thing.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite'
import Thing from './Thing'

const meta = {
  title: 'Components/Thing',
  component: Thing,
  args: { label: 'Hello' },
} satisfies Meta<typeof Thing>

export default meta
type Story = StoryObj<typeof meta>

/** The component with its default props. */
export const Default: Story = {}

/** A label that is much too long for the box. */
export const LongText: Story = { args: { label: 'A very long label '.repeat(10) } }
```

Follow these rules:

1. Write one story for each state a reader can reach: empty, loading, failed, long text, and any option that changes how the component looks.
2. Write a short comment above each story. Storybook shows it as the story's description.
3. Do not use the network. If the component fetches data, list the paths it asks for in the `mockApi` parameter, with the answers from `src/lib/storybook/fixtures.ts`. A path that is not listed answers 404.
4. If the component needs the Studio, theme or settings state, do nothing. The preview already wraps every story in those providers.
5. Do not use the native `select` element, in a story or in a component. Use a Headless UI listbox or the network picker pattern.

## The rule

**Every new reusable component gets a story in the same change.** A reviewer can then see the component in all its states without running the whole interface. A change to a component updates its stories too.

Stories are documentation, not application code. They do not count toward the coverage thresholds, and they are checked by the linter and the type checker like all other code.
