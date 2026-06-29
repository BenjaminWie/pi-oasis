import { Download, X } from "lucide-react";
import { usePWAInstall } from "@/hooks/use-pwa-install";
import { useState, useEffect } from "react";

export function InstallPWAButton() {
  const { canInstall, install, dismiss } = usePWAInstall();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Show after a short delay to feel like a "pop up"
    if (canInstall) {
      const timer = setTimeout(() => setIsVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [canInstall]);

  if (!canInstall || !isVisible) return null;

  return (
    <div className="fixed bottom-24 right-5 z-50 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-5 duration-500">
      <button
        onClick={install}
        className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-3 rounded-2xl shadow-lg font-bold text-xs uppercase tracking-widest active:scale-95 transition-transform"
      >
        <Download size={16} /> App Installieren
      </button>
      <button
        onClick={() => {
          setIsVisible(false);
          dismiss();
        }}
        className="bg-card border border-border p-3 rounded-2xl shadow-lg text-muted-foreground active:scale-95 transition-transform"
        aria-label="Schließen"
      >
        <X size={16} />
      </button>
    </div>
  );
}
