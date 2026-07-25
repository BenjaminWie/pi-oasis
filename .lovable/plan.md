## Warum die Kosten hoch sind

Die "Zero-Wake"-Architektur haben wir serverseitig umgesetzt (Live-Relay via Broadcast, Session-Aggregation, 15-min Heartbeat). Aber die **Cloud-UI selbst pollt weiterhin sehr aggressiv** — jedes offene Browser-Tab läuft dauerhaft gegen Supabase:

| Ort | aktuelles Intervall | Rows pro Query |
|---|---|---|
| `_cloud/devices/index` (Liste) | **5 s** | alle Devices des Users |
| `_cloud/devices/$id` (Detail) | **5 s** Device + **8 s** Events(20) | 1 Row + 20 Events |
| `_cloud/pump` | 5 min Devices, **Realtime-Subscribe** | — |
| `_authenticated/overview` | 5 s + 10 s | Pi-lokal (kein Supabase) |
| `_authenticated/mqtt` | **2 s** Messages | Pi-lokal |
| `_authenticated/plugins.index` / `plugins.$id` | 10 s / 5 s | Pi-lokal |
| `_authenticated/settings` | 10 s | Pi-lokal |
| `_authenticated/integrations` | 15 s | Pi-lokal |
| `BottomNav` (jede Cloud-Seite) | 30 s `listMqttBrokers` | Pi-lokal |
| `connections.mcp` | 10 s | tokens+audit |
| `DeviceAnalytics` | 30 s + 5 min | events+buckets |
| `use-dynamic-favicon` | 5 min + Realtime-Subscribe auf `devices` | — |

Rechenbeispiel worst case: `/_cloud/devices/$id` einen Tag offen  
= 17 280 Device-Reads + 10 800 Event-Reads = **~28k Requests/Tag pro Tab** — allein diese Seite treibt den heutigen 2-Credit-Verbrauch.

Dazu kommt:
- `favicon`-Hook öffnet auf **jeder** Seite einen persistenten Realtime-Channel auf `devices` (Broadcast ist billig, aber der `postgres_changes`-Subscribe erzeugt DB-Traffic bei jedem Update).
- Cloud-Seiten setzen `staleTime` nicht → jeder Fokuswechsel refetcht sofort.
- Kein `visibilityState`-Gate: Tab im Hintergrund pausiert zwar wegen `refetchIntervalInBackground:false`, aber `focus`-Refetch feuert on-return trotzdem.

## Ziel

Von ~2 Credits/Tag auf **≤0.5 Credits/Tag**, ohne UX-Qualität in der Cloud zu verlieren. Pi-lokale Polls (Overview/MQTT/Plugins/Settings) treffen Supabase **nicht** — die lassen wir bewusst so, das ist keine DB-Last.

## Änderungen

### 1. Cloud-Polls verlangsamen + Broadcast bevorzugen
- `_cloud/devices/index`: 5 s → **60 s**, `staleTime: 60_000`, `refetchOnWindowFocus: false`.
- `_cloud/devices/$id`:
  - Device-Snapshot 5 s → **30 s**, plus Realtime-Subscribe auf `device_state_latest` Broadcast-Channel für Live-Werte (Node-RED published da bereits hin) — der 30-s-Poll wird nur Fallback.
  - Events 8 s → **30 s** (letzte 20 Events reichen für UX).
- `connections.mcp` 10 s → **60 s**, `refetchOnWindowFocus: false`.
- `BottomNav.listMqttBrokers`: Ergebnis ist Pi-lokal (kein DB-Cost), aber jede Cloud-Route mountet es. Trotzdem harmlos — belassen, nur `staleTime: 5*60_000` setzen um Focus-Refetches zu killen.

### 2. Favicon-Hook entschärfen
- `use-dynamic-favicon` in `__root` oder Provider laufen lassen (single-instance), **nicht** in `BottomNav` / Seiten mehrfach. Realtime-Subscribe von `postgres_changes` → **`device_state_latest`-Broadcast** umziehen (Node-RED published dort schon). Fallback-Query 5 min → **15 min**.

### 3. Global React-Query Defaults
In `src/router.tsx` (QueryClient-Erzeugung):
```ts
defaultOptions: {
  queries: {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: "always",
  },
}
```
Verhindert Focus-Storms und deckelt Refetch-Kosten für alle bestehenden `useQuery`s ohne pro-Aufruf-Override.

### 4. DeviceAnalytics
- 30 s → **2 min** (Analytics-Charts brauchen keine Sekunden-Auflösung).
- 5 min bleibt.

### 5. Kein Datenbank-Schema-Change nötig
Keine Migrations, keine Server-Function-Änderungen, kein Voice/Alexa/Telegram-Impact. Reine Client-Frequenz-Anpassung + Broadcast-Wiederverwendung.

## Erwarteter Effekt

Ein permanent offener Device-Detail-Tab: 28 000 → **~3 800 Requests/Tag** (−86 %). Devices-Liste offen: 17 000 → **1 440 Requests/Tag** (−92 %). MCP-Seite: 8 600 → 1 440 (−83 %). Damit landen wir realistisch unter 0.5 Credits/Tag, sofern nicht mehrere Tabs 24/7 offen sind.

## Nach dem Umbau

- 1 Tag beobachten via `supabase--slow_queries` / Credits-Balance-Tool.
- Falls immer noch zu hoch: Device-Detail-Live-Werte komplett auf Broadcast-only (Poll deaktivieren, nur On-Focus einmal laden).

## Technische Referenzen (für den Build-Turn)
- Files: `src/router.tsx`, `src/routes/_cloud/devices.index.tsx`, `src/routes/_cloud/devices.$id.tsx`, `src/routes/_cloud/connections.mcp.tsx`, `src/hooks/use-dynamic-favicon.ts`, `src/components/DeviceAnalytics.tsx`, `src/components/BottomNav.tsx`.
- Broadcast-Channel für Live-State existiert bereits (`/api/public/live/publish` + `device_state_latest`) — nur clientseitig abonnieren.
