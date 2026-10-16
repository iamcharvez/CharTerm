import { render, screen } from "@testing-library/react";
import { AboutPage } from "./AboutPage";

describe("AboutPage", () => {
  it("renders application and developer information", async () => {
    render(<AboutPage theme="dark" onThemeToggle={() => undefined} onMenuOpen={() => undefined} />);

    expect(await screen.findByText(`Version ${__APP_VERSION__}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CharTerm", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("One Terminal.", { exact: false })).toHaveLength(2);
    expect(screen.getAllByText("Charlie M. Chavez")).toHaveLength(2);
    expect(screen.getByText("My mission")).toBeInTheDocument();
    expect(screen.getByText("Private by Design. Reliable by Default.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proprietary — Free to Use" })).toBeInTheDocument();
    expect(screen.getByText(`© ${new Date().getFullYear()} Charlie M. Chavez`)).toBeInTheDocument();
    expect(screen.getByText(`© ${new Date().getFullYear()} CharTerm — Developed by Charlie M. Chavez`)).toBeInTheDocument();
    expect(screen.queryByText("React")).not.toBeInTheDocument();
    expect(screen.queryByText("TypeScript")).not.toBeInTheDocument();
    expect(screen.queryByText("Rust")).not.toBeInTheDocument();
    expect(screen.queryByText("Tauri v2")).not.toBeInTheDocument();
  });

  it("uses build metadata when not running inside Tauri", async () => {
    render(<AboutPage theme="light" onThemeToggle={() => undefined} onMenuOpen={() => undefined} />);
    expect(await screen.findByText(`Version ${__APP_VERSION__}`)).toBeInTheDocument();
  });
});

