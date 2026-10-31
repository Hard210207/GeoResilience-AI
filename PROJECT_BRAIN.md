# SYSTEM MEMORY & ARCHITECTURAL LOCK: GEORESILIENCE AI
**Role Instruction:** Act as my technical co-architect and strategic sparring partner. You already know this project inside out. Do not lecture, do not rewrite working pipelines unless asked, and never regress on the "Graveyard of Solved Bugs" listed below.

---

## 1. PROJECT IDENTITY & CURRENT PROGRESS (75% MILESTONE)
**Project:** GeoResilience AI — An occlusion-robust, 4-layer satellite road extraction and urban route resilience simulator.
* **Completed (75%):**
  * **Layer 1 (Deep Learning Perception):** SpaceNet Mumbai dataset (1,016 tiles, `1300x1300` px, 80/20 split). ResNet-18 U-Net (`segmentation_models_pytorch`) trained for 30 epochs on Kaggle GPU with `BCEWithLogitsLoss + DiceLoss`, Adam (`lr=1e-3`), and `ReduceLROnPlateau`. Achieved **56.96% Validation IoU** (`0.5696`, Val Loss `0.4611`).
  * **Layer 1.5 (Topological Translation Bridge):** Converts logits to probability map $P(y,x) = \sigma(\text{logits})$, routing friction map $\text{Cost}(y,x) = 1.0 - P(y,x)$ (`cost_map.npy`), and 1-pixel centerline (`skeleton.npy`) using a strict **$P > 0.65$ threshold** + `skimage.morphology.skeletonize`.
  * **Layer 2 (Graph Extraction, Sanitization & Topological Healing):** Physical anchor `GSD = 0.3077 m/px`. Extracts raw graph via `sknw` (62 nodes, 52 edges on test tile) -> prunes dead-end spurs `< 15.0m` (`48.7 px`, removes 22 spurs) -> collapses intersection micro-clusters within `10.0m` (`32.5 px`, collapses 2 clusters) into `G_sanitized` (38 nodes, 34 edges). Integrates physics-informed edge weights: $W_{\text{edge}} = \sum (1.0 + 5.0 \cdot \text{Cost}(y,x))$. Heals tree/shadow occlusions using a `KDTree` (`60.0m` / `195 px` search radius on degree-1 nodes) + directional vector alignment filter ($\mathbf{v}_A \cdot \mathbf{d}_{AB} > 0.70$ over last 5 pixels) + minimum-cost A* / MST stitching (`route_through_array`).
  * **Layer 3 (Vulnerability & Choke-Point Engine):** Computes weighted `nx.betweenness_centrality` using `routing_weight`. Verified top choke points on primary test tile: Node 35 (`0.1426`), Node 31 (`0.1336`), Node 34 (`0.1081`), Node 30 (`0.0976`), Node 51 (`0.0886`).
  * **Layer 4 (Disaster Ablation & Automated Mitigation):** Simulates targeted node destruction (`simulate_targeted_attack`) and radial flooding (`simulate_geographic_flood`, `100.0m` radius). Evaluates connected component fracturing and computes pairwise Euclidean distances between severed subgraphs to inject minimum-cost emergency relief roads (e.g., `17.6m` bypass connecting Node 36 to Node 37 in `G_fortified`).
  * **Live Processing Engine & UI Stabilization:** Integrated FastAPI backend with interactive frontend/dashboard. Stabilized live rendering to trace real-world street geometries over high-resolution satellite RGB imagery with transparent road-only overlays.
* **Remaining Roadmap (25% Next Steps):**
  1. **Sliding-Window Inference Engine:** Scale Layer 1/2 inference across massive arbitrary satellite tiles without OOM or boundary seam artifacts.
  2. **GIS-Standard Export Pipeline:** Export healed/fortified NetworkX graphs (`G_healed`, `G_fortified`) and node/edge attributes into standard GIS formats (**GeoJSON / Shapefiles**) with proper spatial CRS mapping.
  3. **Final Evaluation & Packaging:** End-to-end stress testing, documentation, and presentation artifacts.

---

## 2. GRAVEYARD OF SOLVED BUGS (NEVER RE-INTRODUCE THESE)
1. **No Building Footprint / Opaque Overlay Artifacts:** We explicitly eliminated building footprint artifacts and opaque masks in the live engine. Always preserve high-res satellite RGB base layers with transparent road-only overlays.
2. **Strict Thresholding ($0.65$ vs $0.50$):** Never lower the skeletonization probability threshold back to `0.50`—it floods `sknw` with false-positive geometric spurs. Keep `P > 0.65`.
3. **Vector Alignment Before A* Stitching:** Never connect nearby dead-end nodes purely by Euclidean proximity or raw A* cost—it short-circuits parallel roads. Always enforce the directional dot-product cone filter (`dot > 0.70`) first.
4. **Kaggle Double-Nested Path & Multi-Extension Lock:** On Kaggle, the dataset nests as `/kaggle/input/datasets/ndsolanki/isro-dataset/PS-RGB/PS-RGB` and uses `.tif`, `.tiff`, and `.png`. Never revert to a single `*.tif` glob.
5. **NetworkX Matplotlib `zorder` Bug:** `nx.draw_networkx_nodes` does not accept `zorder` as a direct keyword argument in our environment (throws `TypeError`). Layer order is controlled by execution sequence.

---

## 3. CURRENT SESSION OBJECTIVE
[Tell me what we are building or debugging today]