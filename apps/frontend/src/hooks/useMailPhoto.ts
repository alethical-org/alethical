import { useEffect, useState } from 'react';

/** Object URLs expose only the exact server-confirmed File retained in this tab. */
export function useMailPhoto(file: File | undefined) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    setPreview(null);
    if (!file) return;
    let url: string;
    try {
      url = URL.createObjectURL(file);
      setPreview({ file, url });
    } catch {
      return;
    }
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return preview?.file === file ? preview?.url : undefined;
}
