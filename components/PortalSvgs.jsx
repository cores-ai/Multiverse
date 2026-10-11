'use client';

/**
 * PortalSvgs.jsx
 * High-definition vector SVG fixtures for the Horizon Railway Mesh:
 * 1. LeftTrainPortalSvg: Mountain cliff flush at left:0, concrete arch collar, bullet train emerging right.
 * 2. CenterTunnelSvg: Symmetrical double-opening mountain tunnel with unobstructed continuous rail passage.
 * 3. RightTrainPortalSvg: Mountain cliff flush at right:0, concrete arch collar, bullet train emerging left.
 */

export function LeftTrainPortalSvg({ className = '', style = {} }) {
  return (
    <svg
      viewBox="0 0 100 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        overflow: 'visible',
        ...style
      }}
    >
      <defs>
        {/* Mountain Rock Gradients */}
        <linearGradient id="leftRockGrad" x1="0" y1="0" x2="60" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#253346" />
          <stop offset="45%" stopColor="#182332" />
          <stop offset="100%" stopColor="#0f1726" />
        </linearGradient>

        <linearGradient id="rockFacetHighlight" x1="0" y1="0" x2="40" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b4d66" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#223042" stopOpacity="0.3" />
        </linearGradient>

        {/* Arch Collar Gradient */}
        <linearGradient id="archCollarGrad" x1="12" y1="6" x2="48" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#cbd5e1" />
          <stop offset="50%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>

        {/* Inner Cavern Shadow */}
        <linearGradient id="tunnelVoid" x1="28" y1="8" x2="28" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#020617" />
          <stop offset="100%" stopColor="#090d16" />
        </linearGradient>

        {/* Bullet Train Aerodynamic Shell */}
        <linearGradient id="trainShellGrad" x1="22" y1="24" x2="78" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="60%" stopColor="#e2e8f0" />
          <stop offset="90%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>

        {/* Cockpit Windshield Gloss */}
        <linearGradient id="windshieldGrad" x1="56" y1="26" x2="72" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0284c7" />
          <stop offset="65%" stopColor="#0369a1" />
          <stop offset="100%" stopColor="#082f49" />
        </linearGradient>

        {/* Headlight Radial Glow */}
        <radialGradient id="headlightGlow" cx="74" cy="38" r="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fef08a" stopOpacity="1" />
          <stop offset="40%" stopColor="#eab308" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ca8a04" stopOpacity="0" />
        </radialGradient>

        {/* Crisp Shadow */}
        <filter id="vectorDropShadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.6" />
        </filter>
      </defs>

      <g filter="url(#vectorDropShadow)">
        {/* 1. Mountain Rock Cliff (Flush to x:0 left edge with zero gap) */}
        <path
          d="M 0,0 L 46,1 C 52,5 55,12 53,20 C 51,26 47,33 42,43.5 L 0,43.5 Z"
          fill="url(#leftRockGrad)"
        />

        {/* Rock Structural Facets / Ridges for rich tactile depth */}
        <path
          d="M 0,0 L 28,14 L 0,26 Z"
          fill="url(#rockFacetHighlight)"
        />
        <path
          d="M 28,14 L 46,1 L 38,18 L 28,14 Z"
          fill="#1c2738"
          fillOpacity="0.75"
        />
        <path
          d="M 0,26 L 22,22 L 14,43.5 L 0,43.5 Z"
          fill="#141c28"
          fillOpacity="0.55"
        />
        <path
          d="M 22,22 L 38,18 L 48,22 C 45,30 42,37 38,43.5 L 22,34 Z"
          fill="#1f2c3d"
          fillOpacity="0.65"
        />

        {/* 2. Concrete Arch Portal Collar */}
        {/* Outer Arch */}
        <path
          d="M 12,43.5 L 12,23 C 12,12 21,5 33,5 C 45,5 54,12 54,23 L 54,43.5 L 48,43.5 L 48,24 C 48,16 41,11 33,11 C 25,11 18,16 18,24 L 18,43.5 Z"
          fill="url(#archCollarGrad)"
        />
        {/* Inner Arch Void (Cavern Mouth) */}
        <path
          d="M 18,43.5 L 18,24 C 18,16 25,11 33,11 C 41,11 48,16 48,24 L 48,43.5 Z"
          fill="url(#tunnelVoid)"
        />

        {/* Inner Portal Depth Ring */}
        <path
          d="M 20,43.5 L 20,25 C 20,18 26,14 33,14 C 40,14 46,18 46,25 L 46,43.5"
          stroke="#0f172a"
          strokeWidth="1.5"
          fill="none"
        />

        {/* 3. Emerging High-Speed Bullet Train */}
        {/* Train Undercarriage Shadow & Skirt */}
        <rect x="22" y="41" width="54" height="2.5" rx="1" fill="#0b0f19" />
        <line x1="24" y1="42.5" x2="74" y2="42.5" stroke="#334155" strokeWidth="0.8" />

        {/* Aerodynamic Train Body */}
        <path
          d="M 22,26 L 46,26 C 54,26 62,28 69,32 C 73,34.5 76,37.5 77.5,39.5 C 78.2,40.5 77.8,42 76,42 L 22,42 Z"
          fill="url(#trainShellGrad)"
        />

        {/* Cyberpunk Livery Accent Line (Cyan Edge Trim) */}
        <path
          d="M 22,39.5 L 68,39.5 C 72,39.5 75,40.5 76.5,41.2"
          stroke="#00f0ff"
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* Passenger Cabin Windows Stripe */}
        <rect x="24" y="29" width="6" height="3.5" rx="0.8" fill="#1e293b" />
        <rect x="32" y="29" width="6" height="3.5" rx="0.8" fill="#1e293b" />
        <rect x="40" y="29" width="6" height="3.5" rx="0.8" fill="#1e293b" />

        {/* Aerodynamic Cockpit Windshield */}
        <path
          d="M 50,28 L 62,31 C 65,32 67,34 68,36 L 56,36 C 53,36 51,34 50,32 Z"
          fill="url(#windshieldGrad)"
        />
        {/* Specular White Glint on Cockpit Glass */}
        <path
          d="M 52,29.5 L 61,32"
          stroke="#38bdf8"
          strokeWidth="0.8"
          strokeLinecap="round"
        />

        {/* Sleek Nose Headlight Lamp */}
        <circle cx="74" cy="38" r="4.5" fill="url(#headlightGlow)" />
        <circle cx="74" cy="38" r="1.6" fill="#ffffff" />
        <circle cx="74" cy="38" r="1.1" fill="#fef08a" />
      </g>
    </svg>
  );
}

