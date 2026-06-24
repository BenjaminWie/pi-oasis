// Open-Meteo forecast lookup. Free, no key. Server-only.

export interface WeatherForecast {
  generatedAt: string;
  lat: number;
  lon: number;
  // next-6h totals derived from hourly series
  rainMmNext6h: number;
  rainMmNext24h: number;
  maxTempCNext24h: number;
  minTempCNext24h: number;
  hourly: Array<{ time: string; precipitation: number; temperature: number }>;
}

export async function fetchForecast(lat: number, lon: number): Promise<WeatherForecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation,temperature_2m&forecast_days=2&timezone=UTC`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j = (await r.json()) as {
    hourly: { time: string[]; precipitation: number[]; temperature_2m: number[] };
  };
  const now = Date.now();
  const hourly = j.hourly.time.map((t, i) => ({
    time: t + "Z", // open-meteo returns UTC w/o suffix
    precipitation: j.hourly.precipitation[i] ?? 0,
    temperature: j.hourly.temperature_2m[i] ?? 0,
  }));
  const future = hourly.filter((h) => new Date(h.time).getTime() >= now);
  const next6 = future.slice(0, 6);
  const next24 = future.slice(0, 24);
  const sum = (xs: { precipitation: number }[]) =>
    xs.reduce((a, b) => a + (b.precipitation || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    lat,
    lon,
    rainMmNext6h: Math.round(sum(next6) * 10) / 10,
    rainMmNext24h: Math.round(sum(next24) * 10) / 10,
    maxTempCNext24h: Math.max(...next24.map((h) => h.temperature)),
    minTempCNext24h: Math.min(...next24.map((h) => h.temperature)),
    hourly: next24,
  };
}
