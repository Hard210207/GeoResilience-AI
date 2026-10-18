# GeoResilience AI 🌍🛰️

GeoResilience AI is an intelligent geospatial routing and infrastructure resilience analysis platform. It leverages satellite-derived road skeleton topology, geospatial cost surfaces, and graph algorithms to compute resilient, hazard-aware routing pathways.

---

## 🌟 Key Features

- **Satellite Skeleton Graph Extraction**: Parses topological road network structures from satellite imagery masks.
- **Cost-Weighted Routing**: Uses real-time and simulated impedance cost surfaces (e.g., flood zones, terrain difficulty, damage levels) to evaluate optimal traversal paths.
- **CRS Transformation Engine**: Seamlessly transforms metric UTM coordinates (`EPSG:32643`) to geographic coordinates (`EPSG:4326`) for interactive web mapping.
- **Interactive Geospatial Dashboard**: React + Vite frontend with dynamic mapping controls, resilience metric visualizations, and route simulation.

---

## 🏗️ Architecture

```text
GeoResilience-AI/
├── backend/
│   ├── data/
│   │   ├── skeleton.npy      # Binary road skeleton matrix
│   │   └── cost_map.npy      # Traversability cost raster
│   ├── main.py               # FastAPI routing & graph server
│   └── requirements.txt      # Python dependencies
└── frontend/
    ├── src/                  # React dashboard components & styles
    ├── public/               # Static assets & icons
    ├── index.html            # Entry HTML
    ├── package.json          # Node dependencies
    └── vite.config.js        # Vite build configuration
```

---

## 🚀 Getting Started

### 1. Backend Setup (FastAPI)

```bash
cd backend

# Create and activate virtual environment (optional but recommended)
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the backend server
uvicorn main:app --reload --port 8000
```

The FastAPI API documentation will be available at `http://localhost:8000/docs`.

### 2. Frontend Setup (React + Vite)

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.10+, FastAPI, NetworkX, NumPy, SciPy, PyProj, Uvicorn
- **Frontend**: React, Vite, CSS3
- **Geospatial Processing**: Metric/Spherical CRS projection (`EPSG:32643` ↔ `EPSG:4326`), Topological skeleton graphs
