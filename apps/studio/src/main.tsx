import React from 'react';
import ReactDOM from 'react-dom/client';
import { StudioProvider } from '@/app/studio-context';
import { createStudioClient } from '@/ipc/client';
import { createTauriTransport, isTauri, type StudioTransport } from '@/ipc/transport';
import { AppShell } from '@/shell/AppShell';
import { createXterm } from '@/terminal/create-xterm';
import '@/design/tokens.css';

/** Outside the Tauri WebView (plain `vite` preview) every call fails visibly instead of hanging. */
const offline: StudioTransport = {
  invoke: () =>
    Promise.reject({
      code: -32000,
      message: 'Omni Studio must run inside its desktop host',
      data: {
        code: 'ENGINE_MISSING',
        detail: 'No Tauri runtime: open the app with `npm run tauri dev`.',
        retryable: true,
      },
    }),
  listen: () => () => undefined,
};

async function transport(): Promise<StudioTransport> {
  if (!isTauri()) return offline;
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
  return createTauriTransport({ invoke, listen });
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html must contain #root');

void transport().then(studioTransport => {
  const client = createStudioClient(studioTransport);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <StudioProvider client={client} terminalFactory={createXterm}>
        <AppShell />
      </StudioProvider>
    </React.StrictMode>,
  );
});
