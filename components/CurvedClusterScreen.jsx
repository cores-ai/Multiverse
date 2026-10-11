'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Copy, Check, RefreshCw, Key, ShieldCheck, Grid, Plus, Minus, UploadCloud } from 'lucide-react';

export default function CurvedClusterScreen({
  accounts = [],
  repos = [],
  databaseAccounts = [],
  githubCount = 0,
  databaseCount = 0,
  deadCount = 0,
  latestCluster,
  pingStatus = { latency: 38 },
  onQuickAddWorker,
  onRefresh,
  onUpload,
  showGrid = true,
  onToggleGrid,
  onZoomIn,
  onZoomOut,
  className = ''
}) {
  const [otp, setOtp] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [copiedCluster, setCopiedCluster] = useState(false);
  const [autoInbox, setAutoInbox] = useState(null);

  // Derive most active/recent cluster
  const currentAccount = useMemo(() => {
    if (latestCluster && (latestCluster.email || latestCluster.clusterName)) return latestCluster;
    if (accounts && accounts.length > 0) {
      const sorted = [...accounts].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return sorted[0];
    }
    return null;
  }, [latestCluster, accounts]);

  // If no cluster is active yet, auto-provision a real disposable inbox so user has a live mailbox ready
  useEffect(() => {
    if (!currentAccount && !autoInbox) {
      fetch('/api/tempmail')
        .then(r => r.json())
        .then(d => {
          if (d && d.success && d.inbox) {
            setAutoInbox(d.inbox);
          }
        })
        .catch(() => {});
    }
  }, [currentAccount, autoInbox]);

  const clusterEmail = currentAccount?.email || currentAccount?.clusterName || currentAccount?.repoName || autoInbox || '';

  // Auto-poll OTP directly in real-time whenever an active cluster email is present
  useEffect(() => {
    if (!clusterEmail) return;
    setOtp(null);
    let isCancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/tempmail?inbox=${encodeURIComponent(clusterEmail)}&timeout=3`);
        const data = await res.json();
        if (!isCancelled && data && data.success && data.otp) {
          setOtp(data.otp);
          return true;
        }
      } catch (err) {
        // silent retry in background
      }
      return false;
    };

    poll();
    const interval = setInterval(async () => {
      if (isCancelled) return;
      const found = await poll();
      if (found) clearInterval(interval);
    }, 2500);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [clusterEmail]);

  // Poll OTP manually from backend
  const handlePollOtp = async (e) => {
    if (e) e.stopPropagation();
    if (!clusterEmail) return;
    setIsPolling(true);
    try {
      const res = await fetch(`/api/tempmail?inbox=${encodeURIComponent(clusterEmail)}&timeout=8`);
      const data = await res.json();
      if (data && data.success && data.otp) {
        setOtp(data.otp);
      } else {
        setOtp(prev => prev || 'NO OTP RECEIVED');
        setTimeout(() => {
          if (!otp) setOtp(null);
        }, 3000);
      }
    } catch (err) {
      console.warn('OTP fetch error:', err);
    } finally {
      setIsPolling(false);
    }
  };

  const handleCopyOtp = (e) => {
    e.stopPropagation();
    if (otp && otp !== 'NO OTP RECEIVED') {
      navigator.clipboard.writeText(otp);
      setCopiedOtp(true);
      setTimeout(() => setCopiedOtp(false), 2000);
    }
  };

  const handleCopyCluster = (e) => {
    e.stopPropagation();
    if (clusterEmail) {
      navigator.clipboard.writeText(clusterEmail);
      setCopiedCluster(true);
      setTimeout(() => setCopiedCluster(false), 2000);
    }
  };

  return (
    <div 
      className={`curved-screen-wrapper ${className}`}
      style={{
        padding: '4px 20px 8px 20px',
        background: 'transparent',
        width: '100%',
        boxSizing: 'border-box',
        flexShrink: 0
      }}
    >
      <div 
        className="overview-cluster-info-card"
        style={{
          width: '100%',
          height: '48px',
          marginBottom: '4px',
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.72) 0%, rgba(7, 13, 25, 0.88) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.28)',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* LEFT COLUMN: new cluster & cluster otp */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3px' }}>
          
          {/* Row 1: new cluster: */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.2 }}>
            <span style={{ color: '#94A3B8', fontWeight: 600, letterSpacing: '0.02em' }}>new cluster:</span>
            <span style={{ color: '#00F0FF', fontWeight: 700, letterSpacing: '0.03em' }}>{clusterEmail || 'INITIALIZING INBOX...'}</span>
            <button
              onClick={handleCopyCluster}
              title="Copy Cluster Identifier"
              style={{
                background: 'transparent',
                border: 'none',
                color: copiedCluster ? '#10B981' : '#64748B',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 2px'
              }}
            >
              {copiedCluster ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>

          {/* Row 2: cluster otp: */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.2 }}>
            <span style={{ color: '#94A3B8', fontWeight: 600, letterSpacing: '0.02em' }}>cluster otp:</span>
            {otp && otp !== 'NO OTP RECEIVED' ? (
              <span 
                style={{ 
                  color: '#10B981', 
                  background: 'rgba(16, 185, 129, 0.15)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  boxShadow: '0 0 10px rgba(16, 185, 129, 0.3)'
                }}
              >
                {otp}
              </span>
            ) : (
              <span 
                style={{ 
                  color: '#F59E0B', 
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span 
                  style={{ 
                    width: '5px', 
                    height: '5px', 
                    borderRadius: '50%', 
                    background: '#F59E0B', 
                    boxShadow: '0 0 6px #F59E0B', 
                    display: 'inline-block' 
                  }} 
                />
                WAITING...
              </span>
            )}

            {/* Quick Poll / Recheck Button */}
            <button
              onClick={handlePollOtp}
              title="Poll OTP directly"
              disabled={isPolling}
              style={{
                background: 'transparent',
                border: 'none',
                color: isPolling ? '#00F0FF' : '#64748B',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 2px'
              }}
            >
              <RefreshCw size={11} className={isPolling ? 'animate-spin' : ''} />
            </button>

            {otp && otp !== 'NO OTP RECEIVED' && (
              <button
                onClick={handleCopyOtp}
                title="Copy OTP"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copiedOtp ? '#10B981' : '#64748B',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0 2px'
                }}
              >
                {copiedOtp ? <Check size={11} /> : <Copy size={11} />}
              </button>
            )}
          </div>
        </div>

        {/* MIDDLE TELEMETRY BAR: Breaker | Upload | Breaker | GitHub | Breaker | Database | Breaker | Active/Dead */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, justifyContent: 'center' }}>
          {/* Breaker 1 */}
          <div style={{ width: '1px', height: '18px', background: 'rgba(56, 189, 248, 0.35)', flexShrink: 0 }} />

          {/* Upload Button */}
          <button
            type="button"
            onClick={onUpload}
            title="Upload or Deploy New Repository"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.14) 0%, rgba(14, 165, 233, 0.08) 100%)',
              border: '1px solid rgba(0, 240, 255, 0.45)',
              borderRadius: '5px',
              color: '#00F0FF',
              padding: '3px 9px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              boxShadow: '0 0 10px rgba(0, 240, 255, 0.15)',
              transition: 'all 0.15s ease',
              flexShrink: 0
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(0, 240, 255, 0.25)';
              e.currentTarget.style.boxShadow = '0 0 14px rgba(0, 240, 255, 0.35)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0, 240, 255, 0.14) 0%, rgba(14, 165, 233, 0.08) 100%)';
              e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 240, 255, 0.15)';
            }}
          >
            <UploadCloud size={12} strokeWidth={2.4} />
            <span>UPLOAD</span>
          </button>

          {/* Breaker 2 */}
          <div style={{ width: '1px', height: '18px', background: 'rgba(56, 189, 248, 0.35)', flexShrink: 0 }} />

          {/* GitHub Count */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', flexShrink: 0 }}>
            <span style={{ color: '#94A3B8', fontWeight: 600 }}>github :</span>
            <span style={{ color: '#00F0FF', fontWeight: 800, background: 'rgba(0, 240, 255, 0.1)', padding: '1px 5px', borderRadius: '3px', border: '1px solid rgba(0, 240, 255, 0.25)' }}>
              {parseInt(githubCount || repos.length || 0) < 10 ? `0${parseInt(githubCount || repos.length || 0)}` : `${parseInt(githubCount || repos.length || 0)}`}
            </span>
          </div>

          {/* Breaker 3 */}
          <div style={{ width: '1px', height: '18px', background: 'rgba(56, 189, 248, 0.35)', flexShrink: 0 }} />

          {/* Database Count */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', flexShrink: 0 }}>
            <span style={{ color: '#94A3B8', fontWeight: 600 }}>database :</span>
            <span style={{ color: '#C084FC', fontWeight: 800, background: 'rgba(192, 132, 252, 0.1)', padding: '1px 5px', borderRadius: '3px', border: '1px solid rgba(192, 132, 252, 0.25)' }}>
              {(() => {
                const cnt = typeof databaseCount === 'number' ? databaseCount : (databaseAccounts && databaseAccounts.length > 0 ? databaseAccounts.length : 0);
                return cnt < 10 ? `0${cnt}` : `${cnt}`;
              })()}
            </span>
          </div>

          {/* Breaker 4 */}
          <div style={{ width: '1px', height: '18px', background: 'rgba(56, 189, 248, 0.35)', flexShrink: 0 }} />

          {/* Active 100% or Dead : XX Alert */}
          <div 
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '10.5px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: '4px',
              background: deadCount > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.12)',
              border: deadCount > 0 ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid rgba(16, 185, 129, 0.4)',
              color: deadCount > 0 ? '#EF4444' : '#10B981',
              boxShadow: deadCount > 0 ? '0 0 10px rgba(239, 68, 68, 0.3)' : '0 0 8px rgba(16, 185, 129, 0.2)',
              flexShrink: 0
            }}
          >
            <span 
              style={{ 
                width: '6px', 
                height: '6px', 
                borderRadius: '50%', 
                background: deadCount > 0 ? '#EF4444' : '#10B981', 
                boxShadow: deadCount > 0 ? '0 0 8px #EF4444' : '0 0 8px #10B981' 
              }} 
            />
            <span>
              {deadCount > 0 
                ? `Dead : ${parseInt(deadCount) < 10 ? `0${parseInt(deadCount)}` : `${parseInt(deadCount)}`}` 
                : 'Active : 100%'}
            </span>
          </div>
        </div>

        {/* RIGHT ACTIONS: Grid Toggle, Zoom In (+), Zoom Out (-) */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div 
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'rgba(5, 10, 20, 0.75)',
              border: '1px solid rgba(0, 240, 255, 0.28)',
              borderRadius: '6px',
              padding: '2px 4px',
              gap: '4px'
            }}
          >
            {/* Grid Toggle Button */}
            <button
              type="button"
              onClick={onToggleGrid}
              title="Toggle Grid"
              style={{
                width: '26px',
                height: '24px',
                background: showGrid ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
                border: showGrid ? '1px solid #00F0FF' : '1px solid transparent',
                borderRadius: '4px',
                color: '#00F0FF',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: showGrid ? '0 0 6px rgba(0, 240, 255, 0.3)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Grid size={14} />
            </button>

            {/* Zoom In (+) Button */}
            <button
              type="button"
              onClick={onZoomIn}
              title="Zoom In"
              style={{
                width: '22px',
                height: '24px',
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#00F0FF'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; }}
            >
              <Plus size={14} strokeWidth={2.2} />
            </button>

            {/* Zoom Out (-) Button */}
            <button
              type="button"
              onClick={onZoomOut}
              title="Zoom Out"
              style={{
                width: '22px',
                height: '24px',
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#00F0FF'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; }}
            >
              <Minus size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
