interface Props {
  label: string;
  value: string;
  unit?: string;
  pct: number;
  tone?: "ok" | "warn" | "crit" | "accent";
}

const toneClass: Record<NonNullable<Props["tone"]>, string> = {
  ok: "bg-status-ok glow-ok",
  warn: "bg-status-warn glow-warn",
  crit: "bg-status-crit glow-crit",
  accent: "bg-primary glow-accent",
};

export function StatGauge({ label, value, unit, pct, tone = "ok" }: Props) {
  return (
    <div className="bg-panel/40 border border-border rounded-2xl p-4 relative overflow-hidden">
      <div className="text-[10px] uppercase text-muted-foreground mb-2 font-bold tracking-widest">
        {label}
      </div>
      <div className="text-2xl font-mono leading-none">
        {value}
        {unit && <span className="text-xs text-muted-foreground/60 ml-1">{unit}</span>}
      </div>
      <div className="h-1.5 bg-white/5 mt-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${toneClass[tone]}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}
