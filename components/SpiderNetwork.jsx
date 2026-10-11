'use client';

import { useState, useRef, useEffect } from 'react';
import { 
  Zap, Server, HardDrive, Key, Shield, Radio, 
  Cpu, RotateCcw, Move, ExternalLink, Activity, Lock
} from 'lucide-react';

const INITIAL_NODES = [
  {
    id: 'gateway',
    title: 'Fleet Core Gateway',
    subtitle: 'Vercel Serverless Relay',
    type: 'core',
    icon: Zap,
    accent: '#00F0FF',
    x: 460,
    y: 220,
    width: 250,
    height: 120,
    badge: 'ONLINE',
    value: 'ORCHESTRATOR',
    subvalue: 'Real-time Autonomous Hub'
  },
  {
    id: 'credits',
    title: 'Credit Pool Radar',
    subtitle: 'Railway Balance',
    type: 'metric',
    icon: Zap,
    accent: '#10B981',
    x: 100,
    y: 60,
    width: 240,
    height: 115,
    badge: 'REALTIME',
    valueKey: 'credits',
    subvalue: 'Predictive Burn Tracking'
  },
  {
    id: 'capacity',
    title: 'Capacity Balancer',
    subtitle: 'Slot Allocation (2/Acc)',
    type: 'metric',
    icon: Server,
    accent: '#00F0FF',
    x: 820,
    y: 60,
    width: 240,
    height: 115,
    badge: 'ACTIVE',
    valueKey: 'slots',
    subvalue: '1-Heavy + 1-Light Pairing'
  },
  {
    id: 'accounts',
    title: 'Railway Accounts Pool',
    subtitle: 'Multi-Account Fleet',
    type: 'fleet',
    icon: Server,
    accent: '#A855F7',
    x: 70,
    y: 290,
    width: 250,
    height: 120,
    badge: 'FLEET',
    valueKey: 'accountsCount',
    subvalue: '0 Trial Days Wasted'
  },
  {
    id: 'repos',
    title: 'Hosted Repositories',
    subtitle: 'Active Microservices',
    type: 'fleet',
    icon: HardDrive,
    accent: '#38BDF8',
    x: 850,
    y: 290,
    width: 250,
    height: 120,
    badge: 'ONLINE',
    valueKey: 'reposCount',
    subvalue: 'GitHub Direct Ingested'
  },
  {
    id: 'vault',
    title: 'Encrypted Secrets Vault',
    subtitle: 'AES-256-GCM Storage',
    type: 'security',
    icon: Lock,
    accent: '#F59E0B',
    x: 760,
    y: 490,
    width: 240,
    height: 115,
    badge: 'MILITARY',
    value: 'AES-256',
    subvalue: 'Strict repoId Binding'
  },
  {
    id: 'watchdog',
    title: 'Autonomous Watchdog',
    subtitle: 'Zero-Downtime Engine',
    type: 'security',
    icon: Shield,
    accent: '#EF4444',
    x: 160,
    y: 490,
    width: 240,
    height: 115,
    badge: 'JIT READY',
    value: 'BLUE-GREEN',
    subvalue: 'Auto-Migrate at ≤ $2.00'
  },
  {
    id: 'ping',
    title: 'Cluster Health Radar',
    subtitle: 'Global Latency Pulse',
    type: 'metric',
    icon: Activity,
    accent: '#10B981',
    x: 460,
    y: 460,
    width: 250,
    height: 115,
    badge: 'ACTIVE',
    valueKey: 'ping',
    subvalue: 'DoH + Stealth Undetected'
  }
];

const CONNECTIONS = [
  { from: 'gateway', to: 'credits' },
  { from: 'gateway', to: 'capacity' },
  { from: 'gateway', to: 'accounts' },
  { from: 'gateway', to: 'repos' },
  { from: 'gateway', to: 'vault' },
  { from: 'gateway', to: 'watchdog' },
  { from: 'gateway', to: 'ping' },
  { from: 'credits', to: 'accounts' },
  { from: 'capacity', to: 'repos' },
  { from: 'accounts', to: 'watchdog' },
  { from: 'repos', to: 'vault' },
  { from: 'watchdog', to: 'ping' },
  { from: 'vault', to: 'ping' }
];

