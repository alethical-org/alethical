import { useEffect, useState } from 'react';

/** Object URLs expose only the exact server-confirmed File retained in this tab. */
export function useMailPhoto(file: File | undefined) {
  const [preview, setPreview] = useState<{ file: File; url?: string; failed?: boolean } | null>(
    null,
  );
  useEffect(() => {
    setPreview(null);
    if (!file) return;
    let url: string;
    try {
      url = URL.createObjectURL(file);
      setPreview({ file, url });
    } catch {
      setPreview({ file, failed: true });
      return;
    }
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const current = preview?.file === file ? preview : null;
  return { url: current?.url, failed: !file || current?.failed === true };
}
