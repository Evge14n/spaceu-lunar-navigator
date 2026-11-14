# SpaceU Lunar Navigator

NASA Space Apps Challenge 2026, challenge **Lunar Landing Site Navigator**. Team **SpaceU** (Kyiv).

A web tool that compares landing sites and dates at the lunar south pole by two things a mission cannot do without: **sunlight** (power) and **a view of Earth** (direct communication). Pick sites and a period, and see how much of the time each site is lit, how long the longest darkness lasts, when Earth is visible, and how many hours remain until the next sunset and Earthset, with the real mountains on the horizon taken into account.

## What is inside

| Folder | What | Owner |
|---|---|---|
| `backend/` | Python: Sun and Earth positions (NAIF SPICE), horizon masks from LOLA terrain, metrics, FastAPI | Yevhen |
| `data/` | site list, precomputed JSON for the demo, terrain tiles for 3D | Yevhen |
| `frontend/` | React app: map, comparison table, timeline chart, 3D view, explanations | Anastasiia U., Anastasiia Sh. |
| `docs/` | architecture, API contract, validation, task plan | everyone |

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the API contract is in [docs/API.md](docs/API.md), the plan for the weekend is in [docs/TASKS.md](docs/TASKS.md).

## NASA data

- NAIF SPICE generic kernels (NASA/JPL): `naif0012.tls`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `pck00011.tpc`.
- LOLA polar elevation models, LRO (PDS Geosciences Node): `ldem_85s_20m`, `ldem_80s_80m`.
- LOLA 5 m/pixel site models (NASA PGDA; Barker et al. 2021, https://doi.org/10.1016/j.pss.2020.105119).
- LOLA illumination maps (NASA PGDA; Mazarico et al. 2011, https://doi.org/10.1016/j.icarus.2010.10.030), used as a map layer and for validation.
- JPL Horizons API, used only as a reference in tests.

## Use of AI

AI tools assisted with writing code.

## License

Apache-2.0.
