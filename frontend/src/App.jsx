import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';

const API_BASE = 'http://localhost:8000';

// Component to dynamically fit the map view to graph bounds
function MapBoundsFitter({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length === 2) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18, animate: true });
    }
  }, [bounds, map]);
  return null;
}

// Helper component to fix Leaflet tile rendering issues on container resize / mount
function FixMapResize() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 500);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

export default function App() {
  const [graphData, setGraphData] = useState(null);
  const [statsData, setStatsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [backendOnline, setBackendOnline] = useState(false);

  // Visualization filters & toggles
  const [showEdges, setShowEdges] = useState(true);
  const [showNodes, setShowNodes] = useState(true);
  const [highlightGatekeepers, setHighlightGatekeepers] = useState(true);
  const [basemapStyle, setBasemapStyle] = useState('dark'); // 'dark' | 'satellite' | 'streets'

  // Disaster Simulation State
  const [ablatedNodes, setAblatedNodes] = useState([]);
  const [simulationResult, setSimulationResult] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [simulating, setSimulating] = useState(false);

  // Inspector Details
  const [inspectedEntity, setInspectedEntity] = useState(null);

  // Fetch graph data from FastAPI backend
  const fetchGraph = async () => {
    setLoading(true);
    setError(null);
    try {
      const [graphRes, healthRes] = await Promise.all([
        axios.get(`${API_BASE}/api/graph`),
        axios.get(`${API_BASE}/api/health`)
      ]);

      setGraphData(graphRes.data);
      setBackendOnline(healthRes.data?.status === 'healthy');
      
      // Select top choke point by default if available
      if (graphRes.data?.metadata?.top_choke_point !== undefined) {
        setSelectedNodeId(String(graphRes.data.metadata.top_choke_point));
      }
    } catch (err) {
      console.error('Failed to fetch from backend:', err);
      setError(err.message || 'Cannot reach FastAPI backend on http://localhost:8000');
      setBackendOnline(false);
    } finally {
      setLoading(false);
    }
  };

  // Fetch supplementary stats
  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/stats`);
      setStatsData(res.data);
    } catch {
      // Non-critical endpoint
    }
  };

  useEffect(() => {
    fetchGraph();
    fetchStats();
  }, []);

  // Compute bounding box for Leaflet: [[south, west], [north, east]]
  const mapBounds = useMemo(() => {
    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
      // Default to Mumbai AOI center
      return [[18.979, 72.849], [18.986, 72.855]];
    }
    const lats = graphData.nodes.map(n => n.lat);
    const lons = graphData.nodes.map(n => n.lon);
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)]
    ];
  }, [graphData]);

  // Center coordinate for Leaflet
  const mapCenter = useMemo(() => {
    if (!mapBounds) return [18.9823, 72.8520];
    return [
      (mapBounds[0][0] + mapBounds[1][0]) / 2,
      (mapBounds[0][1] + mapBounds[1][1]) / 2
    ];
  }, [mapBounds]);

  // Trigger Disaster Ablation Test via Backend API
  const handleTriggerAblation = async () => {
    if (!selectedNodeId) return;
    setSimulating(true);
    try {
      const res = await axios.post(`${API_BASE}/api/simulate-disaster`, null, {
        params: { target_node: parseInt(selectedNodeId, 10) }
      });
      setSimulationResult(res.data);
      setAblatedNodes(prev => [...new Set([...prev, parseInt(selectedNodeId, 10)])]);
    } catch (err) {
      console.error('Simulation error:', err);
      alert(`Simulation failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSimulating(false);
    }
  };

  // Reset Disaster Simulation
  const handleResetSimulation = () => {
    setAblatedNodes([]);
    setSimulationResult(null);
  };

  // Basemap Tile URLs
  const tileLayers = {
    dark: {
      url: 'https://maps.geoapify.com/v1/tile/dark-matter/{z}/{x}/{y}.png?apiKey=41c7b80a221f456187652758229dcff3',
      attribution: '&copy; OpenMapTiles &copy; OpenStreetMap contributors'
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics'
    },
    streets: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors'
    }
  };

  const totalNodes = graphData?.metadata?.node_count ?? graphData?.nodes?.length ?? 0;
  const totalEdges = graphData?.metadata?.edge_count ?? graphData?.edges?.length ?? 0;
  const connectedComponents = graphData?.metadata?.connected_components ?? 1;
  const topChokePoint = graphData?.metadata?.top_choke_point ?? 'N/A';
  const topCentrality = graphData?.metadata?.top_centrality?.toFixed(4) ?? '0.0000';

  return (
    <div className="dashboard-container" id="geo-resilience-dashboard">
      {/* ----------------------------------------------------------------- */}
      {/* SIDEBAR PANEL */}
      {/* ----------------------------------------------------------------- */}
      <aside className="sidebar" id="sidebar-panel">
        <div className="sidebar-header">
          <div className="brand-badge">
            <span className="pulse-dot"></span>
            GeoResilience AI &bull; ISRO
          </div>
          <h1 className="sidebar-title" id="dashboard-title">
            <span>Urban Mobility</span>
          </h1>
          <p className="sidebar-subtitle">
            Occlusion-robust topological road graph & resilience simulator
          </p>

          <div className={`backend-status-pill ${backendOnline ? 'online' : 'offline'}`} id="backend-status-indicator">
            <span className="status-indicator">
              <span className={`status-dot ${backendOnline ? 'online' : 'offline'}`}></span>
              {backendOnline ? 'FastAPI Connected' : 'Backend Offline'}
            </span>
            <span style={{ opacity: 0.75 }}>:8000</span>
          </div>
        </div>

        <div className="sidebar-body">
          {/* SECTION: BASIC METRICS */}
          <div>
            <div className="section-label">
              <span>Topological Graph Metrics</span>
            </div>
            <div className="metrics-grid">
              <div className="metric-card nodes-card" id="metric-nodes-card">
                <div className="metric-value" id="metric-total-nodes">{totalNodes}</div>
                <div className="metric-title">Total Nodes</div>
                <div className="metric-hint">Intersections & Terminals</div>
              </div>

              <div className="metric-card edges-card" id="metric-edges-card">
                <div className="metric-value" id="metric-total-edges">{totalEdges}</div>
                <div className="metric-title">Total Edges</div>
                <div className="metric-hint">Routable Centerlines</div>
              </div>

              <div className="metric-card components-card" id="metric-components-card">
                <div className="metric-value" id="metric-components-count">
                  {simulationResult ? simulationResult.current_connected_components : connectedComponents}
                </div>
                <div className="metric-title">Partitions</div>
                <div className="metric-hint">
                  {simulationResult?.network_fractured ? 'Fractured Island Count' : 'Connected Components'}
                </div>
              </div>

              <div className="metric-card choke-card" id="metric-choke-card">
                <div className="metric-value" id="metric-top-chokepoint">#{topChokePoint}</div>
                <div className="metric-title">Top Chokepoint</div>
                <div className="metric-hint">Score: {topCentrality}</div>
              </div>
            </div>
          </div>

          {/* SECTION: DISASTER ABLATION STRESS TEST */}
          <div className="panel-card" id="disaster-simulation-panel">
            <div className="section-label" style={{ color: 'var(--neon-rose)' }}>
              <span>Disaster Injection & Stress Test</span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.4 }}>
              Simulate flood or infrastructure destruction on critical gatekeeper nodes to test network fracturing.
            </p>

            <div style={{ marginBottom: '12px' }}>
              <label htmlFor="select-target-node" style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                TARGET NODE FOR ABLATION
              </label>
              <select
                id="select-target-node"
                value={selectedNodeId}
                onChange={(e) => setSelectedNodeId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none'
                }}
              >
                {graphData?.nodes?.map(n => (
                  <option key={n.id} value={n.id}>
                    Node #{n.id} {n.is_gatekeeper ? '★ (Critical Chokepoint)' : ''} — Deg: {n.degree}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                id="btn-trigger-stress-test"
                className="action-btn danger"
                onClick={handleTriggerAblation}
                disabled={simulating || !backendOnline}
              >
                {simulating ? 'Simulating...' : '⚡ Ablate Node'}
              </button>

              {ablatedNodes.length > 0 && (
                <button
                  id="btn-reset-simulation"
                  className="action-btn secondary"
                  onClick={handleResetSimulation}
                  style={{ width: 'auto' }}
                  title="Restore network graph"
                >
                  ↺ Reset
                </button>
              )}
            </div>

            {simulationResult && (
              <div className={`alert-box ${simulationResult.network_fractured ? 'danger' : 'success'}`} id="simulation-diagnosis-alert">
                <strong>{simulationResult.network_fractured ? '⚠️ NETWORK FRACTURED' : '✓ NETWORK RESILIENT'}</strong>
                <div style={{ marginTop: '4px' }}>
                  {simulationResult.diagnosis}
                </div>
                <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.9 }}>
                  Ablated Node #{selectedNodeId} &bull; Partitions: {simulationResult.initial_connected_components} &rarr; {simulationResult.current_connected_components}
                </div>
              </div>
            )}
          </div>

          {/* SECTION: LAYER & VISUALIZATION CONTROLS */}
          <div className="panel-card" id="layer-controls-panel">
            <div className="section-label">
              <span>Map Layer Controls</span>
            </div>
            <div className="controls-group">
              <label className="control-toggle" htmlFor="toggle-edges">
                <span className="toggle-label">
                  <span style={{ display: 'inline-block', width: 14, height: 3, background: 'var(--neon-cyan)', borderRadius: 2 }}></span>
                  Road Edges (Centerlines)
                </span>
                <span className="toggle-switch">
                  <input
                    id="toggle-edges"
                    type="checkbox"
                    checked={showEdges}
                    onChange={(e) => setShowEdges(e.target.checked)}
                  />
                  <span className="slider"></span>
                </span>
              </label>

              <label className="control-toggle" htmlFor="toggle-nodes">
                <span className="toggle-label">
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--neon-cyan)', borderRadius: '50%' }}></span>
                  Graph Nodes (Intersections)
                </span>
                <span className="toggle-switch">
                  <input
                    id="toggle-nodes"
                    type="checkbox"
                    checked={showNodes}
                    onChange={(e) => setShowNodes(e.target.checked)}
                  />
                  <span className="slider"></span>
                </span>
              </label>

              <label className="control-toggle" htmlFor="toggle-gatekeepers">
                <span className="toggle-label">
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--neon-rose)', borderRadius: '50%' }}></span>
                  Highlight Critical Gatekeepers
                </span>
                <span className="toggle-switch">
                  <input
                    id="toggle-gatekeepers"
                    type="checkbox"
                    checked={highlightGatekeepers}
                    onChange={(e) => setHighlightGatekeepers(e.target.checked)}
                  />
                  <span className="slider"></span>
                </span>
              </label>
            </div>

            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
                BASEMAP SELECTION
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {['dark', 'satellite', 'streets'].map(style => (
                  <button
                    key={style}
                    id={`btn-basemap-${style}`}
                    className={`action-btn ${basemapStyle === style ? 'primary' : 'secondary'}`}
                    style={{ padding: '6px 8px', fontSize: '11px', textTransform: 'capitalize' }}
                    onClick={() => setBasemapStyle(style)}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* SECTION: SPATIAL & CRS METADATA */}
          <div className="panel-card" id="crs-metadata-panel">
            <div className="section-label">
              <span>Geospatial Transformation</span>
            </div>
            <table className="kv-table">
              <tbody>
                <tr>
                  <td className="kv-key">Source Projection</td>
                  <td className="kv-value"><span className="kv-badge">EPSG:32643 (UTM 43N)</span></td>
                </tr>
                <tr>
                  <td className="kv-key">Target Display CRS</td>
                  <td className="kv-value"><span className="kv-badge">EPSG:4326 (WGS84)</span></td>
                </tr>
                <tr>
                  <td className="kv-key">Resolution (GSD)</td>
                  <td className="kv-value">0.3077 m/px</td>
                </tr>
                <tr>
                  <td className="kv-key">Target Region</td>
                  <td className="kv-value">SpaceNet 5 (Mumbai AOI 8)</td>
                </tr>
                <tr>
                  <td className="kv-key">Array Grid Shape</td>
                  <td className="kv-value">1300 &times; 1300 px</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* SECTION: SELECTED ENTITY INSPECTOR */}
          {inspectedEntity && (
            <div className="panel-card" id="inspected-entity-panel" style={{ borderColor: 'rgba(0, 229, 255, 0.4)' }}>
              <div className="section-label" style={{ color: 'var(--neon-cyan)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Inspected {inspectedEntity.type === 'node' ? `Node #${inspectedEntity.id}` : `Edge #${inspectedEntity.id}`}</span>
                <span
                  style={{ cursor: 'pointer', opacity: 0.7 }}
                  onClick={() => setInspectedEntity(null)}
                  title="Close inspector"
                >
                  ✕
                </span>
              </div>

              {inspectedEntity.type === 'node' ? (
                <table className="kv-table">
                  <tbody>
                    <tr>
                      <td className="kv-key">Latitude / Longitude</td>
                      <td className="kv-value">{inspectedEntity.lat.toFixed(5)}, {inspectedEntity.lon.toFixed(5)}</td>
                    </tr>
                    <tr>
                      <td className="kv-key">Pixel (Y, X)</td>
                      <td className="kv-value">[{inspectedEntity.pixel[0]}, {inspectedEntity.pixel[1]}]</td>
                    </tr>
                    <tr>
                      <td className="kv-key">UTM Metric Easting</td>
                      <td className="kv-value">{inspectedEntity.utm[0].toFixed(1)} m</td>
                    </tr>
                    <tr>
                      <td className="kv-key">UTM Metric Northing</td>
                      <td className="kv-value">{inspectedEntity.utm[1].toFixed(1)} m</td>
                    </tr>
                    <tr>
                      <td className="kv-key">Degree</td>
                      <td className="kv-value">{inspectedEntity.degree}</td>
                    </tr>
                    <tr>
                      <td className="kv-key">Betweenness Centrality</td>
                      <td className="kv-value">{inspectedEntity.centrality.toFixed(5)}</td>
                    </tr>
                    <tr>
                      <td className="kv-key">Gatekeeper Chokepoint</td>
                      <td className="kv-value">
                        {inspectedEntity.is_gatekeeper ? (
                          <span style={{ color: 'var(--neon-rose)', fontWeight: 'bold' }}>YES (Critical)</span>
                        ) : (
                          'No'
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <table className="kv-table">
                  <tbody>
                    <tr>
                      <td className="kv-key">Source &rarr; Target</td>
                      <td className="kv-value">Node #{inspectedEntity.source} &rarr; #{inspectedEntity.target}</td>
                    </tr>
                    <tr>
                      <td className="kv-key">Physical Length</td>
                      <td className="kv-value">{inspectedEntity.weight_meters.toFixed(1)} meters</td>
                    </tr>
                    <tr>
                      <td className="kv-key">Routing Cost (Friction)</td>
                      <td className="kv-value">{inspectedEntity.routing_weight.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="kv-key">Intermediate Points</td>
                      <td className="kv-value">{inspectedEntity.coordinates.length} pts</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* REFRESH BUTTON */}
          <button
            id="btn-refresh-graph"
            className="action-btn primary"
            onClick={() => { fetchGraph(); fetchStats(); }}
            disabled={loading}
          >
            {loading ? 'Fetching Graph...' : '↻ Refresh Network Data'}
          </button>
        </div>
      </aside>

      {/* ----------------------------------------------------------------- */}
      {/* MAIN MAP VIEWPORT */}
      {/* ----------------------------------------------------------------- */}
      <main className="map-viewport" id="map-viewport">
        {/* Top floating pill */}
        <div className="floating-topbar">
          <div className="floating-pill" id="floating-info-pill">
            <span style={{ color: 'var(--neon-cyan)', fontWeight: 600 }}>SpaceNet 5 Mumbai Road Network</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {graphData?.nodes?.length || 0} Nodes &bull; {graphData?.edges?.length || 0} Edges
            </span>
            {ablatedNodes.length > 0 && (
              <>
                <span style={{ color: 'var(--border-color)' }}>|</span>
                <span style={{ color: 'var(--neon-rose)', fontWeight: 600 }}>
                  Ablated: {ablatedNodes.join(', ')}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Floating Legend */}
        <div className="map-legend" id="map-legend">
          <div style={{ fontWeight: 700, color: '#fff', fontSize: '11px', textTransform: 'uppercase', marginBottom: 2 }}>
            Map Legend
          </div>
          <div className="legend-item">
            <span className="legend-color edge-normal"></span>
            <span>Road Centerline (Metric Re-projected)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color node-normal"></span>
            <span>Road Intersection / Junction</span>
          </div>
          <div className="legend-item">
            <span className="legend-color node-gatekeeper"></span>
            <span>Gatekeeper Node (High Centrality)</span>
          </div>
          {ablatedNodes.length > 0 && (
            <div className="legend-item">
              <span className="legend-color node-ablated"></span>
              <span>Ablated / Destroyed Node</span>
            </div>
          )}
        </div>

        {/* Loading Overlay */}
        {loading && (
          <div className="loading-overlay" id="loading-overlay">
            <div className="spinner"></div>
            <div className="loading-text">
              Fetching NetworkX graph from FastAPI backend (http://localhost:8000)...
            </div>
          </div>
        )}

        {/* Error Notification */}
        {error && !loading && (
          <div className="loading-overlay" id="error-overlay" style={{ background: 'rgba(15, 23, 42, 0.95)' }}>
            <div style={{ maxWidth: 440, textAlign: 'center', padding: 24, background: '#1e293b', borderRadius: 16, border: '1px solid var(--border-danger)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
              <h2 style={{ fontSize: 18, color: '#fff', marginBottom: 8 }}>Unable to Connect to Backend</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                {error}
              </p>
              <button
                id="btn-retry-connect"
                className="action-btn primary"
                onClick={fetchGraph}
              >
                Retry Connection
              </button>
            </div>
          </div>
        )}

        {/* REACT LEAFLET MAP */}
        <MapContainer
          center={mapCenter}
          zoom={16}
          scrollWheelZoom={true}
          style={{ height: '100vh', width: '100%' }}
        >
          {/* Fix Leaflet tile loading and container resize */}
          <FixMapResize />

          {/* Fit map bounds dynamically to graph data */}
          <MapBoundsFitter bounds={mapBounds} />

          {/* Basemap Tiles */}
          <TileLayer
            attribution={tileLayers[basemapStyle].attribution}
            url={tileLayers[basemapStyle].url}
            maxZoom={20}
          />

          {/* ROAD EDGES OVERLAY */}
          {showEdges && graphData?.edges?.map((edge) => {
            // Leaflet expects [latitude, longitude] tuples
            // GeoJSON coordinates are in [longitude, latitude]
            const positions = edge.coordinates.map(pt => [pt[1], pt[0]]);
            const isConnectedToAblated = ablatedNodes.includes(edge.source) || ablatedNodes.includes(edge.target);

            return (
              <Polyline
                key={`edge-${edge.id}`}
                positions={positions}
                pathOptions={{
                  color: isConnectedToAblated ? '#475569' : '#00e5ff',
                  weight: isConnectedToAblated ? 1.5 : 3,
                  opacity: isConnectedToAblated ? 0.35 : 0.85,
                  dashArray: isConnectedToAblated ? '4, 4' : null,
                  lineCap: 'round',
                  lineJoin: 'round'
                }}
                eventHandlers={{
                  click: () => {
                    setInspectedEntity({ type: 'edge', ...edge });
                  }
                }}
              >
                <Tooltip sticky>
                  <div>
                    <strong>Edge #{edge.id}</strong> ({edge.source} &rarr; {edge.target})<br />
                    Length: {edge.weight_meters.toFixed(1)}m<br />
                    Routing Cost: {edge.routing_weight.toFixed(2)}
                  </div>
                </Tooltip>
              </Polyline>
            );
          })}

          {/* ROAD NODES OVERLAY */}
          {showNodes && graphData?.nodes?.map((node) => {
            const isAblated = ablatedNodes.includes(node.id);
            const isGatekeeper = highlightGatekeepers && node.is_gatekeeper;

            // Radius scales with centrality
            const radius = isAblated ? 8 : (isGatekeeper ? 9 : 5);
            const fillColor = isAblated
              ? '#fbbf24'
              : (isGatekeeper ? '#f43f5e' : '#00e5ff');

            return (
              <CircleMarker
                key={`node-${node.id}`}
                center={[node.lat, node.lon]}
                radius={radius}
                pathOptions={{
                  fillColor: fillColor,
                  fillOpacity: isAblated ? 0.9 : (isGatekeeper ? 0.95 : 0.75),
                  color: '#ffffff',
                  weight: isGatekeeper ? 2 : 1,
                  opacity: 1
                }}
                eventHandlers={{
                  click: () => {
                    setInspectedEntity({ type: 'node', ...node });
                    setSelectedNodeId(String(node.id));
                  }
                }}
              >
                <Popup>
                  <div className="custom-popup">
                    <div className="custom-popup-title">
                      <span>Node #{node.id}</span>
                      {isGatekeeper && (
                        <span style={{ fontSize: 10, background: 'rgba(244, 63, 94, 0.2)', color: '#f43f5e', padding: '2px 6px', borderRadius: 4 }}>
                          GATEKEEPER
                        </span>
                      )}
                    </div>
                    <div className="custom-popup-row">
                      <span>Coordinates:</span>
                      <span>{node.lat.toFixed(5)}, {node.lon.toFixed(5)}</span>
                    </div>
                    <div className="custom-popup-row">
                      <span>Pixel:</span>
                      <span>[{node.pixel[0]}, {node.pixel[1]}]</span>
                    </div>
                    <div className="custom-popup-row">
                      <span>Degree:</span>
                      <span>{node.degree}</span>
                    </div>
                    <div className="custom-popup-row">
                      <span>Centrality:</span>
                      <span>{node.centrality.toFixed(4)}</span>
                    </div>
                  </div>
                </Popup>

                <Tooltip direction="top" offset={[0, -5]}>
                  <span>
                    Node #{node.id} {isGatekeeper ? '★' : ''} (Deg: {node.degree})
                  </span>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </main>
    </div>
  );
}
