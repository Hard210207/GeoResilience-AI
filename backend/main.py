from pathlib import Path
from typing import Any, Dict, List, Optional
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import networkx as nx
import numpy as np
from pyproj import Transformer

# Try importing sknw; if unavailable, a fallback skeleton graph builder is provided
try:
    import sknw
except ImportError:
    sknw = None

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load data and construct graph on server startup
    if cached_graph_payload is None:
        initialize_data_and_graph()
    yield

# Initialize FastAPI application with lifespan
app = FastAPI(
    title="GeoResilience AI - Backend Routing Engine",
    description="FastAPI backend loading satellite road skeleton & cost maps, building topological graphs with NetworkX, and transforming EPSG:32643 metric coordinates to EPSG:4326 spherical coordinates via pyproj.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend applications (Leaflet, MapLibre, React, Streamlit, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Constants & Coordinate Reference System (CRS) Transform Configuration
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SKELETON_PATH = DATA_DIR / "skeleton.npy"
COST_MAP_PATH = DATA_DIR / "cost_map.npy"

# Mumbai SpaceNet 5 (AOI 8) UTM Zone 43N (EPSG:32643) Extents
# Top-Left: (Easting: 273669.1958m, Northing: 2100455.1061m)
# Bottom-Right: (Easting: 274049.0542m, Northing: 2100045.9271m)
DEFAULT_ORIGIN_UTM_X = 273669.1957842016
DEFAULT_ORIGIN_UTM_Y = 2100455.1060993737
DEFAULT_MAX_UTM_X = 274049.0541976987
DEFAULT_MIN_UTM_Y = 2100045.927091601
DEFAULT_GSD = 0.3077  # Ground Sample Distance: ~0.3077 meters/pixel

# Pyproj Transformer from metric UTM Zone 43N to spherical WGS84
# always_xy=True guarantees (Longitude, Latitude) order
transformer = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True)

# Global variables for loaded data & built graph
skeleton_data: Optional[np.ndarray] = None
cost_map_data: Optional[np.ndarray] = None
network_graph: Optional[nx.Graph] = None
cached_graph_payload: Optional[Dict[str, Any]] = None
cached_geojson_payload: Optional[Dict[str, Any]] = None


def pixel_to_coordinates(
    row: float,
    col: float,
    img_height: int = 1300,
    img_width: int = 1300
) -> Dict[str, Any]:
    """
    Transforms pixel coordinates (row, col) into:
    1. Metric coordinates in UTM Zone 43N (EPSG:32643)
    2. Spherical coordinates in WGS84 (EPSG:4326) [Longitude, Latitude]
    """
    pixel_size_x = (DEFAULT_MAX_UTM_X - DEFAULT_ORIGIN_UTM_X) / img_width
    pixel_size_y = (DEFAULT_ORIGIN_UTM_Y - DEFAULT_MIN_UTM_Y) / img_height

    # Metric coordinates (EPSG:32643)
    utm_x = DEFAULT_ORIGIN_UTM_X + col * pixel_size_x
    utm_y = DEFAULT_ORIGIN_UTM_Y - row * pixel_size_y

    # Spherical coordinates (EPSG:4326) via pyproj
    lon, lat = transformer.transform(utm_x, utm_y)

    return {
        "pixel": [int(round(row)), int(round(col))],
        "utm": [float(utm_x), float(utm_y)],
        "coordinates": [float(lon), float(lat)],  # [lon, lat] per GeoJSON standard
        "lat": float(lat),
        "lon": float(lon)
    }


