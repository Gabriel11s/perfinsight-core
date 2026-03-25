import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import { GeoPoint } from '@/hooks/use-geo-sessions';
import { Clock, Globe, MapPin, RotateCcw, Users, Wifi, ZoomIn, ZoomOut } from 'lucide-react';

interface InteractiveWorldMapProps {
  points: GeoPoint[];
  onlinePoints?: GeoPoint[];
  mode: 'activity' | 'online';
  onModeChange?: (mode: 'activity' | 'online') => void;
  height?: number;
  showToggle?: boolean;
  className?: string;
}

const MAP_WIDTH = 960;
const MAP_HEIGHT = 480;

// Cache the loaded features globally so we only fetch once
let cachedFeatures: any[] | null = null;
let fetchPromise: Promise<any[]> | null = null;

function loadWorldData(): Promise<any[]> {
  if (cachedFeatures) return Promise.resolve(cachedFeatures);
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch('/countries-110m.json')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(topo => {
      const geo = feature(topo, topo.objects.countries);
      cachedFeatures = (geo as any).features;
      console.log(`[WorldMap] Loaded ${cachedFeatures!.length} countries`);
      return cachedFeatures!;
    })
    .catch(err => {
      console.error('[WorldMap] Failed to load world data:', err);
      fetchPromise = null;
      return [];
    });

  return fetchPromise;
}

