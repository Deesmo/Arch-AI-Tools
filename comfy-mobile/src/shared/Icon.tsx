/** Minimal inline SVG icon set (no icon dependency). */
import type { SVGProps } from 'react';

const paths: Record<string, string> = {
  studio: 'M4 6h16v12H4z M8 6v12 M16 6v12 M4 10h4 M16 10h4 M4 14h4 M16 14h4',
  graph: 'M5 7a2 2 0 1 0 0 .01 M19 5a2 2 0 1 0 0 .01 M19 19a2 2 0 1 0 0 .01 M7 7l10-2 M7 7l10 12 M5 9v8a2 2 0 1 0 0 .01',
  queue: 'M4 6h16 M4 12h16 M4 18h10',
  gallery: 'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4 M15 9a1 1 0 1 0 0 .01',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6 6l12 12 M18 6L6 18',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  down: 'M6 9l6 6 6-6',
  play: 'M6 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  bypass: 'M4 12h4l3-6 4 12 3-6h2',
  mute: 'M11 5L6 9H2v6h4l5 4z M23 9l-6 6 M17 9l6 6',
  more: 'M12 6a1 1 0 1 0 0 .01 M12 12a1 1 0 1 0 0 .01 M12 18a1 1 0 1 0 0 .01',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 21h16',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36 M21 3v6h-6',
  video: 'M3 7h13v10H3z M16 10l5-3v10l-5-3',
  image: 'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4',
  wifi: 'M2 9a15 15 0 0 1 20 0 M5.5 12.5a10 10 0 0 1 13 0 M9 16a5 5 0 0 1 6 0 M12 20h.01',
  dice: 'M4 4h16v16H4z M8.5 8.5h.01 M15.5 8.5h.01 M12 12h.01 M8.5 15.5h.01 M15.5 15.5h.01',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  check: 'M5 12l5 5L20 7',
  warning: 'M12 3l10 18H2z M12 10v4 M12 18h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  upload: 'M12 21V9 M7 14l5-5 5 5 M4 3h16',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  unlink: 'M18 6L6 18 M9 6l-3 3a5 5 0 0 0 0 7 M15 18l3-3a5 5 0 0 0 0-7',
  film: 'M4 4h16v16H4z M4 8h16 M4 12h16 M4 16h16 M8 4v16 M16 4v16',
  home: 'M3 11l9-8 9 8 M5 10v10h14V10',
  collapse: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
  library: 'M4 4h4v16H4z M10 4h4v16h-4z M16 5l4-1 3 15-4 1z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7 M12 17h.01',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
