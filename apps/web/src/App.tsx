import { Navigate, Route, Routes } from 'react-router-dom';

import { ToastHost } from '@/components';
import { Home } from '@/routes/Home';
import { Present } from '@/routes/Present';
import { Workspace } from '@/routes/Workspace';

// Note: there's no /settings route — settings (the BYOK API key form) opens
// as a modal on Home or Workspace via the gear-icon button. Per user
// directive 2026-05-03: "用弹出框，不要新建页面". Anyone hitting /settings
// directly (old bookmark) gets redirected to home via the catch-all → click
// the gear icon there.

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/p/:id" element={<Workspace />} />
        <Route path="/p/:id/present" element={<Present />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* Global single-instance toast — used for fire-and-forget network
          failures (e.g. background PUTs) where the optimistic UI already
          moved on. role="alert"/role="status" announce to screen readers. */}
      <ToastHost />
    </>
  );
}
