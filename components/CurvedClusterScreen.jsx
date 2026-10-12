'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Copy, Check, RefreshCw, Key, ShieldCheck, Grid, Plus, Minus, UploadCloud, Terminal, ChevronDown, Mail } from 'lucide-react';

export default function CurvedClusterScreen({
  accounts = [],
  repos = [],
  databaseAccounts = [],
  githubCount = 0,
  databaseCount = 0,
  deadCount = 0,
  latestCluster,
  externalOtp = null,
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
  const [otp, setOtp] = useState(externalOtp || null);
  const [isPolling, setIsPolling] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [copiedCluster, setCopiedCluster] = useState(false);
  const [autoInbox, setAutoInbox] = useState(null);
  const [showLogsDropdown, setShowLogsDropdown] = useState(false);
  const logsRef = useRef(null);

  useEffect(() => {
    if (!showLogsDropdown) return;
    const handleOutsideLogs = (e) => {
      if (logsRef.current && !logsRef.current.contains(e.target)) {
        setShowLogsDropdown(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideLogs);
    return () => document.removeEventListener('pointerdown', handleOutsideLogs);
  }, [showLogsDropdown]);

  useEffect(() => {
    if (externalOtp) {
      setOtp(externalOtp);
    }
  }, [externalOtp]);

  // Derive most active/recent cluster
  const currentAccount = useMemo(() => {
    if (latestCluster && (latestCluster.email || latestCluster.clusterName)) return latestCluster;
    if (accounts && accounts.length > 0) {
      const sorted = [...accounts].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return sorted[0];
    }
    return null;
  }, [latestCluster, accounts]);

  // Temp mail is only displayed when a cluster is actually being provisioned / active
  const clusterEmail = currentAccount?.email || currentAccount?.clusterName || '';

  const isAccountVerified = currentAccount && (currentAccount.status === 'active' || currentAccount.status === 'ACTIVE' || (accounts || []).some(a => a.email === clusterEmail));

  // Auto-poll OTP directly in real-time only when NOT already verified
  useEffect(() => {
    if (isAccountVerified) return;
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
      try { navigator.clipboard.writeText(otp).catch(() => {}); } catch(e) {}
      setCopiedOtp(true);
      setTimeout(() => setCopiedOtp(false), 2000);
    }
  };

  const handleCopyCluster = (e) => {
    e.stopPropagation();
    if (clusterEmail) {
      try { navigator.clipboard.writeText(clusterEmail).catch(() => {}); } catch(e) {}
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
        flexShrink: 0,
        position: 'relative',
        zIndex: 1000
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
          overflow: 'visible'
        }}
      >
        {/* LEFT COLUMN: new cluster & cluster otp */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3px' }}>
          
          {/* Row 1: cluster identifier */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.2 }}>
            <span style={{ color: '#94A3B8', fontWeight: 600, letterSpacing: '0.02em' }}>
              {latestCluster && latestCluster.status === 'INITIALIZING...' ? 'new cluster:' : 'cluster:'}
            </span>
            <span style={{ color: '#00F0FF', fontWeight: 700, letterSpacing: '0.03em' }}>{clusterEmail || 'AWAITING CLUSTER INITIATION'}</span>
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
            {!clusterEmail ? (
              <span style={{ color: '#475569', fontWeight: 600, letterSpacing: '0.03em' }}>STANDBY</span>
            ) : otp && otp !== 'NO OTP RECEIVED' ? (
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
            ) : currentAccount && (currentAccount.status === 'active' || currentAccount.status === 'ACTIVE' || (accounts || []).some(a => a.email === clusterEmail)) ? (
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
                VERIFIED
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

        
        {/* RIGHT ACTIONS: LOGS BUTTON SECTION & Grid / Zoom Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }} ref={logsRef}>
          {/* 4th Pic Button Section: LOGS */}
          <button
            type="button"
            onClick={() => setShowLogsDropdown(prev => !prev)}
            title="View All Cluster Account Creation Logs"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: showLogsDropdown 
                ? 'rgba(0, 240, 255, 0.22)' 
                : 'linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(7, 13, 25, 0.95) 100%)',
              border: showLogsDropdown ? '1px solid #00F0FF' : '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: '6px',
              color: '#00F0FF',
              padding: '3px 9px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              boxShadow: showLogsDropdown ? '0 0 12px rgba(0, 240, 255, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.4)',
              transition: 'all 0.15s ease'
            }}
          >
            <Terminal size={12} strokeWidth={2.4} />
            <span>LOGS</span>
            <span style={{
              background: 'rgba(0, 240, 255, 0.15)',
              border: '1px solid rgba(0, 240, 255, 0.35)',
              borderRadius: '3px',
              padding: '0 4px',
              fontSize: '9.5px',
              fontWeight: 800
            }}>
              {accounts.length < 10 ? `0${accounts.length}` : accounts.length}
            </span>
            <ChevronDown size={11} style={{ transform: showLogsDropdown ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
          </button>

          {/* LOGS DROPDOWN LIST (Shows cards of all mails with which railway accounts were created) */}
          {showLogsDropdown && (
            <div 
              className="cluster-logs-dropdown-popover"
              style={{
                position: 'absolute',
                top: '38px',
                right: '0px',
                width: '390px',
                maxHeight: '420px',
                background: 'rgba(9, 14, 26, 0.97)',
                border: '1px solid rgba(0, 240, 255, 0.38)',
                borderRadius: '10px',
                boxShadow: '0 16px 45px rgba(0, 0, 0, 0.9), 0 0 25px rgba(0, 240, 255, 0.2)',
                backdropFilter: 'blur(20px)',
                zIndex: 99999,
                overflowY: 'auto',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Terminal size={13} color="#00F0FF" />
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                    CLUSTER RAILWAY ACCOUNTS
                  </span>
                </div>
                <span style={{ fontSize: '10px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
                  {accounts.length} Total Mail Node{accounts.length === 1 ? '' : 's'}
                </span>
              </div>

              {/* List of Email Cards */}
              {accounts.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: '#64748B', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                  No cluster railway accounts created yet.
                </div>
              ) : (
                accounts.map((acc, idx) => {
                  const mail = acc.email || acc.clusterName || 'unknown@mailu.site';
                  const isVerified = acc.status === 'active' || acc.status === 'ACTIVE';
                  const deployedCount = acc.activeProjectsCount || (acc.repoName ? 1 : 0);
                  return (
                    <div
                      key={acc.accountId || acc._id || idx}
                      style={{
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid rgba(56, 189, 248, 0.25)',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {/* Row 1: Email and Status Pill */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isVerified ? '#10B981' : '#F59E0B', boxShadow: isVerified ? '0 0 6px #10B981' : '0 0 6px #F59E0B' }} />
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#00F0FF', fontFamily: 'var(--font-mono)' }}>
                            {mail}
                          </span>
                        </div>
                        <span style={{
                          background: isVerified ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          border: isVerified ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)',
                          color: isVerified ? '#34D399' : '#FBBF24',
                          fontSize: '9.5px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)'
                        }}>
                          ${(acc.remainingCredits || 5.0).toFixed(2)} • {isVerified ? 'ACTIVE' : 'STANDBY'}
                        </span>
                      </div>

                      {/* Row 2: Metadata */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
                        <span>Projects: <b style={{ color: '#F1F5F9' }}>{deployedCount}/2 Repos</b></span>
                        <span>{acc.createdAt ? new Date(acc.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now'}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

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
    </div>
  );
}


