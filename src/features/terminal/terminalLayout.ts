import type { CSSProperties } from "react";
import type { TerminalLayout } from "../../stores/useAppStore";

export function getTerminalStageStyle(
  layout: TerminalLayout,
  paneCount: number,
): CSSProperties {
  const count = Math.max(1, paneCount);

  if (layout === "columns") {
    return {
      gridTemplateColumns: `repeat(${Math.min(2, count)}, minmax(0, 1fr))`,
      gridTemplateRows: "minmax(0, 1fr)",
    };
  }

  if (layout === "rows") {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: `repeat(${Math.min(2, count)}, minmax(0, 1fr))`,
    };
  }

  if (layout === "grid") {
    return {
      gridTemplateColumns: `repeat(${Math.min(2, count)}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${Math.ceil(count / 2)}, minmax(0, 1fr))`,
    };
  }

  return {
    gridTemplateColumns: "minmax(0, 1fr)",
    gridTemplateRows: "minmax(0, 1fr)",
  };
}
