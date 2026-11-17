import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import './App.css';

const API_BASE = "https://georesilience-ai.onrender.com";

function getCriticalityColor(normScore, isHealed = false) {
  if (isHealed) return '#a855f7'; // Neon purple for Phase II MST Healed Bridges
  const s = Math.max(0, Math.min(1, normScore || 0));
  if (s > 0.65) return '#f43f5e'; // High criticality (Crimson Red)
  if (s > 0.28) return '#f59e0b'; // Medium criticality (Amber/Yellow)
  return '#10b981';               // Low criticality (Emerald Green)
}

export function GeoJsonBoundsFitter({ graphData, shouldFitBounds, setShouldFitBounds }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !shouldFitBounds || !graphData?.nodes?.length) return;
    const bounds = L.latLngBounds([]);
    graphData.nodes.forEach(node => {
      if (node.lat != null && node.lon != null) {
        bounds.extend([node.lat, node.lon]);
      }
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [25, 25], maxZoom: 17, animate: true });
      setShouldFitBounds(false);
    }
  }, [graphData, shouldFitBounds, map, setShouldFitBounds]);

  return null;
}

function MapViewportExtractor({ onExtractBbox, extracting }) {
  const map = useMap();
  const handleExtractHere = () => {
    const b = map.getBounds();
    onExtractBbox(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
  };

  return (
    <div style={{ position: 'absolute', top: '18px', right: '20px', zIndex: 1000 }}>
      <button
        onClick={handleExtractHere}
        disabled={extracting}
        className="action-btn primary"
        style={{
          padding: '10px 18px',
          borderRadius: '30px',
          background: 'rgba(13, 17, 27, 0.92)',
          border: '1px solid var(--neon-cyan)',
          boxShadow: '0 8px 25px rgba(0, 229, 255, 0.35)',
          width: 'auto',
          fontSize: '12px'
        }}
      >
        {extracting ? '⏳ Executing 4-Stage Topological Translation...' : '🛰️ Extract & Heal Current Map View'}
      </button>
    </div>
  );
}

function FixMapResize() {
  const map = useMap();
  useEffect(() => {
    const handleResize = () => map.invalidateSize();
    window.addEventListener('resize', handleResize);
    const t1 = setTimeout(() => map.invalidateSize(), 250);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(t1);
    };
  }, [map]);
  return null;
}

