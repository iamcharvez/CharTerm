import { describe, expect, it } from "vitest";
import { getTerminalStageStyle } from "./terminalLayout";

describe("terminal stage layout", () => {
  it("resets both grid axes when returning from a split to single", () => {
    expect(getTerminalStageStyle("columns", 3)).toEqual({
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "minmax(0, 1fr)",
    });

    expect(getTerminalStageStyle("single", 1)).toEqual({
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
    });
  });

  it("sets both axes for row and grid layouts", () => {
    expect(getTerminalStageStyle("rows", 2)).toEqual({
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    });
    expect(getTerminalStageStyle("grid", 3)).toEqual({
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    });
  });
});
