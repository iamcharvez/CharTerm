import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../stores/useAppStore";
import { IdentitiesPage } from "./IdentitiesPage";

describe("SSH Identities", () => {
  beforeEach(() => {
    useAppStore.setState({ identities: [], profiles: [] });
  });

  it("opens the native identity form without crashing", () => {
    render(<IdentitiesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Generate identity" }));
    expect(screen.getByRole("heading", { name: "Generate an OpenSSH key" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Browse" })).toHaveLength(2);
  });

  it("ignores malformed legacy identity records instead of crashing the page", () => {
    useAppStore.setState({ identities: [null] as never });
    render(<IdentitiesPage />);
    expect(screen.getByRole("heading", { name: "No SSH identities yet" })).toBeVisible();
  });
});
