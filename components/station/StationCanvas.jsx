'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';

const StationScene2D = dynamic(() => import('./StationScene2D'), { ssr: false });

export default function StationCanvas({
  accounts = [],
  repos = [],
  health = 95,
  latency = 38,
  issueCount = 0,
  ticketCount,
  onAddAccount,
  onQuickAddWorker,
  onRefresh,
  onOpenAccount,
  mode = 'server',
  onDeleteNode
}) {
  const station = useRef(null);

  // HUD State
  const [activeCamTab, setActiveCamTab] = useState('3D ISOMETRIC');
  const [qualityTier, setQualityTier] = useState('MEDIUM');
  const [currentFps, setCurrentFps] = useState(60);
  const [systemTime, setSystemTime] = useState('');
  const [activeAlert, setActiveAlert] = useState('🟢 ALL PLATFORM SIGNALS CLEAR // LIVING 2D SIMULATION ACTIVE');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchProgress, setDispatchProgress] = useState(0);
  const [isAuditing, setIsAuditing] = useState(false);

  // Clock Ticking
  useEffect(() => {
    const updateTime = () => setSystemTime(new Date().toLocaleTimeString('en-US', { hour12: false }));
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Map real repos to deployments list format: { id, name, status, accountIndex }
  const deployments = useMemo(() => {
    if (!repos || repos.length === 0) return undefined;
    return repos.map((r, idx) => {
      let accIdx = accounts.findIndex(a => a.accountId === r.assignedAccountId);
      if (accIdx < 0) accIdx = idx % (accounts.length || 1);
      return {
        id: r.repoId || `repo-${idx}`,
        name: r.repoName || `service-${idx}`,
        status: r.deploymentStatus === 'LIVE' ? 'running' : (r.deploymentStatus || 'queued').toLowerCase(),
        accountIndex: accIdx
      };
    });
  }, [repos, accounts]);

  // Formatted accounts array for StationScene2D
  const accountsFormatted = useMemo(() => {
    if (!accounts || accounts.length === 0) return [{ name: 'PF-01 Primary' }, { name: 'PF-02 Secondary' }];
    return accounts.map((a, i) => ({
      name: a.repoName || a.email || a.accountId || `PF-0${i + 1}`
    }));
  }, [accounts]);

  // Total tickets count
  const ticketsNum = ticketCount !== undefined ? ticketCount : accounts.length;

  // ═══════════════════════════════════════════════════════════════════
  // HUD ACTIONS (DISPATCH, AUDIT, SHUNT, CAMERA TABS)
  // ═══════════════════════════════════════════════════════════════════
  const handleSelectCamTab = (tab) => {
    setActiveCamTab(tab);
  };

  const handleToggleQuality = () => {
    const next = qualityTier === 'LOW' ? 'MEDIUM' : qualityTier === 'MEDIUM' ? 'HIGH' : 'LOW';
    setQualityTier(next);
  };

  const handleDispatch = () => {
    if (isDispatching) return;
    setIsDispatching(true);
    setDispatchProgress(0);
    setActiveAlert('🟢 [STATION MASTER] PULLING SIGNAL LEVER // EXPRESS TRAIN CLEARED FROM MOUNTAIN TUNNEL...');

    // Call StationScene2D ref method
    station.current?.dispatch();

    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(p + 14, 100);
      setDispatchProgress(Math.round(p));
      if (p >= 100) {
        clearInterval(iv);
        if (onQuickAddWorker || onAddAccount) {
          (onQuickAddWorker || onAddAccount)();
        }
        setActiveAlert('✅ [STATION MASTER] EXPRESS TRAIN ACCELERATING DOWN MAINLINE! ALL SIGNALS GREEN.');
        setTimeout(() => {
          setIsDispatching(false);
          setDispatchProgress(0);
          setTimeout(() => setActiveAlert('🟢 ALL PLATFORM SIGNALS CLEAR // LIVING 2D SIMULATION ACTIVE'), 3500);
        }, 1200);
      }
    }, 70);
  };

  const handleAudit = () => {
    if (isAuditing) return;
    setIsAuditing(true);
    setActiveAlert('🔍 [CHIEF TTE] ACTIVE ON PLATFORMS // AUDITING TICKETS & API KEYS...');

    // Call StationScene2D ref method
    station.current?.auditTickets();

    setTimeout(() => {
      setActiveAlert('✅ [TTE AUDIT COMPLETE] ALL BERTHS VERIFIED // ZERO FARE EVASION DETECTED!');
      setIsAuditing(false);
      setTimeout(() => setActiveAlert('🟢 ALL PLATFORM SIGNALS CLEAR // LIVING 2D SIMULATION ACTIVE'), 3500);
    }, 2800);
  };

  const handleShunt = (platformIdx) => {
    const pfNum = platformIdx + 1;
    setActiveAlert(`⚙️ [SHUNTING ENGINE] ALIGNING SWITCHES // SHUNTING PF-0${pfNum} TO GOODS SIDING...`);
    station.current?.shunt(platformIdx);
    setTimeout(() => {
      setActiveAlert('🟢 ALL PLATFORM SIGNALS CLEAR // LIVING 2D SIMULATION ACTIVE');
    }, 3500);
  };

  const handleInspectPlatform = (platformIdx) => {
    const pfNum = platformIdx + 1;
    setActiveAlert(`🔍 [CHIEF TTE] MOVING TO PF-0${pfNum} // INSPECTING COACHES & KEYS...`);
    station.current?.inspect(platformIdx);
  };

  const handleStationEvent = (type, payload) => {
    console.log('[StationScene2D Event]', type, payload);
    if (type === 'failed') {
      setActiveAlert(`⚠️ [ALERT] TRAIN ON LANE ${payload.lane + 1} HALTED // DEPLOYMENT FAILED`);
    } else if (type === 'arrived') {
      setActiveAlert(`🚉 [ARRIVED] EXPRESS DOCKED AT PF-0${payload.lane + 1} // BOARDING PASSENGERS`);
    } else if (type === 'departed') {
      setActiveAlert(`💨 [DEPARTED] TRAIN CLEARED PF-0${payload.lane + 1} // MAINLINE CLEAR`);
    }
  };

  // List of platforms for bottom bar
  const platformList = Array.from({ length: Math.min(Math.max(accounts.length, 3), 6) }, (_, i) => `PF-0${i + 1}`);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '750px',
        overflow: 'hidden',
        background: '#0c1527',
        userSelect: 'none'
      }}
    >
      {/* ── 1. Top Station Telegraph Ribbon ── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          background: 'rgba(7, 14, 30, 0.94)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
          padding: '8px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '11px',
          color: '#e2e8f0'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 10px #10B981' }} />
          <span style={{ color: '#F59E0B', fontWeight: 900 }}>[2D RAILWAY SIMULATION]</span>
          <span style={{ color: '#38BDF8', fontWeight: 700 }}>{activeAlert}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#94a3b8' }}>
          <span>FPS: <b style={{ color: '#10B981' }}>{currentFps}</b></span>
          <span>TIME: <b style={{ color: '#F59E0B' }}>{systemTime}</b></span>
          <span>TICKETS: <b style={{ color: '#00F0FF' }}>{ticketsNum} BERTHS</b></span>
          <span>STATUS: <b style={{ color: '#10B981' }}>INTERLOCKED</b></span>
        </div>
      </div>

      {/* ── 2. Top Interactive Staff Command Buttons ── */}
      <div
        style={{
          position: 'absolute',
          top: '42px',
          left: '20px',
          zIndex: 30,
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap'
        }}
      >
        {/* Station Master Dispatch Lever */}
        <button
          onClick={handleDispatch}
          disabled={isDispatching}
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '11px',
            fontWeight: 900,
            color: '#050c1c',
            background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
            border: '1px solid #34D399',
            borderRadius: '6px',
            padding: '8px 16px',
            cursor: isDispatching ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 16px rgba(16,185,129,0.4)'
          }}
        >
          <span>🟢</span>
          <span>{isDispatching ? `STATION MASTER DISPATCHING... ${dispatchProgress}%` : 'STATION MASTER: PULL LEVER // DISPATCH'}</span>
        </button>

        {/* TTE Ticket & Key Audit */}
        <button
          onClick={handleAudit}
          disabled={isAuditing}
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '11px',
            fontWeight: 900,
            color: '#ffffff',
            background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
            border: '1px solid #7dd3fc',
            borderRadius: '6px',
            padding: '8px 16px',
            cursor: isAuditing ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 16px rgba(56,189,248,0.4)'
          }}
        >
          <span>👮‍♂️</span>
          <span>{isAuditing ? 'TTE SCANNING BERTHS...' : 'CHIEF TTE: AUDIT TICKETS & API KEYS'}</span>
        </button>

        {/* Booking Office Ticket Issue */}
        <button
          onClick={onAddAccount || onQuickAddWorker}
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '11px',
            fontWeight: 900,
            color: '#050c1c',
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            border: '1px solid #fbbf24',
            borderRadius: '6px',
            padding: '8px 16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 16px rgba(245,158,11,0.4)'
          }}
        >
          <span>🎟️</span>
          <span>BOOKING CLERK: ISSUE TICKET & FORGE WORKER</span>
        </button>

        {/* Quality Toggle Button */}
        <button
          onClick={handleToggleQuality}
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '10px',
            fontWeight: 800,
            color: '#e2e8f0',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            borderRadius: '6px',
            padding: '8px 12px',
            cursor: 'pointer'
          }}
        >
          ⚙️ {qualityTier}
        </button>
      </div>

      {/* ── 3. Camera View Angles (Top-Right Row 1) ── */}
      <div
        style={{
          position: 'absolute',
          top: '42px',
          right: '20px',
          zIndex: 30,
          display: 'flex',
          gap: '6px',
          background: 'rgba(7, 14, 30, 0.9)',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid rgba(56,189,248,0.3)',
          backdropFilter: 'blur(8px)'
        }}
      >
        {[
          '3D ISOMETRIC',
          'STATION MASTER TOWER',
          'PLATFORM 1 CAM',
          'GRAND CONCOURSE',
          'TOP DOWN'
        ].map((tab) => (
          <button
            key={tab}
            onClick={() => handleSelectCamTab(tab)}
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '10px',
              fontWeight: 800,
              padding: '6px 12px',
              borderRadius: '5px',
              border: activeCamTab === tab ? '1px solid #00F0FF' : '1px solid transparent',
              background: activeCamTab === tab ? 'rgba(0,240,255,0.2)' : 'transparent',
              color: activeCamTab === tab ? '#00F0FF' : '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── 4. Main 2D Railway Scene ── */}
      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: '750px'
        }}
      >
        <StationScene2D
          ref={station}
          lanes={accounts.length || 3}
          accounts={accountsFormatted}
          deployments={deployments}
          health={health}
          latencyMs={latency}
          issues={issueCount}
          tickets={ticketsNum}
          crowd={28}
          view={activeCamTab}
          onEvent={handleStationEvent}
          showControls={true}
          style={{ width: '100%', height: '100%', minHeight: '750px' }}
        />
      </div>

      {/* ── 5. Bottom HUD Controls (PF-01/02/03 INSPECT & SHUNT) ── */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '20px',
          right: '20px',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(7, 14, 30, 0.88)',
          backdropFilter: 'blur(10px)',
          padding: '8px 16px',
          borderRadius: '8px',
          border: '1px solid rgba(56,189,248,0.2)',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '10px',
          color: '#94a3b8'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#00F0FF', fontWeight: 800 }}>🎮 VIEWPORT:</span>
          <span>Interactive Dispatch • Real-Time Interlocking • Live Fleet Telemetry</span>
          <button
            onClick={() => {
              setActiveCamTab('3D ISOMETRIC');
              station.current?.resetView();
            }}
            style={{
              background: 'rgba(56,189,248,0.15)',
              border: '1px solid rgba(56,189,248,0.4)',
              color: '#38bdf8',
              borderRadius: '4px',
              padding: '3px 8px',
              cursor: 'pointer',
              fontSize: '9px',
              fontWeight: 700
            }}
          >
            RESET VIEW
          </button>
        </div>

        {/* Platform Interlocking & Shunt Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {platformList.map((pf, idx) => (
            <div key={pf} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#e2e8f0', fontWeight: 800 }}>{pf}:</span>
              <button
                onClick={() => handleInspectPlatform(idx)}
                style={{
                  background: 'rgba(56,189,248,0.15)',
                  border: '1px solid #38bdf8',
                  color: '#38bdf8',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontSize: '9px',
                  fontWeight: 800
                }}
              >
                TTE INSPECT
              </button>
              <button
                onClick={() => handleShunt(idx)}
                style={{
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid #ef4444',
                  color: '#ef4444',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontSize: '9px',
                  fontWeight: 800
                }}
              >
                SHUNT
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