export function RightTrainPortalSvg({ className = '', style = {} }) {
  return (
    <svg
      viewBox="0 0 100 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        overflow: 'visible',
        ...style
      }}
    >
      <defs>
        {/* Mountain Rock Gradients (Right Side) */}
        <linearGradient id="rightRockGrad" x1="100" y1="0" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#253346" />
          <stop offset="45%" stopColor="#182332" />
          <stop offset="100%" stopColor="#0f1726" />
        </linearGradient>

        <linearGradient id="rightRockFacet" x1="100" y1="0" x2="60" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b4d66" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#223042" stopOpacity="0.3" />
        </linearGradient>

        {/* Arch Collar Gradient */}
        <linearGradient id="rightArchCollarGrad" x1="88" y1="6" x2="52" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#cbd5e1" />
          <stop offset="50%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>

        {/* Inner Cavern Shadow */}
        <linearGradient id="rightTunnelVoid" x1="72" y1="8" x2="72" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#020617" />
          <stop offset="100%" stopColor="#090d16" />
        </linearGradient>

        {/* Bullet Train Aerodynamic Shell */}
        <linearGradient id="rightTrainShellGrad" x1="78" y1="24" x2="22" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="60%" stopColor="#e2e8f0" />
          <stop offset="90%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>

        {/* Cockpit Windshield Gloss */}
        <linearGradient id="rightWindshieldGrad" x1="44" y1="26" x2="28" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0284c7" />
          <stop offset="65%" stopColor="#0369a1" />
          <stop offset="100%" stopColor="#082f49" />
        </linearGradient>

        {/* Headlight Radial Glow */}
        <radialGradient id="rightHeadlightGlow" cx="26" cy="38" r="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fef08a" stopOpacity="1" />
          <stop offset="40%" stopColor="#eab308" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ca8a04" stopOpacity="0" />
        </radialGradient>

        {/* Crisp Shadow */}
        <filter id="rightVectorDropShadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.6" />
        </filter>
      </defs>

      <g filter="url(#rightVectorDropShadow)">
        {/* 1. Mountain Rock Cliff (Flush to x:100 right edge with zero gap) */}
        <path
          d="M 100,0 L 54,1 C 48,5 45,12 47,20 C 49,26 53,33 58,43.5 L 100,43.5 Z"
          fill="url(#rightRockGrad)"
        />

        {/* Rock Structural Facets / Ridges for rich tactile depth */}
        <path
          d="M 100,0 L 72,14 L 100,26 Z"
          fill="url(#rightRockFacet)"
        />
        <path
          d="M 72,14 L 54,1 L 62,18 L 72,14 Z"
          fill="#1c2738"
          fillOpacity="0.75"
        />
        <path
          d="M 100,26 L 78,22 L 86,43.5 L 100,43.5 Z"
          fill="#141c28"
          fillOpacity="0.55"
        />
        <path
          d="M 78,22 L 62,18 L 52,22 C 55,30 58,37 62,43.5 L 78,34 Z"
          fill="#1f2c3d"
          fillOpacity="0.65"
        />

        {/* 2. Concrete Arch Portal Collar */}
        {/* Outer Arch */}
        <path
          d="M 88,43.5 L 88,23 C 88,12 79,5 67,5 C 55,5 46,12 46,23 L 46,43.5 L 52,43.5 L 52,24 C 52,16 59,11 67,11 C 75,11 82,16 82,24 L 82,43.5 Z"
          fill="url(#rightArchCollarGrad)"
        />
        {/* Inner Arch Void (Cavern Mouth) */}
        <path
          d="M 82,43.5 L 82,24 C 82,16 75,11 67,11 C 59,11 52,16 52,24 L 52,43.5 Z"
          fill="url(#rightTunnelVoid)"
        />

        {/* Inner Portal Depth Ring */}
        <path
          d="M 80,43.5 L 80,25 C 80,18 74,14 67,14 C 60,14 54,18 54,25 L 54,43.5"
          stroke="#0f172a"
          strokeWidth="1.5"
          fill="none"
        />

        {/* 3. Emerging High-Speed Bullet Train (Heading towards Left) */}
        {/* Train Undercarriage Shadow & Skirt */}
        <rect x="24" y="41" width="54" height="2.5" rx="1" fill="#0b0f19" />
        <line x1="26" y1="42.5" x2="76" y2="42.5" stroke="#334155" strokeWidth="0.8" />

        {/* Aerodynamic Train Body */}
        <path
          d="M 78,26 L 54,26 C 46,26 38,28 31,32 C 27,34.5 24,37.5 22.5,39.5 C 21.8,40.5 22.2,42 24,42 L 78,42 Z"
          fill="url(#rightTrainShellGrad)"
        />

        {/* Cyberpunk Livery Accent Line (Cyan Edge Trim) */}
        <path
          d="M 78,39.5 L 32,39.5 C 28,39.5 25,40.5 23.5,41.2"
          stroke="#00f0ff"
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* Passenger Cabin Windows Stripe */}
        <rect x="70" y="29" width="6" height="3.5" rx="0.8" fill="#1e293b" />
        <rect x="62" y="29" width="6" height="3.5" rx="0.8" fill="#1e293b" />
        <rect x="54" y="29" width="6" height="3.5" rx="0.8" fill="#1e293b" />

        {/* Aerodynamic Cockpit Windshield */}
        <path
          d="M 50,28 L 38,31 C 35,32 33,34 32,36 L 44,36 C 47,36 49,34 50,32 Z"
          fill="url(#rightWindshieldGrad)"
        />
        {/* Specular White Glint on Cockpit Glass */}
        <path
          d="M 48,29.5 L 39,32"
          stroke="#38bdf8"
          strokeWidth="0.8"
          strokeLinecap="round"
        />

        {/* Sleek Nose Headlight Lamp */}
        <circle cx="26" cy="38" r="4.5" fill="url(#rightHeadlightGlow)" />
        <circle cx="26" cy="38" r="1.6" fill="#ffffff" />
        <circle cx="26" cy="38" r="1.1" fill="#fef08a" />
      </g>
    </svg>
  );
}

