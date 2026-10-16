import { Moon, Sun } from "lucide-react";

type ThemeToggleProps = {
  theme: "dark" | "light";
  onToggle: () => void;
};

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <button className="icon-button" type="button" onClick={onToggle} aria-label={`Use ${nextTheme} theme`} title={`Use ${nextTheme} theme`}>
      {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}

