'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Plus, Minus, Maximize2, Grid, RotateCcw, Trash2, MoreVertical, Terminal, UploadCloud, Key
} from 'lucide-react';

export default function WorkerCanvas({ 
  accounts = [], 
  repos = [],
  onAddAccount, 
  onAddRepo,
  onQuickAddWorker,
  onRefresh,
  onOpenAccount,
  onViewLogs,
  onModifyRepo,
  onModifyEnv,
  mode = 'server',
  onDeleteNode,
  zoom: externalZoom,
  setZoom: externalSetZoom,
  showGrid: externalShowGrid,
  setShowGrid: externalSetShowGrid
}) {
  const containerRef = useRef(null);
  
  // Canvas Transform State (Pan & Zoom) - Default 50% Zoom
  const [internalZoom, setInternalZoom] = useState(0.5);
  const zoom = externalZoom !== undefined ? externalZoom : internalZoom;
  const setZoom = externalSetZoom || setInternalZoom;

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  const [internalShowGrid, setInternalShowGrid] = useState(true);
  const showGrid = externalShowGrid !== undefined ? externalShowGrid : internalShowGrid;
  const setShowGrid = externalSetShowGrid || setInternalShowGrid;

  // Cluster Generation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [clusterStepText, setClusterStepText] = useState('');
  const [showClusterPopup, setShowClusterPopup] = useState(false);

  // Train Transit Multi-Stage Position ('middle' | 'left' | 'right')
  const [trainPosition, setTrainPosition] = useState('middle');

  const dispatchTrain = useCallback((direction) => {
    setTrainPosition(direction);
    const timer = setTimeout(() => {
      setTrainPosition('middle');
    }, 4500);
    return () => clearTimeout(timer);
  }, []);

  // Autonomous Train Trigger: Automatically runs when repo or env is uploaded/updated from backend
  const prevCountRef = useRef({ accs: (accounts || []).length, repos: (repos || []).length });
  useEffect(() => {
    const prev = prevCountRef.current;
    const curAccs = (accounts || []).length;
    const curRepos = (repos || []).length;
    if (curRepos > prev.repos) {
      dispatchTrain('left');
    } else if (curAccs > prev.accs) {
      dispatchTrain('right');
    }
    prevCountRef.current = { accs: curAccs, repos: curRepos };
  }, [accounts, repos, dispatchTrain]);

  // Edit Panel State
  const [editingCardId, setEditingCardId] = useState(null);

  // Card Dimensions & Distance Constants
  const cardWidth = 310;
  const cardHeight = 94;
  const MIN_DIST_X = cardWidth + 50;
  const MIN_DIST_Y = cardHeight + 40;

  const getDeterministicPosition = (index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    return {
      x: 70 + (col * (cardWidth + 60)),
      y: 330 + (row * (cardHeight + 80))
    };
  };

  const getInitialPositions = (accList) => {
    const res = {};
    accList.forEach((acc, idx) => {
      const id = acc.accountId || acc._id || `acc_${idx}`;
      res[id] = getDeterministicPosition(idx);
    });
    return res;
  };

  // Draggable Worker Nodes State
  const [nodePositions, setNodePositions] = useState(() => getInitialPositions(accounts));
  const [draggedNodeId, setDraggedNodeId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Keep node positions updated and pushed down nicely below the horizon railway track
  useEffect(() => {
    setNodePositions(prev => {
      const next = { ...prev };
      accounts.forEach((acc, idx) => {
        const id = acc.accountId || acc._id || `acc_${idx}`;
        if (!next[id] || next[id].y < 290) {
          next[id] = getDeterministicPosition(idx);
        }
      });
      return next;
    });
  }, [accounts]);

  // Collision Avoidance Engine
  const resolveCollisions = useCallback((positions, activeId = null) => {
    const updated = { ...positions };
    const ids = Object.keys(updated);

    for (let iter = 0; iter < 16; iter++) {
      let hadOverlap = false;

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const idA = ids[i];
          const idB = ids[j];
          const pA = updated[idA];
          const pB = updated[idB];
          if (!pA || !pB) continue;

          const dx = pB.x - pA.x;
          const dy = pB.y - pA.y;
          const overlapX = MIN_DIST_X - Math.abs(dx);
          const overlapY = MIN_DIST_Y - Math.abs(dy);

          if (overlapX > 0 && overlapY > 0) {
            hadOverlap = true;
            if (overlapX < overlapY) {
              const shift = (overlapX / 2) + 2;
              const sign = dx >= 0 ? 1 : -1;
              if (idA === activeId) {
                updated[idB] = { ...pB, x: Math.round(pB.x + shift * sign * 2) };
              } else if (idB === activeId) {
                updated[idA] = { ...pA, x: Math.round(pA.x - shift * sign * 2) };
              } else {
                updated[idA] = { ...pA, x: Math.round(pA.x - shift * sign) };
                updated[idB] = { ...pB, x: Math.round(pB.x + shift * sign) };
              }
            } else {
              const shift = (overlapY / 2) + 2;
              const sign = dy >= 0 ? 1 : -1;
              if (idA === activeId) {
                updated[idB] = { ...pB, y: Math.round(pB.y + shift * sign * 2) };
              } else if (idB === activeId) {
                updated[idA] = { ...pA, y: Math.round(pA.y - shift * sign * 2) };
              } else {
                updated[idA] = { ...pA, y: Math.round(pA.y - shift * sign) };
                updated[idB] = { ...pB, y: Math.round(pB.y + shift * sign) };
              }
            }
          }
        }
      }

      if (!hadOverlap) break;
    }

    return updated;
  }, []);

  useEffect(() => {
    setNodePositions(prev => {
      const updated = { ...prev };
      accounts.forEach((acc, index) => {
        const id = acc.accountId || `acc_${index}`;
        if (!updated[id]) {
          updated[id] = getDeterministicPosition(index);
        }
      });
      const currentIds = new Set(accounts.map((a, i) => a.accountId || `acc_${i}`));
      Object.keys(updated).forEach(key => {
        if (!currentIds.has(key)) delete updated[key];
      });
      return resolveCollisions(updated);
    });
  }, [accounts, resolveCollisions]);

  // Canvas Panning
  const handleCanvasMouseDown = (e) => {
    if (
      e.target.closest('.worker-canvas-card') || 
      e.target.closest('.canvas-control-btn') || 
      e.target.closest('.canvas-add-btn') ||
      e.target.closest('.canvas-add-wrapper') ||
      e.target.closest('.right-tunnel-portal-fixture')
    ) {
      return;
    }
    setEditingCardId(null);
    setIsPanning(true);
    setStartPan({
      x: e.clientX - pan.x,
      y: e.clientY - pan.y
    });
  };

  const handleCanvasMouseMove = useCallback((e) => {
    if (isPanning) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y
      });
    } else if (draggedNodeId) {
      const newX = (e.clientX - pan.x - dragOffset.x) / zoom;
      const newY = (e.clientY - pan.y - dragOffset.y) / zoom;
      setNodePositions(prev => ({
        ...prev,
        [draggedNodeId]: { x: Math.round(newX), y: Math.round(newY) }
      }));
    }
  }, [isPanning, startPan, pan.x, pan.y, draggedNodeId, dragOffset.x, dragOffset.y, zoom]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
    if (draggedNodeId) {
      setNodePositions(prev => resolveCollisions(prev, draggedNodeId));
      setDraggedNodeId(null);
    }
  }, [draggedNodeId, resolveCollisions]);

  useEffect(() => {
    window.addEventListener('mousemove', handleCanvasMouseMove);
    window.addEventListener('mouseup', handleCanvasMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleCanvasMouseMove);
      window.removeEventListener('mouseup', handleCanvasMouseUp);
    };
  }, [handleCanvasMouseMove, handleCanvasMouseUp]);

  // Card Drag Start
  const handleCardMouseDown = (e, id) => {
    e.stopPropagation();
    setEditingCardId(null);
    setDraggedNodeId(id);
    const pos = nodePositions[id] || { x: 320, y: 190 };
    setDragOffset({
      x: (e.clientX - pan.x) - (pos.x * zoom),
      y: (e.clientY - pan.y) - (pos.y * zoom)
    });
  };

  // Toolbar Actions
  // Toolbar Actions
  const handleZoomIn = () => setZoom(z => Math.min(Number((z + 0.10).toFixed(2)), 2.0));
  const handleZoomOut = () => setZoom(z => Math.max(Number((z - 0.10).toFixed(2)), 0.15));
  const handleResetView = () => {
    setZoom(0.5);
    setPan({ x: 0, y: 0 });
  };
  const handleAutoLayout = () => {
    const updated = {};
    accounts.forEach((acc, index) => {
      const id = acc.accountId || acc._id || `acc_${index}`;
      updated[id] = getDeterministicPosition(index);
    });
    setNodePositions(updated);
  };

  // Full Multi-Stage Train Transit Pipeline for Cluster Generation
  const handleGenerateCluster = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenProgress(10);

    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    try {
      // Step 1: Initializing & Mail Generation at Center (Cluster Tunnel)
      setTrainPosition('middle');
      setClusterStepText('1/7 Generating Cluster Mail...');
      setGenProgress(15);
      
      // Trigger mailbox creation / quick worker creation on page
      if (onQuickAddWorker) {
        onQuickAddWorker();
      }

      await sleep(1800);
      setGenProgress(28);

      // Step 2: Train departs to Left (GitHub Tunnel) to inspect repos
      setTrainPosition('left');
      setClusterStepText('2/7 Inspecting GitHub Repositories...');
      
      try {
        await fetch('/api/watchdog/github').catch(() => {});
      } catch (e) {}

      await sleep(2200);
      setGenProgress(45);

      // Step 3: Train returns from GitHub to Center (Cluster Tunnel)
      setTrainPosition('middle');
      setClusterStepText('3/7 Repos Verified • Routing to Server...');
      await sleep(1800);
      setGenProgress(60);

      // Step 4: Train departs to Right (Server / Railway Tunnel) to create instance
      setTrainPosition('right');
      setClusterStepText('4/7 Provisioning Railway Instance...');
      await sleep(2400);
      setGenProgress(72);

      // Step 5: Railway requests OTP -> Train returns to Middle (Cluster Mailbox) to fetch OTP
      setTrainPosition('middle');
      setClusterStepText('5/7 Railway Requested OTP • Fetching from Mail...');
      await sleep(2200);
      setGenProgress(85);

      // Step 6: OTP acquired -> Train glides back to Right (Server) to submit OTP & token
      setTrainPosition('right');
      setClusterStepText('6/7 Submitting OTP to Railway Server...');
      await sleep(2200);
      setGenProgress(95);

      // Step 7: Refresh fleet so the genuine cluster card appears below in the canvas
      if (onRefresh) {
        await onRefresh();
      }

      // Train returns to Middle Tunnel to dock
      setTrainPosition('middle');
      setClusterStepText('7/7 Cluster Verified & Ready!');
      setGenProgress(100);
      setShowClusterPopup(true);

      await sleep(2000);
      setShowClusterPopup(false);
    } catch (err) {
      console.error('[Train Journey Error]:', err);
      setTrainPosition('middle');
      setClusterStepText('Transit Completed');
    } finally {
      setIsGenerating(false);
      setGenProgress(0);
      setClusterStepText('');
    }
  };

  const handleDeleteCluster = async (targetId, targetEmail = null) => {
    if (!targetId) return;
    try {
      setEditingCardId(null);
      // Immediately and aggressively remove from local canvas state
      setNodePositions(prev => {
        const updated = { ...prev };
        delete updated[targetId];
        Object.keys(updated).forEach(k => {
          if (k === targetId || k.includes(targetId)) delete updated[k];
        });
        return updated;
      });

      if (onDeleteNode) {
        await onDeleteNode(targetId, targetEmail);
      } else {
        const q = targetEmail ? `accountId=${encodeURIComponent(targetId)}&email=${encodeURIComponent(targetEmail)}` : `accountId=${encodeURIComponent(targetId)}`;
        await fetch(`/api/accounts?${q}`, { method: 'DELETE' }).catch(() => {});
        if (onRefresh) onRefresh();
      }
    } catch (e) {
      console.error('Failed to delete node:', e);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // GLOWING SINGLE-THREAD LASER WIRES (NORMAL PIPE VLA)
  // ─────────────────────────────────────────────────────────────
  const wireConnections = [];
  const activeSockets = {};

  if (accounts.length > 1) {
    const centers = accounts.map((acc, idx) => {
      const id = acc.accountId || `acc_${idx}`;
      const pos = nodePositions[id] || getDeterministicPosition(idx);
      return {
        idx,
        id,
        pos,
        cx: pos.x + cardWidth / 2,
        cy: pos.y + cardHeight / 2
      };
    });

    const connectedIndices = new Set([0]);
    const mstEdges = [];

    while (connectedIndices.size < accounts.length) {
      let bestDist = Infinity;
      let bestU = -1;
      let bestV = -1;

      for (const u of connectedIndices) {
        for (let v = 0; v < accounts.length; v++) {
          if (!connectedIndices.has(v)) {
            const dist = Math.hypot(centers[u].cx - centers[v].cx, centers[u].cy - centers[v].cy);
            if (dist < bestDist) {
              bestDist = dist;
              bestU = u;
              bestV = v;
            }
          }
        }
      }

      if (bestV !== -1) {
        connectedIndices.add(bestV);
        mstEdges.push({ a: bestU, b: bestV });
      } else {
        break;
      }
    }

    mstEdges.forEach((edge) => {
      const nodeA = centers[edge.a];
      const nodeB = centers[edge.b];
      const posA = nodeA.pos;
      const posB = nodeB.pos;

      const dx = nodeB.cx - nodeA.cx;
      const dy = nodeB.cy - nodeA.cy;

      let startX, startY, endX, endY, isVertical;
      let socketA, socketB;

      if (Math.abs(dy) > Math.abs(dx) * 0.75) {
        isVertical = true;
        if (dy >= 0) {
          startX = nodeA.cx;
          startY = posA.y + cardHeight;
          endX = nodeB.cx;
          endY = posB.y;
          socketA = 'bottom';
          socketB = 'top';
        } else {
          startX = nodeA.cx;
          startY = posA.y;
          endX = nodeB.cx;
          endY = posB.y + cardHeight;
          socketA = 'top';
          socketB = 'bottom';
        }
      } else {
        isVertical = false;
        if (dx >= 0) {
          startX = posA.x + cardWidth;
          startY = nodeA.cy;
          endX = posB.x;
          endY = nodeB.cy;
          socketA = 'right';
          socketB = 'left';
        } else {
          startX = posA.x;
          startY = nodeA.cy;
          endX = posB.x + cardWidth;
          endY = nodeB.cy;
          socketA = 'left';
          socketB = 'right';
        }
      }

      if (!activeSockets[nodeA.id]) activeSockets[nodeA.id] = new Set();
      if (!activeSockets[nodeB.id]) activeSockets[nodeB.id] = new Set();
      activeSockets[nodeA.id].add(socketA);
      activeSockets[nodeB.id].add(socketB);

      let pathString;
      if (isVertical) {
        const midY = startY + (endY - startY) * 0.5;
        pathString = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
      } else {
        const midX = startX + (endX - startX) * 0.5;
        pathString = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
      }

      wireConnections.push({
        id: `wire_${nodeA.id}_${nodeB.id}`,
        path: pathString,
        startX, startY, endX, endY
      });
    });
  }

  return (
    <div 
      ref={containerRef}
      className={`worker-canvas-viewport ${showGrid ? 'has-morse-grid' : ''}`}
      onMouseDown={handleCanvasMouseDown}
    >
      {/* Dynamic Transform Layer (Pan & Zoom) */}
      <div 
        className="worker-canvas-stage"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0'
        }}
      >
        {/* ========================================================
            GLOWING WIRES / PIPES SVG LAYER (Normal Pipe Vla)
            ======================================================== */}
        <svg 
          className="canvas-svg-wire-layer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible'
          }}
        >
          <defs>
            <filter id={`neonWireGlow_${mode}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id={`wireGradient_${mode}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#34D399" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#00F0FF" stopOpacity="0.8" />
            </linearGradient>
          </defs>

          {wireConnections.map((wire, wIdx) => (
            <g key={wire.id}>
              {/* Thin Ambient Subtle Aura */}
              <path
                d={wire.path}
                stroke="rgba(0, 240, 255, 0.08)"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
              />

              {/* Ultra-Thin Laser Core Pipe */}
              <path
                d={wire.path}
                stroke="rgba(56, 189, 248, 0.35)"
                strokeWidth="1"
                fill="none"
                strokeLinecap="round"
              />

              {/* Fast Electric Pulse Stream */}
              <path
                d={wire.path}
                stroke="#00F0FF"
                strokeWidth="1.2"
                strokeDasharray="4 12"
                fill="none"
                strokeLinecap="round"
                className="wire-flowing-energy"
                style={{
                  animation: `flowingDash 1s linear infinite`
                }}
              />

              {/* Tiny Laser Photon Packet Flow */}
              <circle r="2.2" fill="#00F0FF" filter={`url(#neonWireGlow_${mode})`}>
                <animateMotion 
                  path={wire.path} 
                  dur={`${1.6 + (wIdx * 0.25)}s`} 
                  repeatCount="indefinite" 
                />
              </circle>
              <circle r="1.2" fill="#FFFFFF">
                <animateMotion 
                  path={wire.path} 
                  dur={`${1.6 + (wIdx * 0.25)}s`} 
                  repeatCount="indefinite" 
                />
              </circle>

              {/* Micro Socket Connection Points */}
              <circle cx={wire.startX} cy={wire.startY} r="2" fill="#00F0FF" />
              <circle cx={wire.endX} cy={wire.endY} r="2" fill="#34D399" />
            </g>
          ))}
        </svg>

        {/* ========================================================
            DRAGGABLE GITHUB WORKER NODES (Original Nodes)
            ======================================================== */}
        {accounts.map((acc, idx) => {
          const id = acc.accountId || `acc_${idx}`;
          const pos = nodePositions[id] || getDeterministicPosition(idx);
          const isDragging = draggedNodeId === id;

          const assignedRepos = repos.filter(r => r.assignedAccountId === id || r.accountId === id);
          const runningCount = assignedRepos.length || acc.activeProjectsCount || 0;
          const maxCapacity = acc.maxCapacity || 2;
          const balance = Number(acc.remainingCredits !== undefined ? acc.remainingCredits : 5.0).toFixed(2);
          const isLowCredit = Number(balance) <= 2.0;

          const storageLimit = Number(acc.storageLimitGb !== undefined ? acc.storageLimitGb : 10.0);
          const storageUsed = Number(acc.storageUsedGb !== undefined ? acc.storageUsedGb : (idx === 0 ? 0.42 : idx === 1 ? 1.15 : 0.28));
          const storageAvail = Math.max(0, storageLimit - storageUsed).toFixed(2);
          const isLowStorage = (storageLimit - storageUsed) < 1.0;

          const dbUsed = acc.storageUsedGb !== undefined ? `${acc.storageUsedGb} GB` : (idx === 0 ? '0.12 GB' : idx === 1 ? '64 MB' : '0.45 GB');

          let label;
          if (mode === 'storage') {
            label = acc.clusterName || acc.bucketName || acc.email || `r2-vault-${idx + 1}`;
          } else if (mode === 'database') {
            label = acc.clusterName || acc.dbName || acc.email || `database-node-${idx + 1}`;
          } else {
            // Server mode: strictly name card after the generated cluster mail
            label = acc.email || acc.repoName || acc.accountId || `worker-${idx + 1}`;
          }

          const isDead = acc.status === 'DEAD' || acc.status === 'FAILED' || acc.status === 'ERROR' || assignedRepos.some(r => ['FAILED', 'DEAD', 'CRASHED', 'ERROR'].includes((r.deploymentStatus || '').toUpperCase()));

          return (
            <div
              key={id}
              className={`worker-canvas-card ${isDragging ? 'dragging' : ''} ${isDead ? 'card-dead-alert-border' : ''}`}
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px)${isDragging ? ' scale(1.03)' : ''}`,
                zIndex: isDragging ? 50 : 10
              }}
              onMouseDown={(e) => handleCardMouseDown(e, id)}
            >
              {activeSockets[id]?.has('left') && <div className="card-wire-socket socket-left"></div>}
              {activeSockets[id]?.has('right') && <div className="card-wire-socket socket-right"></div>}
              {activeSockets[id]?.has('top') && <div className="card-wire-socket socket-top"></div>}
              {activeSockets[id]?.has('bottom') && <div className="card-wire-socket socket-bottom"></div>}

              {/* Card Header: GitHub Octocat Brand Icon + Worker Title + Edit Menu */}
              <div className="card-top-row">
                <div className="card-brand-icon">
                  {mode === 'storage' ? (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#38BDF8" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" fill="rgba(56, 189, 248, 0.22)" />
                      <polyline points="9 13 12 16 15 13" stroke="#00F0FF" strokeWidth="2" />
                      <line x1="12" y1="9" x2="12" y2="16" stroke="#00F0FF" strokeWidth="2" />
                    </svg>
                  ) : mode === 'database' ? (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#C084FC" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <ellipse cx="12" cy="5" rx="9" ry="3" fill="rgba(192, 132, 252, 0.25)" stroke="#C084FC" />
                      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" stroke="#A855F7" />
                      <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" stroke="#A855F7" />
                    </svg>
                  ) : (
                    /* GitHub Octocat Brand Icon */
                    <svg viewBox="0 0 24 24" width="22" height="22" fill={isDead ? '#EF4444' : 'currentColor'}>
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                  )}
                </div>
                <span className="card-worker-title" title={label}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {isDead && (
                    <button 
                      className="card-logs-external-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onViewLogs) onViewLogs({ ...acc, label, repoName: assignedRepos[0]?.repoName || label });
                      }}
                      title="View Railway Deployment Error Logs"
                    >
                      <Terminal size={10} />
                      <span>Logs</span>
                    </button>
                  )}
                  <button 
                    className="card-edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCluster(acc.accountId || acc._id || id, acc.email);
                    }}
                    title="Delete Worker Node"
                    style={{ color: '#EF4444' }}
                  >
                    <Trash2 size={13} />
                  </button>
                  <button 
                    className="card-edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCardId(editingCardId === id ? null : id);
                    }}
                    title="Node Options"
                  >
                    <MoreVertical size={14} />
                  </button>
                </div>
              </div>

              {/* Edit Dropdown Panel */}
              {editingCardId === id && (
                <div className="card-edit-panel" onClick={(e) => e.stopPropagation()}>
                  <div className="edit-panel-info">
                    <span className="edit-panel-label">ID</span>
                    <span className="edit-panel-value">{id}</span>
                  </div>
                  <div className="edit-panel-info">
                    <span className="edit-panel-label">Credit</span>
                    <span className="edit-panel-value">${balance}</span>
                  </div>
                  <div className="edit-panel-info">
                    <span className="edit-panel-label">Repos</span>
                    <span className="edit-panel-value">{runningCount}/{maxCapacity}</span>
                  </div>
                  <button 
                    className="edit-panel-delete-btn"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '4px', paddingTop: '6px', color: '#00F0FF' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCardId(null);
                      if (onModifyRepo) onModifyRepo({ ...acc, label, repoName: assignedRepos[0]?.repoName || label });
                    }}
                  >
                    <UploadCloud size={13} />
                    <span>Modify Repo</span>
                  </button>
                  <button 
                    className="edit-panel-delete-btn"
                    style={{ color: '#38BDF8' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCardId(null);
                      if (onModifyEnv) onModifyEnv({ ...acc, label, repoName: assignedRepos[0]?.repoName || label });
                    }}
                  >
                    <Key size={13} />
                    <span>Modify ENV</span>
                  </button>
                  <button 
                    className="edit-panel-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCluster(acc.accountId || acc._id || id, acc.email);
                    }}
                  >
                    <Trash2 size={13} />
                    <span>Delete Node</span>
                  </button>
                </div>
              )}

              {/* Card Status: Beacon Dot + Online + Metrics */}
              <div className="card-status-row">
                <div className="status-indicator-group">
                  <span className={`status-glow-dot ${mode === 'storage' ? (isLowStorage ? 'low' : '') : (isLowCredit ? 'low' : '')}`}></span>
                  <span className={`status-text ${mode === 'storage' ? (isLowStorage ? 'low' : '') : (isLowCredit ? 'low' : '')}`}>
                    {mode === 'storage' ? (isLowStorage ? 'Low Quota' : 'Online') : (isLowCredit ? 'Low Credit' : 'Online')}
                  </span>
                </div>

                <div className="card-metrics-badge">
                  {mode === 'storage' ? (
                    <>
                      <span className="metric-credit" style={{ color: isLowStorage ? '#F59E0B' : '#00F0FF' }}>
                        {storageAvail} GB Avail
                      </span>
                      <span className="dot-sep">&bull;</span>
                      <span className="metric-slots" style={{ color: '#94A3B8' }}>
                        10 GB Free
                      </span>
                    </>
                  ) : mode === 'database' ? (
                    <>
                      <span className="metric-credit" style={{ color: '#C084FC' }}>
                        {dbUsed}
                      </span>
                      <span className="dot-sep">&bull;</span>
                      <span className="metric-slots">
                        {runningCount}/{maxCapacity} Replicas
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="metric-credit" style={{ color: isLowCredit ? '#F59E0B' : '#10B981' }}>
                        ${balance}
                      </span>
                      <span className="dot-sep">&bull;</span>
                      <span className="metric-slots">
                        {runningCount}/{maxCapacity} Repos
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Empty Canvas Prompt removed per user design */}
      </div>


      {/* ==============================================================================
          HORIZON RAILWAY TRACK, MOUNTAIN TUNNELS & DUAL-FACED SHUTTLE TRAINS
          Entire railway system shifted down cleanly to provide room for top card height
          ============================================================================== */}
      <div 
        className="horizon-railway-system-layer"
        style={{
          position: 'absolute',
          top: '38px',
          left: 0,
          right: 0,
          height: '70px',
          zIndex: 40,
          pointerEvents: 'none'
        }}
      >
        {/* 1. Track Atmosphere & Cavern Conduit (Pure horizontal alignment with tracks) */}
        <div 
          style={{
            position: 'absolute',
            top: '25px',
            left: '0px',
            right: '0px',
            height: '10px',
            background: 'linear-gradient(180deg, rgba(2, 6, 23, 0.9) 0%, rgba(2, 6, 23, 0.4) 100%)',
            zIndex: 34,
            pointerEvents: 'none'
          }}
        />

      {/* 2. Continuous Connected Steel Railway Track */}
      <div
        className="horizon-railway-continuous-track"
        style={{
          position: 'absolute',
          top: '27.8px',
          left: 0,
          right: 0,
          height: '6px',
          zIndex: 35,
          pointerEvents: 'none',
          backgroundImage: 'url(/seamless_metal_track_tile.png)',
          backgroundRepeat: 'repeat-x',
          backgroundSize: '4.2px 6px',
          backgroundPosition: 'left top'
        }}
      />

      {/* 3. Single Continuous Horizon Express Train Consist (Stationed in Middle Tunnel) */}
      <div 
        className={`train-consist-single ${trainPosition ? `pos-${trainPosition}` : 'pos-middle'}`}
      >
        {/* Seamless Continuous Train Body - Zero Cuts / Zero Tukde */}
        <div className="train-body-continuous">
          {/* Rear Locomotive: Flipped */}
          <img 
            src="/bullet_train_sprite_flipped.png" 
            alt="Rear Locomotive"
            style={{ width: '27.4px', height: '8.8px', display: 'block' }}
          />
          {/* Intermediate Bogey 2 */}
          <img 
            src="/bullet_train_bogey.png" 
            alt="Passenger Bogey 2"
            style={{ width: '13.5px', height: '8.8px', display: 'block' }}
          />
          {/* Intermediate Bogey 1 */}
          <img 
            src="/bullet_train_bogey.png" 
            alt="Passenger Bogey 1"
            style={{ width: '13.5px', height: '8.8px', display: 'block' }}
          />
          {/* Front Locomotive */}
          <img 
            src="/bullet_train_sprite.png" 
            alt="Front Locomotive"
            style={{ width: '27.4px', height: '8.8px', display: 'block' }}
          />
        </div>

        {/* Tyres (Wheels) Spaced at Clean Gaps Underneath the Train */}
        <div className="train-tyres-continuous-row">
          <span className="train-tyre" style={{ left: '4.5px' }} />
          <span className="train-tyre" style={{ left: '20px' }} />
          <span className="train-tyre" style={{ left: '33.5px' }} />
          <span className="train-tyre" style={{ left: '47px' }} />
          <span className="train-tyre" style={{ left: '60.5px' }} />
          <span className="train-tyre" style={{ left: '74.5px' }} />
        </div>
      </div>

      {/* 5. Left-Side Train Portal (Mountain on Left, Arch Mouth Facing Right with tracks emerging) */}
      <div 
        className="left-tunnel-portal-fixture"
        title="GitHub Gateway (Autonomous Pipeline)"
        style={{
          position: 'absolute',
          top: '-20px',
          left: '0px',
          width: '44px',
          zIndex: 44,
          cursor: 'default',
          pointerEvents: 'none',
          overflow: 'visible',
          background: 'transparent',
          userSelect: 'none'
        }}
      >
        <img 
          src="/perfect_left_side_tunnel.png" 
          alt="Left mountain portal facing eastward along railway tracks"
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.8))'
          }}
        />

        {/* Micro-Text Sub-Portal Action (Positioned cleanly below the railway track bed) */}
        <div 
          className="tunnel-cluster-text-action"
          style={{
            position: 'absolute',
            top: '55px',
            left: '2px',
            whiteSpace: 'nowrap',
            fontSize: '7.5px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: 'rgba(255, 255, 255, 0.65)',
            cursor: 'default',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.95)'
          }}
        >
          <span>Github</span>
        </div>
      </div>

      {/* 6. Center Double-Opening Mountain Tunnel (Real Grey Rock with Cracks & Dual Sideways Caverns) */}
      <div 
        className="center-tunnel-portal-fixture"
        title="Cluster Core (Autonomous Pipeline - Triggered on Repo/ENV Upload)"
        style={{
          position: 'absolute',
          top: '-20px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '95px',
          zIndex: 44,
          cursor: 'default',
          pointerEvents: 'none',
          overflow: 'visible',
          background: 'transparent',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          userSelect: 'none'
        }}
      >
        <img 
          src="/perfect_center_mountain_dual.png" 
          alt="Center mountain tunnel with dual sideways portals"
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            filter: 'drop-shadow(0 2px 10px rgba(0, 0, 0, 0.9))'
          }}
        />

        {/* Micro-Text Sub-Tunnel Action (Positioned cleanly below the railway track bed) */}
        <div 
          className="tunnel-cluster-text-action"
          style={{
            position: 'absolute',
            top: '55px',
            whiteSpace: 'nowrap',
            fontSize: '7.5px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: isGenerating ? '#00F0FF' : 'rgba(255, 255, 255, 0.65)',
            cursor: 'default',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.95)'
          }}
        >
          {isGenerating ? (
            <span style={{ color: '#00F0FF', fontWeight: 700, letterSpacing: '0.02em' }}>
              {clusterStepText || `Processing ${genProgress}%`}
            </span>
          ) : (
            <span>Cluster Core</span>
          )}
        </div>
      </div>

      {/* 7. Right-Side Train Portal (Mountain on Right, Arch Mouth Facing Left with tracks emerging) */}
      <div 
        className="right-tunnel-portal-fixture"
        title="Railway Server Fleet (Autonomous Pipeline)"
        style={{
          position: 'absolute',
          top: '-20px',
          right: '0px',
          width: '44px',
          zIndex: 44,
          cursor: 'default',
          pointerEvents: 'none',
          overflow: 'visible',
          background: 'transparent',
          userSelect: 'none'
        }}
      >
        <img 
          src="/perfect_right_side_tunnel.png" 
          alt="Right mountain portal facing westward along railway tracks"
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.8))'
          }}
        />

        {/* Micro-Text Sub-Portal Action (Positioned cleanly below the railway track bed) */}
        <div 
          className="tunnel-cluster-text-action"
          style={{
            position: 'absolute',
            top: '55px',
            right: '2px',
            whiteSpace: 'nowrap',
            fontSize: '7.5px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: 'rgba(255, 255, 255, 0.65)',
            cursor: 'default',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.95)'
          }}
        >
          <span>Server</span>
        </div>
      </div>
      </div>

      {/* Cluster Created Toast */}
      {showClusterPopup && (
        <div className="cluster-created-popup">
          <span className="cluster-popup-icon">✓</span>
          <span className="cluster-popup-text">Cluster Created Successfully</span>
        </div>
      )}
    </div>
  );
}
