import { useEffect, useState } from "react";

export function useObjectUrls(blobs: readonly Blob[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = blobs.map((b) => URL.createObjectURL(b));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [blobs]);
  return urls;
}
