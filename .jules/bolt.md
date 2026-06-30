## 2025-06-30 - [Memoization in complex dashboard pages]
**Learning:** In pages with frequent data updates (polling) and interactive elements (forms), derived data calculations that involve array operations (filter, find) can cause noticeable UI lag if not memoized. The PumpPage in this project is a prime example where 7+ variables were being derived from a 100-item events array on every render.
**Action:** Always use useMemo for data derivation in complex, high-frequency dashboard components to ensure smooth interaction while polling.
