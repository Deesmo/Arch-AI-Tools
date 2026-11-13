/**
 * Save-to-device helpers. On native (Capacitor) the file is written to the
 * app's Documents folder and the system share sheet is opened so the user can
 * send it to Photos / Files. On the web an <a download> is used.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_');
}

/** Downloads `url` and saves/shares it as `filename`. */
export async function saveUrlToDevice(url: string, filename: string): Promise<'saved' | 'shared' | 'downloaded'> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  return saveBlobToDevice(blob, filename);
}

export async function saveBlobToDevice(blob: Blob, filename: string): Promise<'saved' | 'shared' | 'downloaded'> {
  const name = safeName(filename);
  if (!isNative()) {
    const a = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return 'downloaded';
  }
  const data = await blobToBase64(blob);
  const written = await Filesystem.writeFile({ path: `ComfyMobile/${name}`, data, directory: Directory.Documents, recursive: true });
  try {
    if ((await Share.canShare()).value) {
      await Share.share({ title: name, url: written.uri });
      return 'shared';
    }
  } catch {
    /* user cancelled share; file is still saved */
  }
  return 'saved';
}

/** Saves text (e.g. workflow JSON) as a file. */
export async function saveTextToDevice(text: string, filename: string, mime = 'application/json') {
  return saveBlobToDevice(new Blob([text], { type: mime }), filename);
}