export default function SpiderNetwork({ totalCredits, usedSlots, totalSlotsCapacity, repos, accounts, pingStatus, onNavigate }) {
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState(null);
  const containerRef = useRef(null);

  // Mouse drag listeners
  const handleMouseDown = (e, id) => {
    e.stopPropagation();
    const node = nodes.find(n => n.id === id);
    if (!node || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setDraggingId(id);
    setDragOffset({
      x: mouseX - node.x,
      y: mouseY - node.y
    });
  };

  const handleMouseMove = (e) => {
    if (!draggingId || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setNodes(prev => prev.map(node => {
      if (node.id === draggingId) {
        // Keep within bounds
        const newX = Math.max(10, Math.min(rect.width - node.width - 10, mouseX - dragOffset.x));
        const newY = Math.max(10, Math.min(rect.height - node.height - 10, mouseY - dragOffset.y));
        return { ...node, x: newX, y: newY };
      }
      return node;
    }));
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  const resetConstellation = () => {
    setNodes(INITIAL_NODES);
  };

  // Node value resolution
  const getNodeDisplayValue = (node) => {
    if (node.valueKey === 'credits') return `$${totalCredits.toFixed(2)}`;
    if (node.valueKey === 'slots') return `${usedSlots} / ${totalSlotsCapacity || 2}`;
    if (node.valueKey === 'reposCount') return `${repos.length} Services`;
    if (node.valueKey === 'accountsCount') return `${accounts.length} Accounts`;
    if (node.valueKey === 'ping') return `${pingStatus.latency}ms`;
    return node.value || 'ACTIVE';
  };

  return (
    <div 
      className="spider-canvas-wrapper" 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Spider Canvas Controls Header */}
      <div className="spider-canvas-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="pulse-spider-beacon"></div>
          <span style={{ fontSize: '12.5px', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-primary)' }}>
            INTERCONNECTED FLEET CONSTELLATION
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            • 8 NODES LINKED • DRAGGABLE CARDS
          </span>
        </div>

        <button className="reset-spider-btn" onClick={resetConstellation} title="Reset Constellation Layout">
          <RotateCcw size={13} />
          <span>Reset Web</span>
        </button>
      </div>

      {/* SVG Spider Net Web Layer */}
      <svg className="spider-svg-layer">
        <defs>
          <linearGradient id="cyanLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.6" />
            <stop offset="50%" stopColor="#8B5CF6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#00F0FF" stopOpacity="0.6" />
          </linearGradient>
          <filter id="glowFilter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {CONNECTIONS.map((conn, idx) => {
          const fromNode = nodes.find(n => n.id === conn.from);
          const toNode = nodes.find(n => n.id === conn.to);
          if (!fromNode || !toNode) return null;

          const x1 = fromNode.x + fromNode.width / 2;
          const y1 = fromNode.y + fromNode.height / 2;
          const x2 = toNode.x + toNode.width / 2;
          const y2 = toNode.y + toNode.height / 2;

          // Compute smooth curved control point
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const curvature = 20; // slight arc
          const cx = midX + (y2 - y1) * 0.05;
          const cy = midY + (x1 - x2) * 0.05;

          const isHighlighted = hoveredNode === fromNode.id || hoveredNode === toNode.id;

          return (
            <g key={`conn-${idx}`}>
              {/* Background faint web strand */}
              <path
                d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                fill="none"
                stroke={isHighlighted ? '#00F0FF' : 'rgba(0, 240, 255, 0.18)'}
                strokeWidth={isHighlighted ? 2.5 : 1.2}
                filter={isHighlighted ? 'url(#glowFilter)' : undefined}
                className="web-strand"
              />
              {/* Animated laser pulse dash along web strand */}
              <path
                d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                fill="none"
                stroke={isHighlighted ? '#FFFFFF' : 'rgba(0, 240, 255, 0.6)'}
                strokeWidth={isHighlighted ? 2.5 : 1.5}
                strokeDasharray="6 14"
                className="web-laser-pulse"
              />
            </g>
          );
        })}
      </svg>

      {/* Interconnected Floating Glass Cards */}
      {nodes.map(node => {
        const Icon = node.icon;
        const isDragging = draggingId === node.id;
        const isHovered = hoveredNode === node.id;

        return (
          <div
            key={node.id}
            className={`floating-spider-card ${isDragging ? 'dragging' : ''} ${node.type === 'core' ? 'core-card' : ''}`}
            style={{
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${node.width}px`,
              borderColor: isHovered || isDragging ? node.accent : 'rgba(255, 255, 255, 0.12)',
              boxShadow: isHovered || isDragging 
                ? `0 14px 36px rgba(0, 0, 0, 0.8), 0 0 30px ${node.accent}50` 
                : '0 10px 28px rgba(0, 0, 0, 0.6)'
            }}
            onMouseDown={(e) => handleMouseDown(e, node.id)}
            onMouseEnter={() => setHoveredNode(node.id)}
            onMouseLeave={() => setHoveredNode(null)}
          >
            {/* Card Drag Handle & Top Details */}
            <div className="spider-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div 
                  className="spider-node-icon" 
                  style={{ 
                    color: node.accent,
                    background: `${node.accent}15`,
                    borderColor: `${node.accent}30`
                  }}
                >
                  <Icon size={15} />
                </div>
                <div>
                  <div className="spider-node-title">{node.title}</div>
                  <div className="spider-node-subtitle">{node.subtitle}</div>
                </div>
              </div>

              <div className="spider-drag-pill" title="Drag card anywhere">
                <Move size={11} />
              </div>
            </div>

            {/* Card Main Live Data & Badge */}
            <div className="spider-card-body">
              <div className="spider-node-value" style={{ color: node.accent }}>
                {getNodeDisplayValue(node)}
              </div>
              <div className="spider-node-footer">
                <span className="spider-subtext">{node.subvalue}</span>
                <span 
                  className="spider-status-pill"
                  style={{ 
                    color: node.accent,
                    background: `${node.accent}18`,
                    borderColor: `${node.accent}40`
                  }}
                >
                  {node.badge}
                </span>
              </div>
            </div>

            {/* Quick Action Link for Fleets */}
            {node.id === 'repos' && onNavigate && (
              <button 
                className="spider-action-btn" 
                onClick={(e) => { e.stopPropagation(); onNavigate('repos'); }}
              >
                <span>View Repos</span>
                <ExternalLink size={10} />
              </button>
            )}
            {node.id === 'accounts' && onNavigate && (
              <button 
                className="spider-action-btn" 
                onClick={(e) => { e.stopPropagation(); onNavigate('accounts'); }}
              >
                <span>Manage Fleet</span>
                <ExternalLink size={10} />
              </button>
            )}
            {node.id === 'vault' && onNavigate && (
              <button 
                className="spider-action-btn" 
                onClick={(e) => { e.stopPropagation(); onNavigate('envs'); }}
              >
                <span>Open Vault</span>
                <ExternalLink size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
