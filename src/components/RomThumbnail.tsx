import { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getThumbnail } from "@/lib/tauri";

/** Lazy-loads a SteamGridDB thumbnail for the given title + console.
 *  Returns null (renders nothing) when no image is available — never shows a placeholder box. */
export function RomThumbnail({ title, consoleName }: { title: string; consoleName: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    getThumbnail(title, consoleName)
      .then((path) => { if (path) setSrc(convertFileSrc(path)); })
      .catch(() => {});
  }, [title, consoleName]);

  if (!src) return null;
  return <img src={src} alt={title} className="w-10 h-10 rounded object-cover shrink-0" />;
}
