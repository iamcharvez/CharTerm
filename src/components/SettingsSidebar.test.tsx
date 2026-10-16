import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsSidebar, type SettingsPageId } from "./SettingsSidebar";

describe("SettingsSidebar", () => {
  it("enables every settings destination", () => {
    const visited: SettingsPageId[] = [];
    render(<SettingsSidebar activePage="about" onNavigate={(page) => visited.push(page)} />);

    for (const label of [
      "General",
      "Appearance",
      "Terminal",
      "Shortcuts",
      "Connections",
      "Security",
      "Notifications",
      "Accessibility",
      "About",
    ]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toBeEnabled();
      fireEvent.click(button);
    }

    expect(visited).toEqual([
      "general",
      "appearance",
      "terminal",
      "shortcuts",
      "connections",
      "security",
      "notifications",
      "accessibility",
      "about",
    ]);
  });
});