export function CenterTunnelSvg({ className = '', style = {}, isGenerating = false }) {
  return (
    <svg
      viewBox="0 0 110 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        overflow: 'visible',
        ...style
      }}
    >
      <defs>
        {/* Mountain Rock Strata Gradient */}
        <linearGradient id="centerRockGrad" x1="55" y1="2" x2="55" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2c3c52" />
          <stop offset="50%" stopColor="#1e2a3a" />
          <stop offset="100%" stopColor="#101824" />
        </linearGradient>

        {/* Symmetrical Arch Collar Metallic Gradients */}
        <linearGradient id="centerArchCollar" x1="0" y1="8" x2="0" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#cbd5e1" />
          <stop offset="50%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>

        {/* Cavern Deep Interior Void */}
        <linearGradient id="centerTunnelVoid" x1="0" y1="14" x2="0" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#030712" />
          <stop offset="100%" stopColor="#080e1a" />
        </linearGradient>

        {/* Pulsing Core Active Reactor Glow */}
        <radialGradient id="generatorAura" cx="55" cy="24" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00f0ff" stopOpacity={isGenerating ? "0.6" : "0.15"} />
          <stop offset="60%" stopColor="#00f0ff" stopOpacity={isGenerating ? "0.2" : "0.03"} />
          <stop offset="100%" stopColor="#00f0ff" stopOpacity="0" />
        </radialGradient>

        {/* Crisp Shadow */}
        <filter id="centerDropShadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.6" />
        </filter>
      </defs>

      <g filter="url(#centerDropShadow)">
        {/* Generator Ambient Aura Glow */}
        <circle cx="55" cy="24" r="30" fill="url(#generatorAura)" />

        {/* 1. Symmetrical Mountain Rock Massif Body */}
        <path
          d="M 6,43.5 
             C 10,28 18,14 30,7 
             C 42,2 68,2 80,7 
             C 92,14 100,28 104,43.5 
             L 94,43.5 
             C 91,24 82,14 73,14 
             C 64,14 58,22 55,30 
             C 52,22 46,14 37,14 
             C 28,14 19,24 16,43.5 
             Z"
          fill="url(#centerRockGrad)"
        />

        {/* Mountain Ridge Layers / Clean Geometric Strata */}
        {/* Central Crown Facet */}
        <path
          d="M 30,7 L 55,2 L 80,7 L 68,14 L 42,14 Z"
          fill="#3b4d66"
          fillOpacity="0.75"
        />
        <path
          d="M 42,14 L 55,2 L 55,28 L 52,22 Z"
          fill="#475b75"
          fillOpacity="0.45"
        />
        <path
          d="M 55,2 L 68,14 L 58,22 L 55,28 Z"
          fill="#1c2738"
          fillOpacity="0.65"
        />

        {/* Left Mountain Wing Facets */}
        <path
          d="M 6,43.5 C 10,28 18,14 30,7 L 36,15 C 26,20 18,30 16,43.5 Z"
          fill="#334359"
          fillOpacity="0.6"
        />
        {/* Right Mountain Wing Facets */}
        <path
          d="M 104,43.5 C 100,28 92,14 80,7 L 74,15 C 84,20 92,30 94,43.5 Z"
          fill="#172230"
          fillOpacity="0.7"
        />

        {/* 2. Left Arch Portal (Allows continuous rail straight through) */}
        {/* Outer Collar */}
        <path
          d="M 16,43.5 L 16,28 C 16,18 24,12 35,12 C 46,12 53,18 53,28 L 53,43.5 L 48,43.5 L 48,29 C 48,21 42,16 35,16 C 28,16 21,21 21,29 L 21,43.5 Z"
          fill="url(#centerArchCollar)"
        />
        {/* Cavern Void */}
        <path
          d="M 21,43.5 L 21,29 C 21,21 28,16 35,16 C 42,16 48,21 48,29 L 48,43.5 Z"
          fill="url(#centerTunnelVoid)"
        />

        {/* 3. Right Arch Portal (Allows continuous rail straight through) */}
        {/* Outer Collar */}
        <path
          d="M 57,43.5 L 57,28 C 57,18 64,12 75,12 C 86,12 94,18 94,28 L 94,43.5 L 89,43.5 L 89,29 C 89,21 83,16 75,16 C 67,16 62,21 62,29 L 62,43.5 Z"
          fill="url(#centerArchCollar)"
        />
        {/* Cavern Void */}
        <path
          d="M 62,43.5 L 62,29 C 62,21 67,16 75,16 C 83,16 89,21 89,29 L 89,43.5 Z"
          fill="url(#centerTunnelVoid)"
        />

        {/* Center Rock Pillar Dividers */}
        <path
          d="M 48,43.5 L 53,43.5 L 57,43.5 L 62,43.5 L 58,26 L 55,22 L 52,26 Z"
          fill="#1a2535"
        />
        <line x1="55" y1="22" x2="55" y2="43.5" stroke="#334155" strokeWidth="0.8" />

        {/* Cyan Cybernetic Beacon over Center Apex */}
        <circle cx="55" cy="6" r="1.8" fill={isGenerating ? "#00f0ff" : "#38bdf8"} />
        <circle cx="55" cy="6" r="0.9" fill="#ffffff" />
      </g>
    </svg>
  );
}
