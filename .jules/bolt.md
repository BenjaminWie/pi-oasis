## 2025-05-15 - [Isolate high-frequency UI updates]
**Learning:** In React, putting a high-frequency timer (e.g., 1s interval) in a large page-level component causes the entire tree to re-render. This is especially expensive when the page contains complex components like Recharts or large data tables.
**Action:** Always move high-frequency state into the smallest possible leaf component to minimize the re-render surface. Pass necessary data as props and memoize expensive computations in the parent.
