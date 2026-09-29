import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

/** Botão flutuante de tema — equivalente web do ThemeToggleButton do mobile. */
const ThemeToggleButton = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={isDark ? "Modo claro" : "Modo escuro"}
      className="fixed bottom-6 right-6 z-40 size-11 rounded-full border border-border bg-card shadow-lg flex items-center justify-center hover:scale-105 transition-all"
    >
      <Icon
        key={isDark ? "sun" : "moon"}
        className="size-[17px] text-accent animate-in spin-in-180 fade-in duration-300"
      />
    </button>
  );
};

export default ThemeToggleButton;
