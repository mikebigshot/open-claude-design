// copy_starter_component — copy a built-in starter component into the
// current project. Starters are inlined here so the tool doesn't need an
// extra fetch round-trip; the agent picks `name` and the file is written
// to `dest` via the existing PUT /files/:path worker.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

const STARTERS = {
  design_canvas: {
    description: 'Canvas wrapper with grid background — used as a layout shell.',
    content: `export default function DesignCanvas({ children, className = '' }) {
  return (
    <div className={\`relative min-h-screen bg-stone-50 \${className}\`}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
`,
  },
  ios_frame: {
    description: 'iPhone-style frame wrapper (393×852, rounded corners, notch).',
    content: `export default function IosFrame({ children }) {
  return (
    <div className="mx-auto my-12 w-[393px] rounded-[44px] border-[10px] border-black bg-black p-1 shadow-xl">
      <div className="relative aspect-[393/852] overflow-hidden rounded-[34px] bg-white">
        <div className="absolute top-2 left-1/2 -translate-x-1/2 h-8 w-32 rounded-full bg-black z-10" />
        {children}
      </div>
    </div>
  );
}
`,
  },
  android_frame: {
    description: 'Android-style frame wrapper (360×800, less round, no notch).',
    content: `export default function AndroidFrame({ children }) {
  return (
    <div className="mx-auto my-12 w-[360px] rounded-[28px] border-[8px] border-zinc-800 bg-zinc-800 p-1 shadow-xl">
      <div className="relative aspect-[360/800] overflow-hidden rounded-[22px] bg-white">
        {children}
      </div>
    </div>
  );
}
`,
  },
  macos_window: {
    description: 'macOS-style window frame with traffic-light buttons.',
    content: `export default function MacosWindow({ title = '', children }) {
  return (
    <div className="mx-auto my-12 max-w-5xl rounded-xl bg-zinc-100 shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-amber-400" />
        <span className="h-3 w-3 rounded-full bg-emerald-400" />
        <span className="ml-auto text-xs font-medium text-zinc-500">{title}</span>
      </div>
      <div className="rounded-b-xl bg-white">{children}</div>
    </div>
  );
}
`,
  },
  browser_window: {
    description: 'Browser chrome with URL bar and tab.',
    content: `export default function BrowserWindow({ url = 'https://example.com', children }) {
  return (
    <div className="mx-auto my-12 max-w-6xl rounded-lg bg-zinc-100 shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 rounded-md bg-white px-3 py-1 text-xs text-zinc-600">{url}</div>
      </div>
      <div className="rounded-b-lg bg-white">{children}</div>
    </div>
  );
}
`,
  },
  deck_stage: {
    description: 'Deck stage container — 16:9 fixed-size slide root.',
    content: `// Use as the root of each slide. Fixed 1920×1080 internal coords; the
// stage CSS-scales to fit the parent. Pair with the Save-as-PDF skill.
export default function DeckStage({ children, className = '' }) {
  return (
    <div
      className={\`relative mx-auto bg-white shadow-sm ring-1 ring-black/10 \${className}\`}
      style={{ width: 1920, height: 1080, transformOrigin: 'top center' }}
    >
      {children}
    </div>
  );
}
`,
  },
};

type StarterName = keyof typeof STARTERS;
const STARTER_NAMES = Object.keys(STARTERS) as StarterName[];

export function copyStarterComponentTool(projectId: string) {
  return tool({
    description: `Copy a built-in starter component into the project as a new file. Useful when sketching layouts that need a familiar frame (device, window, canvas) before any custom UI. Available starters: ${STARTER_NAMES.join(', ')}.`,
    inputSchema: z
      .object({
        name: z.enum(STARTER_NAMES as [StarterName, ...StarterName[]]).describe('Starter id.'),
        dest: z
          .string()
          .min(1)
          .describe('Destination path inside the project (e.g. "components/Frame.jsx").'),
      })
      .strict(),
    execute: async ({ name, dest }, { abortSignal }) => {
      const starter = STARTERS[name];
      if (!starter) return `Error: unknown starter "${name}".`;
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(dest)}`,
      );
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: starter.content }),
        signal: abortSignal,
      });
      if (!res.ok) {
        return `Error: copy_starter_component failed (HTTP ${res.status})`;
      }
      return `Copied starter "${name}" → ${dest} (${starter.content.length} bytes). ${starter.description}`;
    },
  });
}

export const STARTER_REGISTRY = STARTERS;
