import { useEffect, useState } from "react";

/**
 * Photo-wall column count for the mobile layout:
 *   < 340px          -> 1 column (very narrow phones)
 *   340px - 639px    -> 2 columns (default phone portrait)
 *   >= 640px         -> 3 columns (wide phones / landscape / small tablets)
 *
 * Driven by viewport width and re-evaluated on resize/orientation change so
 * rotating the phone switches between 2 and 3 columns.
 */
export function useResponsiveColumns(): number {
  const compute = () => {
    if (typeof window === "undefined") return 2;
    const width = window.innerWidth;
    if (width < 340) return 1;
    if (width < 640) return 2;
    return 3;
  };

  const [columns, setColumns] = useState<number>(compute);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setColumns(compute());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return columns;
}
