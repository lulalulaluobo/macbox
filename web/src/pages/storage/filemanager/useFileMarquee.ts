import { useEffect, useRef, useState } from 'react';

interface MarqueeRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface UseFileMarqueeOptions {
  setSelectionMode: (enabled: boolean) => void;
  setSelectedPaths: (paths: Set<string>) => void;
}

export const useFileMarquee = ({ setSelectionMode, setSelectedPaths }: UseFileMarqueeOptions) => {
  const fileListRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeActiveRef = useRef(false);
  const marqueeJustFinishedRef = useRef(false);

  const finishMarquee = () => {
    if (!marqueeActiveRef.current || !fileListRef.current || !marquee) return;
    const left = Math.min(marquee.startX, marquee.currentX);
    const right = Math.max(marquee.startX, marquee.currentX);
    const top = Math.min(marquee.startY, marquee.currentY);
    const bottom = Math.max(marquee.startY, marquee.currentY);
    const selected = Array.from(fileListRef.current.querySelectorAll<HTMLElement>('[data-file-item]'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
      })
      .map((element) => element.dataset.filePath)
      .filter((path): path is string => Boolean(path));
    setSelectionMode(true);
    setSelectedPaths(new Set(selected));
    marqueeJustFinishedRef.current = true;
    marqueeActiveRef.current = false;
    marqueeStartRef.current = null;
    setMarquee(null);
  };

  useEffect(() => {
    if (!marquee) return;
    const handlePointerMove = (event: PointerEvent) => {
      setMarquee((current) => current ? { ...current, currentX: event.clientX, currentY: event.clientY } : current);
    };
    const handlePointerUp = () => finishMarquee();
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [marquee]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-file-item]') || target.closest('button')) return;
    marqueeActiveRef.current = true;
    marqueeStartRef.current = { x: event.clientX, y: event.clientY };
    setMarquee({ startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY });
    event.preventDefault();
  };

  return {
    fileListRef,
    marquee,
    marqueeJustFinishedRef,
    handlePointerDown,
  };
};
