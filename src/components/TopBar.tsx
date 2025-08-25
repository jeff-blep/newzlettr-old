import React from "react";
import { Moon, Sun, Settings } from "lucide-react";

function getTheme(): string {
  // DaisyUI theme name. Adjust if you use custom themes.
  const saved = localStorage.getItem("theme");
  if (saved) return saved;
  // Try to respect system preference on first load
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}
function setTheme(t: string) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("theme", t);
}

type TopBarProps = {
  rightSlot?: React.ReactNode;
  status?: { emailOk?: boolean; plexOk?: boolean; tautulliOk?: boolean };
  onOpenSettings?: () => void;
};

export default function TopBar({ rightSlot, status, onOpenSettings }: TopBarProps) {
  const [theme, setThemeState] = React.useState<string>(() => getTheme());

  React.useEffect(() => {
    setTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const renderStatus = () => {
    if (!status) return null;
    const items = [
      { label: "SMTP", ok: !!status.emailOk },
      { label: "Plex", ok: !!status.plexOk },
      { label: "Tautulli", ok: !!status.tautulliOk },
    ];
    return (
      <div className="hidden md:flex items-center gap-3 text-xs md:text-sm opacity-70 whitespace-nowrap">
        {items.map((it) => (
          <span key={it.label} className="truncate">
            {it.ok ? "✅" : "❌"} {it.label}
          </span>
        ))}
      </div>
    );
  };

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-base-100/90 backdrop-blur border-b border-base-300">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Left: Brand */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-2xl truncate">Newzlettr</span>
        </div>

        {/* Right: status + actions */}
        <div className="flex items-center gap-3">
          {renderStatus()}
          {rightSlot /* optional slot for per-page actions */}
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost btn-sm"
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="w-5 h-5 text-gray-500" />
            ) : (
              <Moon className="w-5 h-5 text-gray-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onOpenSettings && onOpenSettings()}
            className="btn btn-ghost btn-sm"
            aria-label="Open settings"
            title="Open settings"
          >
            <Settings className="w-5 h-5 text-gray-500" />
          </button>
        </div>
      </div>
    </header>
  );
}
