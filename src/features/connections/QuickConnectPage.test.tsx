import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../stores/useAppStore";
import { QuickConnectPage } from "./QuickConnectPage";

describe("Quick Connect serial speed", () => {
  beforeEach(() => {
    useAppStore.setState({ profiles: [], groups: [], identities: [], editingProfileId: null });
  });

  it("offers common baud rates and accepts a manually typed speed", () => {
    render(<QuickConnectPage />);
    fireEvent.click(screen.getByRole("button", { name: /Serial.*COM \/ TTY/ }));

    const presets = screen.getByRole("combobox", { name: "Common serial speed" });
    const manual = screen.getByRole("textbox", { name: "Manual serial speed" });
    expect(presets).toHaveValue("115200");

    fireEvent.change(presets, { target: { value: "9600" } });
    expect(manual).toHaveValue("9600");

    fireEvent.change(manual, { target: { value: "74880" } });
    expect(manual).toHaveValue("74880");
    expect(presets).toHaveValue("custom");
  });
});
