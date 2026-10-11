'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Copy, Check, RefreshCw, Key, ShieldCheck, Grid, Plus, Minus } from 'lucide-react';

export default function CurvedClusterScreen({
  accounts = [],
  latestCluster,
  pingStatus = { latency: 38 },
  onQuickAddWorker,
  onRefresh,
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

  // Derive most active/recent cluster
  const currentAccount = useMemo(() => {
    if (latestCluster && (latestCluster.email || latestCluster.clusterName)) return latestCluster;
    if (accounts && accounts.length > 0) {
      const sorted = [...accounts].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return sorted[0];
    }
    return null;
  }, [latestCluster, accounts]);

  const clusterEmail = currentAccount?.email || currentAccount?.clusterName || currentAccount?.repoName || '';

  // Auto-poll OTP directly whenever a new cluster email is active
  useEffect(() => {
    if (!clusterEmail) return;
    setOtp(null);
    let isCancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/tempmail?inbox=${encodeURIComponent(clusterEmail)}&timeout=8`);
        const data = await res.json();
        if (!isCancelled && data && data.success && data.otp) {
          setOtp(data.otp);
          return true;
        }
      } catch (err) {
        // silent retry
      }
      return false;
    };

    poll();
    const interval = setInterval(async () => {
      const found = await poll();
      if (found) clearInterval(interval);
    }, 6000);

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
      const res = await fetch(`/api/tempmail?inbox=${encodeURIComponent(clusterEmail)}&timeout=15`);
      const data = await res.json();
      if (data && data.success && data.otp) {
        setOtp(data.otp);
      } else {
        setOtp(prev => prev || 'NO OTP RECEIVED');
        setTimeout(() => {
          if (!otp) setOtp(null);
        }, 4000);
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
            <span style={{ color: '#00F0FF', fontWeight: 700, letterSpacing: '0.03em' }}>{clusterEmail || 'WAITING FOR CLUSTER...'}</span>
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
            <span 
              style={{ 
                color: otp && otp !== 'NO OTP RECEIVED' ? '#10B981' : '#F59E0B', 
                fontWeight: 700,
                letterSpacing: '0.04em'
              }}
            >
              {otp || 'WAITING...'}
            </span>
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

        {/* RIGHT ACTIONS: Grid Toggle, Zoom In (+), Zoom Out (-) */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* 3 Buttons: Grid Toggle, Zoom In (+), Zoom Out (-) */}
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
