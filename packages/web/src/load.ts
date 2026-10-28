import { decodeImage, ImageTooLargeError } from '@pixel3d/core';
import { describe, type Source } from './pipeline';
import { change, app, toast, ui } from './state.svelte';

const NOT_IMAGE = 'That file is not an image. Use PNG, JPEG, GIF or WebP.';

/** Decode with the core decoders (the same ones batch runs use), then make it the current image. Undoable. */
export async function loadBytes(name: string, bytes: Uint8Array): Promise<boolean> {
  let img;
  try {
    img = await decodeImage(bytes);
  } catch (e) {
    toast(e instanceof ImageTooLargeError ? `Couldn't load ${name}. ${e.message}` : `Couldn't read ${name}. Try saving it as a PNG.`);
    return false;
  }
  const source: Source = { name, img, ...describe(img), pick: null, crop: null };
  ui.picking = ui.cropping = false;
  const ok = change(() => {
    app.source = source;
    app.edits = [];
    // a new image sets a new pixel size (spec §4.5)
    delete app.settings.pixelMm;
    // every new image starts from auto: pixel art stays as it is, anything else is pixelated
    app.settings.pixelate.enabled = 'auto';
    app.settings.background.enabled = true;
  });
  if (ok) {
    ui.sel = null;
    const n = app.grid!.palette.length, meta = app.meta!;
    toast(`Loaded ${name}: ${n} color${n === 1 ? '' : 's'}` +
      (meta.pixelated ? ', pixelated. Adjust Pixels across and Colors to taste.' : meta.bg ? ', background removed.' : '.'));
  }
  return ok;
}

export async function loadFile(file: File | undefined | null): Promise<boolean> {
  if (!file) return false;
  if (file.type && !file.type.startsWith('image/')) { toast(NOT_IMAGE); return false; }
  return loadBytes(file.name || 'image', new Uint8Array(await file.arrayBuffer()));
}

/** The last path segment, or `image` when the URL has none. */
export function nameFromUrl(url: string): string {
  try {
    const seg = new URL(url, location.href).pathname.split('/').filter(Boolean).at(-1);
    return seg ? decodeURIComponent(seg) : 'image';
  } catch {
    return 'image';
  }
}

export async function loadUrl(url: string): Promise<boolean> {
  const u = url.trim();
  if (!u) return false;
  let res: Response;
  try {
    res = await fetch(u);
  } catch {
    toast("Couldn't load that URL. The site may not allow it: save the image and open it instead.");
    return false;
  }
  if (!res.ok) { toast(`Couldn't load that URL (${res.status}).`); return false; }
  const type = res.headers.get('content-type') ?? '';
  if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) { toast(NOT_IMAGE); return false; }
  return loadBytes(nameFromUrl(u), new Uint8Array(await res.arrayBuffer()));
}

/** Window-wide drag and drop and paste. Returns a cleanup function. */
export function listen(target: Window, onDragging: (on: boolean) => void): () => void {
  let depth = 0;
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; onDragging(true); };
  const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
  const leave = (e: DragEvent) => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; onDragging(false); } };
  const drop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    onDragging(false);
    void loadFile(e.dataTransfer?.files[0]);
  };
  const paste = (e: ClipboardEvent) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); void loadFile(f); }
  };
  target.addEventListener('dragenter', enter);
  target.addEventListener('dragover', over);
  target.addEventListener('dragleave', leave);
  target.addEventListener('drop', drop);
  target.addEventListener('paste', paste);
  return () => {
    target.removeEventListener('dragenter', enter);
    target.removeEventListener('dragover', over);
    target.removeEventListener('dragleave', leave);
    target.removeEventListener('drop', drop);
    target.removeEventListener('paste', paste);
  };
}
