export interface FrameLoop {
  wake(): void;
  stop(): void;
  running(): boolean;
}

export function createFrameLoop(step: (now: number) => boolean): FrameLoop {
  let raf = 0;
  const run = (now: number) => {
    raf = 0;
    if (step(now)) raf = requestAnimationFrame(run);
  };
  return {
    wake() {
      if (!raf) raf = requestAnimationFrame(run);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    running() {
      return raf !== 0;
    },
  };
}
