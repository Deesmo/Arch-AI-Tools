/**
 * App shell: connection gate, bottom tab bar, the six screens and the
 * first-run guide. Studio and Graph are both always mounted (hidden with
 * display:none) so the canvas viewport and form state survive tab switches.
 */
import { useEffect, useState } from 'react';
import { useServerStore, useSettingsStore } from './core';
import { EditorScreen } from './editor/EditorScreen';
import { LibraryScreen } from './library/LibraryScreen';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { GalleryScreen } from './screens/GalleryScreen';
import { MediaViewer } from './screens/MediaViewer';
import { QueueScreen } from './screens/QueueScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Guide } from './shared/Guide';
import { Icon, type IconName } from './shared/Icon';
import { ConfirmDialog, Toasts } from './shared/Overlays';
import { useUiStore, type Tab } from './shared/ui';
import { StudioScreen } from './studio/StudioScreen';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'studio', label: 'Studio', icon: 'studio' },
  { id: 'graph', label: 'Graph', icon: 'graph' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'queue', label: 'Queue', icon: 'queue' },
  { id: 'gallery', label: 'Gallery', icon: 'gallery' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const isTab = (v: string | null): v is Tab => TABS.some((t) => t.id === v);

export default function App() {
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);
  const guideOpen = useUiStore((s) => s.guideOpen);
  const setGuideOpen = useUiStore((s) => s.setGuideOpen);
  const status = useServerStore((s) => s.status);
  const connect = useServerStore((s) => s.connect);
  const queueRemaining = useServerStore((s) => s.queueRemaining);
  const running = useServerStore((s) => s.execution.status === 'running');
  const defaultMode = useSettingsStore((s) => s.defaultMode);
  const guideSeen = useSettingsStore((s) => s.guideSeen);
  const [offline, setOffline] = useState(false);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // `?tab=library` deep-links a tab (handy for screenshots / docs); otherwise the launch preference wins.
    const wanted = new URLSearchParams(window.location.search).get('tab');
    setTab(isTab(wanted) ? wanted : defaultMode === 'graph' ? 'graph' : 'studio');
    if (!guideSeen) setGuideOpen(true);
    void connect();
    setBooted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconnect when the app returns to the foreground.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && useServerStore.getState().status !== 'connected') void connect();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [connect]);

  // Once a connection succeeds, drop the offline override so a later failure shows the gate again.
  useEffect(() => {
    if (status === 'connected') setOffline(false);
  }, [status]);

  const showGate = booted && status !== 'connected' && !offline && tab !== 'settings';

  return (
    <div className="app">
      <div className="app-main">
        <div style={{ position: 'absolute', inset: 0, display: tab === 'studio' ? 'block' : 'none' }}>
          <StudioScreen />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: tab === 'graph' ? 'block' : 'none' }}>
          <EditorScreen />
        </div>
        {tab === 'library' && <LibraryScreen />}
        {tab === 'queue' && <QueueScreen />}
        {tab === 'gallery' && <GalleryScreen />}
        {tab === 'settings' && <SettingsScreen />}
        {showGate && !guideOpen && (
          <ConnectionScreen
            onContinueOffline={() => {
              setOffline(true);
              setTab('graph');
            }}
          />
        )}
      </div>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} aria-label={t.label}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'queue' && (queueRemaining > 0 || running) && <span className="tab-badge">{queueRemaining || '•'}</span>}
          </button>
        ))}
      </nav>
      <MediaViewer />
      {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