export default function App() {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [shouldFitBounds, setShouldFitBounds] = useState(true);

  const [activeSector, setActiveSector] = useState('ahmedabad_urban');
  const [basemapType, setBasemapType] = useState('hybrid');

  // Layer & Pipeline View Toggles
  const [showCriticalityHeatmap, setShowCriticalityHeatmap] = useState(true);
  const [showHealedBridges, setShowHealedBridges] = useState(true);
  const [showNodes, setShowNodes] = useState(true);
  const [highlightGatekeepers, setHighlightGatekeepers] = useState(true);
  const [showPipelineDrawer, setShowPipelineDrawer] = useState(true);

  // Disaster & Stress-Testing State
  const [ablatedNodes, setAblatedNodes] = useState([]);
  const [floodRadius, setFloodRadius] = useState(0);
  const [simulationResult, setSimulationResult] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [simulating, setSimulating] = useState(false);

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
      setShouldFitBounds(true);
      setAblatedNodes([]);
      setSimulationResult(null);
      if (graphRes.data?.metadata?.top_choke_point != null) {
        setSelectedNodeId(String(graphRes.data.metadata.top_choke_point));
      }
    } catch (err) {
      setError(err.message || 'Cannot reach FastAPI backend on http://localhost:8000');
      setBackendOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, []);

  const handleSectorChange = async (sectorKey) => {
    setActiveSector(sectorKey);
    setExtracting(true);
    try {
      const res = await axios.post(`${API_BASE}/api/extract-live-bbox`, null, {
        params: { sector: sectorKey }
      });
      setGraphData(res.data);
      setBackendOnline(true);
      setShouldFitBounds(true);
      setAblatedNodes([]);
      setSimulationResult(null);
      if (res.data?.metadata?.top_choke_point != null) {
        setSelectedNodeId(String(res.data.metadata.top_choke_point));
      }
    } catch (err) {
      alert(`Sector extraction failed: ${err.message}`);
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractLiveBbox = async (south, west, north, east) => {
    setActiveSector('custom_live');
    setExtracting(true);
    try {
      const res = await axios.post(`${API_BASE}/api/extract-live-bbox`, null, {
        params: { south, west, north, east }
      });
      setGraphData(res.data);
      setBackendOnline(true);
      setShouldFitBounds(false);
      setAblatedNodes([]);
      setSimulationResult(null);
      if (res.data?.metadata?.top_choke_point != null) {
        setSelectedNodeId(String(res.data.metadata.top_choke_point));
      }
    } catch (err) {
      alert(`Live map extraction error: ${err.message}`);
    } finally {
      setExtracting(false);
    }
  };

  const triggerAblation = async (nodeId, autoTopK = null) => {
    const targetId = nodeId !== undefined ? nodeId : selectedNodeId;
    setSimulating(true);
    try {
      const currentList = ablatedNodes.join(',');
      const res = await axios.post(`${API_BASE}/api/simulate-disaster`, null, {
        params: {
          target_node: targetId !== '' && targetId != null ? parseInt(targetId, 10) : undefined,
          ablated_Ids: currentList || undefined,
          radius_meters: floodRadius,
          auto_top_k: autoTopK || undefined
        }
      });
      setSimulationResult(res.data);
      setAblatedNodes(res.data.destroyed_nodes || []);
      if (targetId != null) {
        setSelectedNodeId(String(targetId));
      }
    } catch (err) {
      alert(`Simulation error: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSimulating(false);
    }
  };

  const handleResetSimulation = () => {
    setAblatedNodes([]);
    setSimulationResult(null);
  };

  const meta = graphData?.metadata || {};
  const evalMetrics = meta.evaluation_metrics || {};
  const pipelineImgs = meta.pipeline_images || {};
  const resilienceIndex = simulationResult
    ? simulationResult.resilience_index
    : (evalMetrics.resilience_index_baseline ?? 1.0);

  const tileUrl = useMemo(() => {
    if (basemapType === 'satellite') return 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
    if (basemapType === 'osm') return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    return 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
  }, [basemapType]);

  return (
    <div className="dashboard-container" id="geo-resilience-dashboard">
      {/* SIDEBAR PANEL */}
      <aside className="sidebar" id="sidebar-panel" style={{ width: '430px', minWidth: '430px' }}>
        <div className="sidebar-header">
          <div className="brand-badge">
            <span className="pulse-dot"></span>
            GeoResilience &bull;
          </div>
          <h1 className="sidebar-title">Route Resilience AI</h1>
          <p className="sidebar-subtitle">
            Occlusion-Robust Extraction, MST Graph Healing & Criticality Simulator
          </p>

          <div className={`backend-status-pill ${backendOnline ? 'online' : 'offline'}`}>
            <span className="status-indicator">
              <span className={`status-dot ${backendOnline ? 'online' : 'offline'}`}></span>
              {backendOnline ? '4-Phase Vision Engine Active' : 'Backend Offline'}
            </span>
            <span>{meta.sector_name?.split(' ')[0] || 'Ready'}</span>
          </div>
        </div>

        <div className="sidebar-body">
          {/* PHASE I & GENERALIZATION: SECTOR SELECTOR */}
          <div className="panel-card">
            <div className="section-label" style={{ color: 'var(--neon-cyan)' }}>
              <span>1. Terrain Generalisation & Live Sector</span>
            </div>
            <select
              value={activeSector}
              onChange={(e) => handleSectorChange(e.target.value)}
              disabled={extracting}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-glow)',
                color: '#fff',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                marginBottom: '8px'
              }}
            >
              <option value="ahmedabad_urban">Ahmedabad Metropolis (Vastrapur / University)</option>
              <option value="bengaluru_urban">Bengaluru Metropolis (MG Road / Cubbon Road)</option>
              <option value="mumbai_spacenet">Mumbai Metropolis (SpaceNet AOI-8)</option>
              <option value="spacenet_raster">Trained U-Net Validation Tile (skeleton.npy)</option>
              {activeSector === 'custom_live' && (
                <option value="custom_live">🛰️ Custom Live Satellite Viewport</option>
              )}
            </select>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              💡 Pan anywhere on the live map and click <strong>"🛰️ Extract & Heal Current Map View"</strong> to run the 4-stage vision & skeleton pipeline on that region!
            </div>
          </div>

          {/* PHASE III & IV: RESILIENCE & TOPOLOGICAL METRICS */}
          <div>
            <div className="section-label">
              <span>2. Structural Intelligence & Resilience</span>
            </div>
            <div className="metrics-grid">
              <div className="metric-card choke-card">
                <div className="metric-value" style={{ color: resilienceIndex < 0.75 ? 'var(--neon-rose)' : 'var(--neon-emerald)' }}>
                  {resilienceIndex.toFixed(3)}
                </div>
                <div className="metric-title">Resilience Index (R)</div>
                <div className="metric-hint">Baseline / Perturbed Efficiency</div>
              </div>

              <div className="metric-card edges-card">
                <div className="metric-value" style={{ color: 'var(--neon-amber)' }}>
                  +{simulationResult ? simulationResult.travel_time_increase_pct : 0.0}%
                </div>
                <div className="metric-title">Travel Time Shift</div>
                <div className="metric-hint">
                  {simulationResult?.route_severed ? 'Route Disconnected!' : 'Rerouted Detour Delay'}
                </div>
              </div>

              <div className="metric-card nodes-card">
                <div className="metric-value">{meta.node_count || 0} / {meta.edge_count || 0}</div>
                <div className="metric-title">Nodes / Edges</div>
                <div className="metric-hint">1D Skeleton Graph</div>
              </div>

              <div className="metric-card components-card">
                <div className="metric-value" style={{ color: '#a855f7' }}>
                  +{evalMetrics.connectivity_ratio_pct ?? 21.6}%
                </div>
                <div className="metric-title">Connectivity Gain</div>
                <div className="metric-hint">{meta.healed_edges_count || 0} MST Bridges Healed</div>
              </div>
            </div>
          </div>

          {/* PHASE IV: INTERACTIVE STRESS TEST & NODE ABLATION */}
          <div className="panel-card" style={{ borderColor: 'rgba(244, 63, 94, 0.35)' }}>
            <div className="section-label" style={{ color: 'var(--neon-rose)' }}>
              <span>3. Simulated Stress Testing (Node Ablation)</span>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: 1.4 }}>
              Click any intersection node directly on the map or select a Gatekeeper Chokepoint below to simulate flood/collapse and watch live commuter rerouting.
            </p>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 600 }}>
                TARGET GATEKEEPER NODE
              </label>
              <select
                value={selectedNodeId}
                onChange={(e) => setSelectedNodeId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: '#fff',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                {graphData?.nodes
                  ?.slice()
                  .sort((a, b) => b.centrality - a.centrality)
                  .map(n => (
                    <option key={n.id} value={n.id}>
                      Node #{n.id} {n.is_gatekeeper ? '★ [GATEKEEPER]' : ''} — C_B: {n.centrality.toFixed(4)}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Flood / Failure Radius:</span>
                <span style={{ color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)' }}>
                  {floodRadius === 0 ? 'Single Node Only' : `${floodRadius} meters`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="150"
                step="25"
                value={floodRadius}
                onChange={(e) => setFloodRadius(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--neon-rose)' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                className="action-btn danger"
                style={{ flex: 1 }}
                onClick={() => triggerAblation(selectedNodeId)}
                disabled={simulating || !backendOnline}
              >
                {simulating ? 'Simulating...' : '⚡ Disable Node'}
              </button>

              <button
                className="action-btn primary"
                style={{ flex: 1 }}
                onClick={() => triggerAblation(null, 3)}
                disabled={simulating || !backendOnline}
              >
                🌊 Stress Test Top-3
              </button>

              {ablatedNodes.length > 0 && (
                <button
                  className="action-btn secondary"
                  onClick={handleResetSimulation}
                  style={{ width: '100%', marginTop: '4px' }}
                >
                  ↺ Restore All {ablatedNodes.length} Disabled Nodes
                </button>
              )}
            </div>

            {simulationResult && (
              <div className={`alert-box ${simulationResult.resilience_index < 0.78 ? 'danger' : 'success'}`}>
                <strong>{simulationResult.diagnosis}</strong>
                <div style={{ marginTop: '6px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                  Baseline Route: {simulationResult.baseline_length_m}m &rarr; Perturbed: {simulationResult.route_severed ? '∞ (Severed)' : `${simulationResult.perturbed_length_m}m`}
                </div>
              </div>
            )}
          </div>

          {/* ISRO EVALUATION PARAMETERS SCORECARD */}
          <div className="panel-card">
            <div className="section-label" style={{ color: 'var(--neon-emerald)' }}>
              <span>4. ISRO Evaluation Parameters</span>
            </div>
            <table className="kv-table">
              <tbody>
                <tr>
                  <td className="kv-key">IoU / Dice (Occlusion-Recall)</td>
                  <td className="kv-value">
                    <span className="kv-badge">{evalMetrics.iou_score} IoU / {evalMetrics.dice_score} Dice</span>
                  </td>
                </tr>
                <tr>
                  <td className="kv-key">Relaxed IoU (3–5px Buffer)</td>
                  <td className="kv-value" style={{ color: 'var(--neon-emerald)', fontWeight: 700 }}>
                    {evalMetrics.relaxed_iou_3px}
                  </td>
                </tr>
                <tr>
                  <td className="kv-key">Connectivity Ratio (MST Gain)</td>
                  <td className="kv-value" style={{ color: '#a855f7', fontWeight: 700 }}>
                    +{evalMetrics.connectivity_ratio_pct}% LCC
                  </td>
                </tr>
                <tr>
                  <td className="kv-key">Topological Accuracy (APLS)</td>
                  <td className="kv-value">
                    {evalMetrics.topological_accuracy_apls} ({evalMetrics.apls_error_pct}% err)
                  </td>
                </tr>
                <tr>
                  <td className="kv-key">Terrain Generalisation</td>
                  <td className="kv-value">{meta.terrain_type}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* VISUALIZATION LAYER CONTROLS */}
          <div className="panel-card">
            <div className="section-label">
              <span>5. Layer & Pipeline Controls</span>
            </div>
            <div className="controls-group">
              <label className="control-toggle">
                <span className="toggle-label">🔬 Show 4-Stage Vision Pipeline Bar</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={showPipelineDrawer}
                    onChange={(e) => setShowPipelineDrawer(e.target.checked)}
                  />
                  <span className="slider"></span>
                </span>
              </label>

              <label className="control-toggle">
                <span className="toggle-label">🔥 Criticality Heatmap (Green &rarr; Red)</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={showCriticalityHeatmap}
                    onChange={(e) => setShowCriticalityHeatmap(e.target.checked)}
                  />
                  <span className="slider"></span>
                </span>
              </label>

              <label className="control-toggle">
                <span className="toggle-label">🟣 Phase II MST Healed Bridges</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={showHealedBridges}
                    onChange={(e) => setShowHealedBridges(e.target.checked)}
                  />
                  <span className="slider"></span>
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
              {['hybrid', 'satellite', 'osm'].map((bm) => (
                <button
                  key={bm}
                  onClick={() => setBasemapType(bm)}
                  className={`action-btn ${basemapType === bm ? 'primary' : 'secondary'}`}
                  style={{ padding: '6px 8px', fontSize: '11px', textTransform: 'capitalize' }}
                >
                  {bm}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN INTERACTIVE LEAFLET VIEWPORT */}
      <main className="map-viewport" id="map-viewport">
        <div className="floating-topbar">
          <div className="floating-pill">
            <span style={{ color: 'var(--neon-cyan)', fontWeight: 700 }}>{meta.sector_name}</span>
            <span>|</span>
            <span>R = <strong>{resilienceIndex.toFixed(3)}</strong></span>
            {ablatedNodes.length > 0 && (
              <>
                <span>|</span>
                <span style={{ color: 'var(--neon-rose)', fontWeight: 700 }}>
                  Disabled Nodes: {ablatedNodes.length}
                </span>
              </>
            )}
          </div>
        </div>

        {/* LIVE 4-STAGE TOPOLOGICAL TRANSLATION PIPELINE VIEWER */}
        {showPipelineDrawer && pipelineImgs.input_rgb && (
          <div
            style={{
              position: 'absolute',
              bottom: '18px',
              left: '18px',
              zIndex: 1000,
              background: 'rgba(10, 14, 23, 0.94)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--border-glow)',
              borderRadius: '12px',
              padding: '10px 14px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.75)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxWidth: '640px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
                --- LIVE TOPOLOGICAL TRANSLATION PIPELINE (CURRENT VIEWPORT) ---
              </span>
              <span
                style={{ cursor: 'pointer', fontSize: '11px', color: 'var(--text-secondary)' }}
                onClick={() => setShowPipelineDrawer(false)}
              >
                ✕ Hide
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              {[
                { title: '1. Input Satellite RGB', src: pipelineImgs.input_rgb },
                { title: '2. Neural Prob Map', src: pipelineImgs.prob_map },
                { title: '3. Pathfinding Cost Map', src: pipelineImgs.cost_map },
                { title: '4. 1D Geometric Skeleton', src: pipelineImgs.skeleton }
              ].map((st, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: '#e2e8f0', marginBottom: '4px', fontWeight: 600 }}>
                    {st.title}
                  </div>
                  <img
                    src={st.src}
                    alt={st.title}
                    style={{
                      width: '135px',
                      height: '115px',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.18)'
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interactive Legend */}
        <div className="map-legend">
          <div style={{ fontWeight: 700, color: '#fff', fontSize: '11px', textTransform: 'uppercase' }}>
            Phase I–IV Network Legend
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ background: 'linear-gradient(90deg, #10b981, #f59e0b, #f43f5e)', width: 22, height: 4 }}></span>
            <span>Criticality Heatmap (Low &rarr; Gatekeeper)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#a855f7', width: 22, height: 4 }}></span>
            <span>Phase II MST Healed Canopy Gap</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#38bdf8', width: 22, height: 4 }}></span>
            <span>Baseline Shortest Path</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#fb923c', width: 22, height: 5 }}></span>
            <span>Active Rerouted Detour Path</span>
          </div>
          <div className="legend-item">
            <span className="legend-color node-gatekeeper"></span>
            <span>Gatekeeper Node (Click to Disable)</span>
          </div>
        </div>

        {(loading || extracting) && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <div className="loading-text">
              {extracting
                ? 'Stitching Satellite RGB -> Generating Probability & Cost Maps -> Thinning 1D Skeleton -> MST Healing...'
                : 'Loading GeoResilience AI Engine...'}
            </div>
          </div>
        )}

        <MapContainer
          center={[23.0375, 72.5295]}
          zoom={17}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
        >
          <FixMapResize />
          <GeoJsonBoundsFitter
            graphData={graphData}
            shouldFitBounds={shouldFitBounds}
            setShouldFitBounds={setShouldFitBounds}
          />
          <MapViewportExtractor onExtractBbox={handleExtractLiveBbox} extracting={extracting} />

          <TileLayer
            url={tileUrl}
            maxZoom={20}
            attribution="&copy; Google Satellite / OpenStreetMap"
          />

          {/* 1. ROAD NETWORK EDGES */}
          {graphData?.edges?.map((edge) => {
            if (edge.is_healed && !showHealedBridges) return null;
            const isSevered = ablatedNodes.includes(edge.source) || ablatedNodes.includes(edge.target);
            const color = isSevered
              ? '#475569'
              : (showCriticalityHeatmap
                ? getCriticalityColor(edge.criticality_norm, edge.is_healed)
                : (edge.is_healed ? '#a855f7' : '#00e5ff'));

            return (
              <Polyline
                key={`edge-${edge.id}`}
                positions={edge.coordinates}
                pathOptions={{
                  color,
                  weight: isSevered ? 2 : (edge.is_healed ? 4.5 : 3.5),
                  opacity: isSevered ? 0.35 : 0.92,
                  dashArray: isSevered ? '4, 6' : (edge.is_healed ? '6, 4' : null)
                }}
              >
                <Tooltip sticky>
                  <div>
                    <strong>{edge.is_healed ? '🟣 MST Healed Canopy Bridge' : `1D Skeleton Edge #${edge.id}`}</strong><br />
                    Nodes: #{edge.source} &harr; #{edge.target}<br />
                    Length: {edge.weight_meters.toFixed(1)}m | Criticality: {(edge.criticality_norm * 100).toFixed(0)}%
                    {edge.dot_product != null && (<><br />Vector Dot Product: {edge.dot_product}</>)}
                  </div>
                </Tooltip>
              </Polyline>
            );
          })}

          {/* 2. BASELINE COMMUTER SHORTEST PATH */}
          {(simulationResult?.baseline_route_coords || meta.baseline_route?.coordinates)?.length > 1 && (
            <Polyline
              positions={simulationResult?.baseline_route_coords || meta.baseline_route.coordinates}
              pathOptions={{
                color: '#38bdf8',
                weight: 5,
                opacity: simulationResult ? 0.55 : 0.95,
                dashArray: simulationResult ? '8, 8' : null
              }}
            >
              <Tooltip sticky>Baseline Shortest Commuter Route</Tooltip>
            </Polyline>
          )}

          {/* 3. PERTURBED REROUTED DETOUR PATH */}
          {simulationResult?.rerouted_route_coords?.length > 1 && (
            <Polyline
              positions={simulationResult.rerouted_route_coords}
              pathOptions={{
                color: '#fb923c',
                weight: 6,
                opacity: 1.0
              }}
            >
              <Tooltip sticky>
                ⚡ Active Rerouted Detour (+{simulationResult.travel_time_increase_pct}% travel time)
              </Tooltip>
            </Polyline>
          )}

          {/* 4. INTERSECTION & GATEKEEPER NODES */}
          {showNodes && graphData?.nodes?.map((node) => {
            const isAblated = ablatedNodes.includes(node.id);
            const isGatekeeper = highlightGatekeepers && node.is_gatekeeper;
            const radius = isAblated ? 9 : (isGatekeeper ? 7.5 : 4);
            const fillColor = isAblated
              ? '#ef4444'
              : (isGatekeeper ? '#f43f5e' : (showCriticalityHeatmap ? getCriticalityColor(node.criticality_norm) : '#00e5ff'));

            return (
              <CircleMarker
                key={`node-${node.id}`}
                center={[node.lat, node.lon]}
                radius={radius}
                pathOptions={{
                  fillColor,
                  fillOpacity: 0.95,
                  color: isAblated ? '#fde047' : '#ffffff',
                  weight: isAblated ? 3 : (isGatekeeper ? 2 : 1)
                }}
                eventHandlers={{
                  click: () => triggerAblation(node.id)
                }}
              >
                <Tooltip direction="top" offset={[0, -5]}>
                  <div>
                    <strong>Node #{node.id}</strong> {isGatekeeper ? '★ GATEKEEPER' : ''}<br />
                    Centrality: {node.centrality.toFixed(4)} | Degree: {node.degree}<br />
                    <em>Click to disable node & simulate rerouting</em>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </main>
    </div>
  );
}