export function InteractiveWorldMap({
  points,
  onlinePoints,
  mode,
  onModeChange,
  height = 400,
  showToggle = true,
  className = '',
}: InteractiveWorldMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [geoFeatures, setGeoFeatures] = useState<any[]>(cachedFeatures || []);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<[number, number]>([0, 0]);
  const [tooltip, setTooltip] = useState<{ point: GeoPoint; x: number; y: number } | null>(null);

  // Load world data on mount
  useEffect(() => {
    loadWorldData().then(feats => {
      if (feats.length > 0) setGeoFeatures(feats);
    });
  }, []);

  const activePoints = mode === 'online' && onlinePoints ? onlinePoints : points;

  // Projection
  const projection = useMemo(() => {
    return geoNaturalEarth1()
      .scale(160 * zoom)
      .translate([MAP_WIDTH / 2 + pan[0], MAP_HEIGHT / 2 + pan[1]]);
  }, [zoom, pan]);

  const pathGenerator = useMemo(() => geoPath().projection(projection), [projection]);

  // Country paths
  const countryPaths = useMemo(() => {
    return geoFeatures.map((feat: any, i: number) => ({
      d: pathGenerator(feat) || '',
      key: feat.id || String(i),
    }));
  }, [geoFeatures, pathGenerator]);

  // Graticule
  const graticule = useMemo(() => geoGraticule10(), []);
  const graticulePath = useMemo(() => pathGenerator(graticule) || '', [pathGenerator, graticule]);

  // Marker scaling
  const { minVal, maxVal } = useMemo(() => {
    if (activePoints.length === 0) return { minVal: 0, maxVal: 1 };
    const vals = activePoints.map(p => p.total_minutes);
    return { minVal: Math.min(...vals), maxVal: Math.max(...vals) || 1 };
  }, [activePoints]);

  const getMarkerSize = useCallback((minutes: number) => {
    if (maxVal === minVal) return 5;
    const normalized = (minutes - minVal) / (maxVal - minVal);
    return 4 + normalized * 12;
  }, [minVal, maxVal]);

  // Project geo points to SVG coordinates
  const projectedMarkers = useMemo(() => {
    return activePoints.map((point) => {
      const coords = projection([point.geo_lon, point.geo_lat]);
      return { point, x: coords?.[0] ?? 0, y: coords?.[1] ?? 0 };
    }).filter(m => m.x > 0 && m.x < MAP_WIDTH && m.y > 0 && m.y < MAP_HEIGHT);
  }, [activePoints, projection]);

  // Zoom
  const handleZoomIn = () => setZoom(z => Math.min(z * 1.5, 8));
  const handleZoomOut = () => setZoom(z => Math.max(z / 1.5, 1));
  const handleReset = () => { setZoom(1); setPan([0, 0]); setTooltip(null); };

  // Mouse wheel zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => Math.max(1, Math.min(8, e.deltaY < 0 ? z * 1.15 : z / 1.15)));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Drag to pan
  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    setDragStart([e.clientX - pan[0], e.clientY - pan[1]]);
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan([e.clientX - dragStart[0], e.clientY - dragStart[1]]);
  };
  const handleMouseUp = () => setDragging(false);

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ height, background: '#0c111b' }}>
      {/* Controls */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        <button onClick={handleReset} className="flex items-center gap-1.5 rounded-lg bg-card/80 backdrop-blur-sm border border-border/50 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
        <div className="flex rounded-lg bg-card/80 backdrop-blur-sm border border-border/50 overflow-hidden">
          <button onClick={handleZoomIn} className="px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors border-r border-border/50">
            <ZoomIn className="h-3 w-3" />
          </button>
          <button onClick={handleZoomOut} className="px-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <ZoomOut className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Mode toggle */}
      {showToggle && onModeChange && (
        <div className="absolute top-3 right-3 z-10 flex rounded-lg bg-card/80 backdrop-blur-sm border border-border/50 overflow-hidden">
          <button
            onClick={() => onModeChange('activity')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all ${
              mode === 'activity' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Globe className="h-3 w-3" /> Activity
          </button>
          <button
            onClick={() => onModeChange('online')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all ${
              mode === 'online' ? 'bg-emerald-500/15 text-emerald-500' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Wifi className="h-3 w-3" /> Online
          </button>
        </div>
      )}

      {/* Loading / Empty state */}
      {geoFeatures.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-muted-foreground pointer-events-none">
          <Globe className="h-10 w-10 opacity-30 animate-pulse" />
          <p className="text-sm font-medium">Loading map...</p>
        </div>
      )}

      {geoFeatures.length > 0 && activePoints.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-muted-foreground pointer-events-none">
          <Globe className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">{mode === 'online' ? 'No users online' : 'No geo data yet'}</p>
        </div>
      )}

      {/* SVG Map */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="w-full h-full select-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#0c111b" />
        <path d={graticulePath} fill="none" stroke="#1a2030" strokeWidth={0.3} />

        {countryPaths.map((cp: { d: string; key: string | number }) => (
          <path key={cp.key} d={cp.d} fill="#172033" stroke="#253352" strokeWidth={0.5} />
        ))}

        {projectedMarkers.map((m, i) => {
          const size = getMarkerSize(m.point.total_minutes);
          const isOnline = mode === 'online';
          const color = isOnline ? '#22c55e' : '#0ea5e9';

          return (
            <g key={`${m.point.geo_city}-${m.point.geo_region}-${i}`}>
              <circle cx={m.x} cy={m.y} r={size * 2} fill={color} opacity={0.06} />
              {isOnline && (
                <circle cx={m.x} cy={m.y} r={size} fill="none" stroke={color} strokeWidth={1.5} opacity={0.4}>
                  <animate attributeName="r" from={String(size)} to={String(size + 10)} dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={m.x} cy={m.y} r={size}
                fill={color} opacity={0.85} stroke={color} strokeWidth={0.5}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (rect) {
                    setTooltip({ point: m.point, x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }
                }}
              />
              {size >= 8 && zoom >= 1.8 && (
                <text x={m.x} y={m.y - size - 4} textAnchor="middle" fill="#8899bb" fontSize={8} fontFamily="Inter, sans-serif" fontWeight={500} style={{ pointerEvents: 'none' }}>
                  {m.point.geo_city}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-20 w-52 rounded-xl border border-border/50 bg-card/95 backdrop-blur-xl shadow-lg p-3 space-y-2 pointer-events-none"
          style={{
            left: Math.min(tooltip.x + 12, (svgRef.current?.clientWidth ?? 800) - 220),
            top: Math.max(tooltip.y - 80, 8),
          }}
        >
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{tooltip.point.geo_city}</p>
              <p className="text-[10px] text-muted-foreground">
                {tooltip.point.geo_region ? `${tooltip.point.geo_region}, ` : ''}{tooltip.point.geo_country}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/50">
            <div className="text-center">
              <p className="text-xs font-bold tabular-nums">{tooltip.point.unique_users}</p>
              <p className="text-[10px] text-muted-foreground">Users</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold tabular-nums">{tooltip.point.session_count}</p>
              <p className="text-[10px] text-muted-foreground">Sessions</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-bold tabular-nums">{formatTime(tooltip.point.total_minutes)}</p>
              <p className="text-[10px] text-muted-foreground">Time</p>
            </div>
          </div>
        </div>
      )}

      {/* Stats bar */}
      {activePoints.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#0c111b]/90 to-transparent pt-8 pb-3 px-4">
          <div className="flex items-center justify-center gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span className="font-semibold text-foreground">{activePoints.length}</span> cities
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3 w-3" />
              <span className="font-semibold text-foreground">{activePoints.reduce((a, p) => a + p.unique_users, 0)}</span> users
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="font-semibold text-foreground">{formatTime(activePoints.reduce((a, p) => a + p.total_minutes, 0))}</span> total
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
