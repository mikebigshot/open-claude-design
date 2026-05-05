// Examples Tab — V1 catalog of 4 hand-authored starter prototypes.
//
// The catalog is a static TS array baked into the bundle. Each entry
// references a static `example.html` shipped under
// `apps/web/public/examples/<slug>/`. The card component renders that HTML
// inside a sandbox iframe for the live preview; "Use this prompt" creates
// a new project and seeds the chat composer with the example prompt so
// the agent regenerates the artifact from scratch (we never copy the
// example HTML into the new project).
//
// Adding a new example:
//   1. Drop `apps/web/public/examples/<slug>/example.html` (self-contained
//      HTML/CSS/JS, ~150-300 lines).
//   2. Append a row below with title / description / prompt / category.
//   3. Done — no API or DB changes required.

import type { Fidelity, ProjectType } from '@open-design/contracts';

export type ExampleCategory = 'prototype' | 'landing' | 'dashboard' | 'utility';

export interface ExampleEntry {
  slug: string;
  title: string;
  /** One-paragraph description shown under the title. */
  description: string;
  /** Three-bullet feature list / hook (rendered as small chips). */
  highlights: string[];
  /** Used as the seed message for `chat.sendMessage` when the user clicks "Use this prompt". */
  prompt: string;
  /** What kind of artifact this is — drives the project type the new project gets. */
  category: ExampleCategory;
  /** Project-creation defaults: type + fidelity inherited by the new project. */
  projectType: ProjectType;
  fidelity: Fidelity;
  /** Path under apps/web/public — served at `${origin}/examples/<slug>/example.html`. */
  previewPath: string;
}

export const EXAMPLES: readonly ExampleEntry[] = [
  {
    slug: 'counter',
    title: 'Counter — minimal stateful component',
    description:
      'Click-to-increment counter with a reset and step controls. The smallest end-to-end example — useful as a sanity check that the chat → write_file → preview loop works on your machine.',
    highlights: ['useState', 'event handlers', '~40 lines'],
    prompt:
      'Build me a simple React counter component. It should have a number display, an increment button, a decrement button, and a reset button. Style it minimally with Tailwind. Save to App.jsx.',
    category: 'prototype',
    projectType: 'prototype',
    fidelity: 'high',
    previewPath: '/examples/counter/example.html',
  },
  {
    slug: 'todo',
    title: 'Todo list — add, complete, delete',
    description:
      'A working todo list with add / mark-complete / delete actions. Demonstrates state arrays, controlled inputs, and conditional rendering — the second-simplest archetype.',
    highlights: ['useState', 'arrays', 'forms', '~80 lines'],
    prompt:
      'Build a todo list app in App.jsx. Users should be able to add a todo with an input + button, click to mark complete (strike-through + check), and delete. Use Tailwind for styling. Empty state with a friendly message when no todos.',
    category: 'prototype',
    projectType: 'prototype',
    fidelity: 'high',
    previewPath: '/examples/todo/example.html',
  },
  {
    slug: 'landing-page',
    title: 'SaaS landing page — hero + features',
    description:
      'A complete marketing landing page with hero, three-column feature grid, social proof row, and a CTA section. Good baseline for "design me a landing page for X".',
    highlights: ['responsive grid', 'CTA flow', '~150 lines'],
    prompt:
      'Design a SaaS landing page in App.jsx for a product called "Atelier" — an AI design tool. Include: hero with headline + subheading + Get Started button + secondary "See examples" link, three feature cards (icons + title + description), a social proof row with logos, and a final CTA section with email capture form. Use Tailwind, warm beige accent color (#C96442), Inter font. Mobile responsive.',
    category: 'landing',
    projectType: 'prototype',
    fidelity: 'high',
    previewPath: '/examples/landing-page/example.html',
  },
  {
    slug: 'dashboard',
    title: 'Analytics dashboard — stat cards + chart',
    description:
      'Multi-card dashboard layout with stat tiles, a placeholder line chart, and a recent-activity table. Good baseline for "build me an admin dashboard".',
    highlights: ['grid layout', 'stat cards', 'data table', '~200 lines'],
    prompt:
      'Build an analytics dashboard in App.jsx. Top row: 4 stat cards (Revenue, Active Users, Conversion Rate, Avg. Session) each with current value, delta vs last period, and a tiny sparkline shape. Below: a 2/3-width line chart placeholder titled "Traffic over time" with X axis (last 7 days) and Y axis labels, plus a 1/3-width recent-activity card listing 5 events with timestamps. Use Tailwind, white/gray theme with one accent color, headings in serif font.',
    category: 'dashboard',
    projectType: 'prototype',
    fidelity: 'high',
    previewPath: '/examples/dashboard/example.html',
  },
];