def build_graph_from_skeleton(skeleton: np.ndarray, cost_map: np.ndarray) -> nx.Graph:
    """
    Builds a NetworkX graph from a 2D binary morphological skeleton.
    Uses sknw if available, with a pure NetworkX fallback.
    Calculates routing costs along each edge using the cost_map array.
    """
    if sknw is not None:
        raw_graph = sknw.build_sknw(skeleton.astype(np.uint16), multi=False)
        G = raw_graph.copy()
    else:
        # Fallback pure-NetworkX graph constructor using 8-connectivity
        G = nx.Graph()
        points = np.argwhere(skeleton > 0)
        h, w = skeleton.shape

        for r, c in points:
            node_id = int(r * w + c)
            G.add_node(node_id, o=np.array([r, c], dtype=np.uint16), pts=np.array([[r, c]]))
            # Connect to 8-neighbors
            for dr, dc in [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < h and 0 <= nc < w and skeleton[nr, nc]:
                    neighbor_id = int(nr * w + nc)
                    dist = np.hypot(dr, dc)
                    G.add_edge(node_id, neighbor_id, pts=np.array([[r, c], [nr, nc]]), weight=dist)

    # Compute Betweenness Centrality for critical infrastructure identification
    # Algorithmic optimization: sample pivot nodes if graph is large
    sample_size = min(len(G.nodes()), 150)
    centrality_dict = nx.betweenness_centrality(G, k=sample_size, weight="weight")
    
    # Determine gatekeeper threshold (90th percentile)
    c_values = list(centrality_dict.values())
    threshold = float(np.percentile(c_values, 90)) if c_values else 0.0

    # Enrich nodes with centrality attributes
    for n in G.nodes():
        score = float(centrality_dict.get(n, 0.0))
        G.nodes[n]["centrality"] = score
        G.nodes[n]["is_gatekeeper"] = bool(score >= threshold)
        G.nodes[n]["degree"] = int(G.degree(n))

    # Enrich edges with cost map traversal weight and physical metric lengths
    h, w = cost_map.shape
    for u, v, data in G.edges(data=True):
        pts = data.get("pts", [])
        total_friction = 0.0
        for pt in pts:
            pr, pc = int(pt[0]), int(pt[1])
            if 0 <= pr < h and 0 <= pc < w:
                total_friction += float(cost_map[pr, pc])
        
        pixel_length = float(data.get("weight", len(pts)))
        metric_length = pixel_length * DEFAULT_GSD
        # Routing cost balances physical distance with friction surface
        routing_weight = metric_length * (1.0 + 3.0 * (total_friction / max(len(pts), 1)))

        data["routing_weight"] = float(routing_weight)
        data["metric_length"] = float(metric_length)
        data["friction_cost"] = float(total_friction)

    return G


def build_serialized_payloads(
    G: nx.Graph,
    cost_map: np.ndarray
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Serializes NetworkX graph to both:
    1. A comprehensive Graph JSON structure with EPSG:4326 spherical coordinates
    2. An RFC 7946 compliant GeoJSON FeatureCollection
    """
    h, w = cost_map.shape
    nodes_list = []
    node_features = []

    for n, data in G.nodes(data=True):
        pt = data.get("o", [0, 0])
        r, c = float(pt[0]), float(pt[1])
        geo = pixel_to_coordinates(r, c, img_height=h, img_width=w)
        
        node_item = {
            "id": int(n),
            "pixel": geo["pixel"],
            "utm": geo["utm"],
            "coordinates": geo["coordinates"],  # [lon, lat]
            "lat": geo["lat"],
            "lon": geo["lon"],
            "degree": data.get("degree", int(G.degree(n))),
            "centrality": data.get("centrality", 0.0),
            "is_gatekeeper": data.get("is_gatekeeper", False)
        }
        nodes_list.append(node_item)

        node_features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": geo["coordinates"]
            },
            "properties": {
                "id": int(n),
                "type": "node",
                "degree": node_item["degree"],
                "centrality": node_item["centrality"],
                "is_gatekeeper": node_item["is_gatekeeper"]
            }
        })

    edges_list = []
    edge_features = []

    for idx, (u, v, data) in enumerate(G.edges(data=True)):
        pts = data.get("pts", [])
        line_coords_spherical = []
        line_coords_metric = []
        line_pixel_pts = []

        for pt in pts:
            pr, pc = float(pt[0]), float(pt[1])
            geo = pixel_to_coordinates(pr, pc, img_height=h, img_width=w)
            line_coords_spherical.append(geo["coordinates"])
            line_coords_metric.append(geo["utm"])
            line_pixel_pts.append(geo["pixel"])

        # Fallback if pts is empty
        if not line_coords_spherical:
            u_pt = G.nodes[u].get("o", [0, 0])
            v_pt = G.nodes[v].get("o", [0, 0])
            geo_u = pixel_to_coordinates(u_pt[0], u_pt[1], img_height=h, img_width=w)
            geo_v = pixel_to_coordinates(v_pt[0], v_pt[1], img_height=h, img_width=w)
            line_coords_spherical = [geo_u["coordinates"], geo_v["coordinates"]]
            line_coords_metric = [geo_u["utm"], geo_v["utm"]]
            line_pixel_pts = [geo_u["pixel"], geo_v["pixel"]]

        edge_item = {
            "id": idx,
            "source": int(u),
            "target": int(v),
            "weight_pixels": float(data.get("weight", len(pts))),
            "weight_meters": float(data.get("metric_length", len(pts) * DEFAULT_GSD)),
            "routing_weight": float(data.get("routing_weight", 0.0)),
            "friction_cost": float(data.get("friction_cost", 0.0)),
            "coordinates": line_coords_spherical,  # [[lon, lat], ...]
            "metric_coordinates": line_coords_metric,  # [[x, y], ...] in EPSG:32643
            "pixel_coordinates": line_pixel_pts
        }
        edges_list.append(edge_item)

        edge_features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": line_coords_spherical
            },
            "properties": {
                "id": idx,
                "source": int(u),
                "target": int(v),
                "weight_meters": edge_item["weight_meters"],
                "routing_weight": edge_item["routing_weight"],
                "friction_cost": edge_item["friction_cost"]
            }
        })

    connected_components = list(nx.connected_components(G))
    top_gatekeeper = max(nodes_list, key=lambda x: x["centrality"]) if nodes_list else None

    graph_payload = {
        "status": "success",
        "crs": "EPSG:4326",
        "source_crs": "EPSG:32643",
        "metadata": {
            "node_count": len(nodes_list),
            "edge_count": len(edges_list),
            "connected_components": len(connected_components),
            "largest_component_size": max(len(c) for c in connected_components) if connected_components else 0,
            "top_choke_point": top_gatekeeper["id"] if top_gatekeeper else None,
            "top_centrality": top_gatekeeper["centrality"] if top_gatekeeper else 0.0,
            "utm_bounds": {
                "min_easting": DEFAULT_ORIGIN_UTM_X,
                "max_easting": DEFAULT_MAX_UTM_X,
                "min_northing": DEFAULT_MIN_UTM_Y,
                "max_northing": DEFAULT_ORIGIN_UTM_Y
            },
            "wgs84_bounds": {
                "west": float(transformer.transform(DEFAULT_ORIGIN_UTM_X, DEFAULT_MIN_UTM_Y)[0]),
                "east": float(transformer.transform(DEFAULT_MAX_UTM_X, DEFAULT_ORIGIN_UTM_Y)[0]),
                "south": float(transformer.transform(DEFAULT_ORIGIN_UTM_X, DEFAULT_MIN_UTM_Y)[1]),
                "north": float(transformer.transform(DEFAULT_MAX_UTM_X, DEFAULT_ORIGIN_UTM_Y)[1])
            }
        },
        "nodes": nodes_list,
        "edges": edges_list
    }

    geojson_payload = {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}
        },
        "metadata": graph_payload["metadata"],
        "features": edge_features + node_features
    }

    return graph_payload, geojson_payload


def initialize_data_and_graph():
    """Loads numpy arrays and builds the graph during startup."""
    global skeleton_data, cost_map_data, network_graph, cached_graph_payload, cached_geojson_payload

    if not SKELETON_PATH.exists() or not COST_MAP_PATH.exists():
        raise FileNotFoundError(
            f"Missing required data files. Checked: {SKELETON_PATH} and {COST_MAP_PATH}"
        )

    print(f"Loading skeleton from {SKELETON_PATH}...")
    skeleton_data = np.load(SKELETON_PATH)
    print(f"Loading cost map from {COST_MAP_PATH}...")
    cost_map_data = np.load(COST_MAP_PATH)

    print(f"Skeleton shape: {skeleton_data.shape}, Cost map shape: {cost_map_data.shape}")
    print("Building topological graph with NetworkX...")
    network_graph = build_graph_from_skeleton(skeleton_data, cost_map_data)
    print(f"Graph constructed successfully with {len(network_graph.nodes())} nodes and {len(network_graph.edges())} edges.")

    print("Pre-serializing graph and GeoJSON payloads with pyproj coordinate transformation...")
    cached_graph_payload, cached_geojson_payload = build_serialized_payloads(network_graph, cost_map_data)
    print("Initialization complete! Ready to serve requests.")


# ---------------------------------------------------------------------------
# REST API Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def read_root():
    """Root endpoint welcoming users and providing navigation links."""
    return {
        "project": "GeoResilience AI",
        "message": "FastAPI Graph Engine is running.",
        "documentation": "/docs",
        "endpoints": {
            "graph": "/api/graph",
            "geojson": "/api/graph/geojson",
            "health": "/api/health",
            "stats": "/api/stats",
            "shortest_path": "/api/shortest-path?source=0&target=1",
            "disaster_simulation": "/api/simulate-disaster"
        }
    }


@app.get("/api/health")
def health_check():
    """Health check endpoint showing memory, graph status, and loaded files."""
    return {
        "status": "healthy",
        "files_loaded": {
            "skeleton": str(SKELETON_PATH),
            "cost_map": str(COST_MAP_PATH)
        },
        "shapes": {
            "skeleton": list(skeleton_data.shape) if skeleton_data is not None else None,
            "cost_map": list(cost_map_data.shape) if cost_map_data is not None else None
        },
        "graph_nodes": len(network_graph.nodes()) if network_graph else 0,
        "graph_edges": len(network_graph.edges()) if network_graph else 0
    }


@app.get("/api/graph")
@app.get("/graph")
def get_graph(downsample: int = Query(1, ge=1, le=50, description="Downsample edge points for lower bandwidth")):
    """
    Returns the complete graph (nodes and edges) as JSON.
    Coordinates are transformed from metric EPSG:32643 to spherical EPSG:4326 via pyproj.
    """
    if cached_graph_payload is None:
        raise HTTPException(status_code=503, detail="Graph not initialized yet.")

    if downsample == 1:
        return cached_graph_payload

    # Downsampled edge points if requested
    payload_copy = dict(cached_graph_payload)
    downsampled_edges = []
    for edge in cached_graph_payload["edges"]:
        e_copy = dict(edge)
        coords = edge["coordinates"]
        if len(coords) > 2:
            sampled = coords[::downsample]
            if sampled[-1] != coords[-1]:
                sampled.append(coords[-1])
            e_copy["coordinates"] = sampled
        downsampled_edges.append(e_copy)

    payload_copy["edges"] = downsampled_edges
    return payload_copy


@app.get("/api/graph/geojson")
@app.get("/graph/geojson")
def get_graph_geojson():
    """
    Returns the graph formatted as an RFC 7946 standard GeoJSON FeatureCollection.
    Ready for direct rendering in MapLibre, Leaflet, Mapbox, or GIS applications.
    """
    if cached_geojson_payload is None:
        raise HTTPException(status_code=503, detail="GeoJSON not initialized yet.")
    return cached_geojson_payload


@app.get("/api/stats")
def get_system_stats():
    """Provides statistical metrics for road cost map and topological network."""
    if cost_map_data is None or network_graph is None:
        raise HTTPException(status_code=503, detail="System not initialized.")

    components = list(nx.connected_components(network_graph))
    degrees = [network_graph.degree(n) for n in network_graph.nodes()]

    return {
        "cost_map": {
            "min_friction": float(cost_map_data.min()),
            "max_friction": float(cost_map_data.max()),
            "mean_friction": float(cost_map_data.mean()),
            "shape": list(cost_map_data.shape)
        },
        "network": {
            "total_nodes": len(network_graph.nodes()),
            "total_edges": len(network_graph.edges()),
            "average_degree": float(np.mean(degrees)) if degrees else 0.0,
            "connected_components": len(components),
            "isolated_subgraphs": sum(1 for c in components if len(c) == 1)
        }
    }


@app.get("/api/shortest-path")
def calculate_shortest_path(source: int, target: int, weight: str = Query("routing_weight", enum=["routing_weight", "metric_length", "weight"])):
    """
    Calculates the shortest or least-cost route between two nodes.
    Weight options: 'routing_weight' (friction-aware), 'metric_length' (physical meters).
    """
    if network_graph is None:
        raise HTTPException(status_code=503, detail="Graph not initialized.")

    if not network_graph.has_node(source) or not network_graph.has_node(target):
        raise HTTPException(
            status_code=404,
            detail=f"One or both nodes not found. Available nodes: 0 to {max(network_graph.nodes())}"
        )

    try:
        path = nx.shortest_path(network_graph, source=source, target=target, weight=weight)
        path_length = nx.shortest_path_length(network_graph, source=source, target=target, weight=weight)
        
        # Convert path nodes to EPSG:4326 coordinates
        path_coords = []
        h, w = cost_map_data.shape
        for node in path:
            pt = network_graph.nodes[node]["o"]
            geo = pixel_to_coordinates(pt[0], pt[1], img_height=h, img_width=w)
            path_coords.append(geo["coordinates"])

        return {
            "status": "success",
            "source": source,
            "target": target,
            "weight_metric": weight,
            "total_cost": float(path_length),
            "hops": len(path) - 1,
            "node_path": path,
            "coordinates": path_coords
        }
    except nx.NetworkXNoPath:
        raise HTTPException(
            status_code=400,
            detail=f"No connected path exists between node {source} and node {target} (isolated topological components)."
        )


@app.post("/api/simulate-disaster")
def simulate_disaster(
    target_node: Optional[int] = Query(None, description="Target node ID for ablation"),
    radius_meters: Optional[float] = Query(None, description="Destruction radius around node in meters")
):
    """
    Simulates disaster destruction (targeted ablation or flood radius)
    and reports topological fractures and remaining connected components.
    """
    if network_graph is None:
        raise HTTPException(status_code=503, detail="Graph not initialized.")

    G_sim = network_graph.copy()
    destroyed_nodes = []

    if target_node is not None:
        if not G_sim.has_node(target_node):
            raise HTTPException(status_code=404, detail=f"Target node {target_node} does not exist.")

        if radius_meters is None or radius_meters <= 0:
            # Single node targeted destruction
            destroyed_nodes.append(target_node)
            G_sim.remove_node(target_node)
        else:
            # Flood radius destruction in meters
            center_px = np.array(network_graph.nodes[target_node]["o"])
            rad_px = radius_meters / DEFAULT_GSD
            for n in list(G_sim.nodes()):
                n_px = np.array(network_graph.nodes[n]["o"])
                if np.linalg.norm(n_px - center_px) <= rad_px:
                    destroyed_nodes.append(n)
            G_sim.remove_nodes_from(destroyed_nodes)

    components_after = list(nx.connected_components(G_sim))
    initial_components = nx.number_connected_components(network_graph)
    is_partitioned = len(components_after) > initial_components

    return {
        "status": "success",
        "destroyed_nodes_count": len(destroyed_nodes),
        "destroyed_nodes": destroyed_nodes,
        "remaining_nodes": len(G_sim.nodes()),
        "remaining_edges": len(G_sim.edges()),
        "initial_connected_components": initial_components,
        "current_connected_components": len(components_after),
        "network_fractured": is_partitioned,
        "diagnosis": (
            f"CRITICAL FAILURE: Network fractured into {len(components_after)} disconnected islands!"
            if is_partitioned
            else "RESILIENT: Redundant pathways preserved reachability."
        )
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
