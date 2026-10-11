"use client";
import React, {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

/* ───────────────────────── constants ───────────────────────── */
const W = 1200;
const H = 720;
const LANE_TOP = 252;
const LANE_H = 72;
const MAX_LANES = 6;
const COACHES = 4;
const COACH_W = 92;
const NOSE_W = 70;
const TRAIN_LEN = NOSE_W + COACHES * COACH_W;
const STOP_X = 150;
const FAIL_X = 500;
const SPAWN_X = 1110;
const PORTAL_L = 1008;
const PORTAL_R = 1092;
const SIGNAL_X = 985;
const DWELL = 2.5;
const MAX_CROWD = 48;
const FAIL_RETREAT_MS = 25000;

const VIEWS = {
  overview: [0, 0, W, H],
  tower: [640, 90, 560, 336],
  platform1: [0, 190, 640, 384],
  concourse: [0, 20, 640, 384],
};

const STATUS_MAP = {
  queued: "queued", pending: "queued", waiting: "queued", initializing: "queued", building: "queued",
  running: "running", deploying: "running", active: "running", in_progress: "running",
  success: "success", succeeded: "success", deployed: "success", completed: "success", ready: "success",
  failed: "failed", crashed: "failed", error: "failed", errored: "failed",
};
const PHASE_LABEL = {
  idle: "CLEAR", queued: "EXPECTED", arriving: "ARRIVING", boarding: "ON PLATFORM",
  departing: "DEPARTED", failed: "HALTED", retreating: "HALTED",
};
const SIGNAL_OF = {
  idle: "green", queued: "red", arriving: "green", boarding: "yellow",
  departing: "green", failed: "red", retreating: "red",
};
const VISIBLE = new Set(["arriving", "boarding", "departing", "failed", "retreating"]);
const SHIRTS = ["#e76f51", "#2a9d8f", "#e9c46a", "#457b9d", "#9b5de5", "#f28482", "#6a994e", "#ff9f1c"];
const SKINS = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524"];
const BOXES = ["#e76f51", "#2a9d8f", "#e9c46a", "#457b9d"];
const HOLE_CLOSED = `M${PORTAL_L},64 L${PORTAL_L},32 Q${PORTAL_L},4 1050,4 Q${PORTAL_R},4 ${PORTAL_R},32 L${PORTAL_R},64 Z`;
const HOLE_OPEN = `M${PORTAL_L},64 L${PORTAL_L},32 Q${PORTAL_L},4 1050,4 Q${PORTAL_R},4 ${PORTAL_R},32 L${PORTAL_R},64`;

const CSS = `
@keyframes st2d-drift{from{transform:translateX(-300px)}to{transform:translateX(1500px)}}
@keyframes st2d-rain{from{transform:translateY(0)}to{transform:translateY(140px)}}
@keyframes st2d-flash{0%,91%,100%{opacity:0}92%{opacity:.7}93%{opacity:0}94.5%{opacity:.45}96%{opacity:0}}
@keyframes st2d-blink{0%,49%{opacity:1}50%,100%{opacity:.15}}
@keyframes st2d-wave{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(24deg)}}
@keyframes st2d-trolley{0%,100%{transform:translateX(0)}50%{transform:translateX(96px)}}
@keyframes st2d-lift{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
.st2d-cloud{animation-name:st2d-drift;animation-timing-function:linear;animation-iteration-count:infinite}
.st2d-rain{animation:st2d-rain .7s linear infinite}
.st2d-flash{animation:st2d-flash 7s linear infinite}
.st2d-blink{animation:st2d-blink .8s steps(1) infinite}
.st2d-wave{transform-box:fill-box;transform-origin:0% 100%;animation:st2d-wave .5s ease-in-out infinite}
.st2d-trolley{animation:st2d-trolley 9s ease-in-out infinite}
.st2d-lift{animation:st2d-lift 4.5s ease-in-out infinite}
`;

/* ───────────────────────── helpers ───────────────────────── */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const laneY = (i) => LANE_TOP + i * LANE_H;
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => {
  const A = hex2rgb(a);
  const B = hex2rgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};
const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const normStatus = (s) => STATUS_MAP[String(s || "").toLowerCase().replace(/[\s-]/g, "_")] || "queued";
const viewKey = (v) => {
  const k = String(v || "").toLowerCase();
  if (k.includes("tower")) return "tower";
  if (k.includes("platform")) return "platform1";
  if (k.includes("concourse")) return "concourse";
  return "overview";
};
const daylightAt = (date, lock) => {
  if (lock === "day") return 1;
  if (lock === "night") return 0;
  const h = date.getHours() + date.getMinutes() / 60;
  return clamp(Math.sin(((h - 6) / 12) * Math.PI) * 1.6 + 0.15, 0, 1);
};
const makeLane = () => ({
  phase: "idle", x: SPAWN_X, v: 0, stopX: STOP_X, t: 0, dep: null, status: null,
  wantDepart: false, since: Date.now(), shuntT: 0,
});
const buildPersons = (count, laneCount) => {
  const out = [];
  for (let i = 0; i < count; i++) {
    const role = i % 11 === 0 ? "vendor" : i % 7 === 0 ? "coolie" : "passenger";
    out.push({
      id: i, lane: i % laneCount, role,
      color: role === "coolie" ? "#c1121f" : role === "vendor" ? "#f59e0b" : SHIRTS[(i * 5) % SHIRTS.length],
      skin: SKINS[i % SKINS.length], bag: role === "passenger" && i % 3 === 0,
      x: 40 + ((i * 131) % 880), dir: i % 2 ? 1 : -1, speed: 8 + ((i * 7) % 14),
      state: "wander", door: 0, alpha: 1, fadeIn: false, phase: i * 0.7, el: null,
    });
  }
  return out;
};

/* ───────────────────────── small art pieces ───────────────────────── */
function PersonArt({ p }) {
  return (
    <>
      <rect x="-3.4" y="-9" width="2.8" height="9" rx="1" fill="#2b3340" />
      <rect x="0.6" y="-9" width="2.8" height="9" rx="1" fill="#2b3340" />
      <rect x="-4.6" y="-21" width="9.2" height="13" rx="3.2" fill={p.color} />
      <circle cx="0" cy="-25" r="4.2" fill={p.skin} />
      {p.role === "coolie" && (
        <>
          <rect x="-7" y="-35" width="14" height="8" rx="1.5" fill="#a4631f" />
          <rect x="-7" y="-32" width="14" height="1.6" fill="#7a4513" />
        </>
      )}
      {p.role === "vendor" && (
        <>
          <rect x="5" y="-14" width="17" height="8" rx="1.5" fill="#f4a261" />
          <rect x="5" y="-17" width="17" height="3" fill="#e76f51" />
          <circle cx="9" cy="-3" r="2.6" fill="#1f2937" />
          <circle cx="18" cy="-3" r="2.6" fill="#1f2937" />
        </>
      )}
      {p.bag && <rect x="5" y="-7" width="7" height="7" rx="1.2" fill="#8b5e34" />}
    </>
  );
}

function TrainArt({ accent, name, body, band, glass, dark }) {
  const label = String(name || "").slice(0, 24);
  return (
    <g>
      <path d="M70,-46 L30,-46 C12,-46 0,-31 0,-18 C0,-9 5,-4 15,-4 L70,-4 Z" fill={body} />
      <path d="M60,-42 L33,-42 C21,-42 12,-32 10,-23 L60,-23 Z" fill={glass} />
      <path d="M1,-12 L70,-12 L70,-4 L15,-4 C8,-4 2,-7 1,-12 Z" fill={band} />
      <ellipse cx="5" cy="-15" rx="3" ry="4" fill="#ffd166" />
      {Array.from({ length: COACHES }, (_, i) => {
        const x0 = NOSE_W + i * COACH_W;
        return (
          <g key={i}>
            <rect x={x0} y="-46" width={COACH_W - 2} height="42" rx="4" fill={body} />
            <rect x={x0} y="-12" width={COACH_W - 2} height="8" fill={band} />
            <rect x={x0} y="-27" width={COACH_W - 2} height="3" fill={accent} />
            <rect x={x0 + 8} y="-41" width="20" height="13" rx="3" fill={glass} />
            <rect x={x0 + 34} y="-41" width="20" height="13" rx="3" fill={glass} />
            <rect x={x0 + 62} y="-43" width="20" height="38" rx="3" fill="none" stroke={band} strokeWidth="1.6" />
            <rect x={x0 + 67} y="-39" width="10" height="12" rx="2" fill={glass} />
            <circle cx={x0 + 16} cy="-4" r="4" fill={dark} />
            <circle cx={x0 + 30} cy="-4" r="4" fill={dark} />
            <circle cx={x0 + 62} cy="-4" r="4" fill={dark} />
            <circle cx={x0 + 76} cy="-4" r="4" fill={dark} />
          </g>
        );
      })}
      <text x={NOSE_W + 6} y="-5.4" fontSize="6.6" fontWeight="700" fill="#ffffff" fontFamily="ui-monospace,monospace">
        {label}
      </text>
    </g>
  );
}

/* ───────────────────────── main component ───────────────────────── */
const StationScene2D = forwardRef(function StationScene2D(props, ref) {
  const {
    lanes: lanesProp = 3,
    accounts = [],
    deployments,
    health = 100,
    latencyMs = 40,
    issues = 0,
    tickets = 0,
    crowd = 24,
    view = "overview",
    timeLock = "auto",
    showControls = true,
    stationName = "iq4u8 CENTRAL JUNCTION",
    onEvent,
    className,
    style,
  } = props;

  const uid = "st" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const laneCount = clamp(Math.round(Number(lanesProp)) || 1, 1, MAX_LANES);
  const crowdCount = clamp(Math.round(Number(crowd)) || 0, 0, MAX_CROWD);
  const usingMock = deployments === undefined;

  const rootRef = useRef(null);
  const svgRef = useRef(null);
  const lanesRef = useRef(Array.from({ length: MAX_LANES }, makeLane));
  const trainEls = useRef([]);
  const beamEls = useRef([]);
  const tteEl = useRef(null);
  const tteRef = useRef({ lane: 0, x: 320, dir: 1, tasks: [], scanLane: -1, auditing: false });
  const depLane = useRef(new Map());
  const doneIds = useRef(new Set());
  const pending = useRef(new Map());
  const vbRef = useRef({ cur: [...VIEWS.overview], target: [...VIEWS.overview] });
  const visibleRef = useRef(true);
  const audioRef = useRef(null);
  const soundRef = useRef(false);

  const latencyRef = useRef(latencyMs);
  latencyRef.current = latencyMs;
  const laneCountRef = useRef(laneCount);
  laneCountRef.current = laneCount;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const [soundOn, setSoundOn] = useState(false);
  const [wave, setWave] = useState(false);
  const [snap, setSnap] = useState([]);
  const [selected, setSelected] = useState(-1);
  const [now, setNow] = useState(() => new Date());
  const [mockDeps, setMockDeps] = useState([]);

  const persons = useMemo(() => buildPersons(crowdCount, laneCount), [crowdCount, laneCount]);
  const personsRef = useRef(persons);
  personsRef.current = persons;

  const depsEffective = usingMock ? mockDeps : deployments;
  const depsRef = useRef(depsEffective);
  depsRef.current = depsEffective;

  /* ── events, audio ── */
  const emit = (type, payload) => {
    try {
      if (onEventRef.current) onEventRef.current(type, payload);
    } catch (e) {
      console.error("[StationScene2D] onEvent handler failed", e);
    }
  };

  const horn = () => {
    if (!soundRef.current) return;
    try {
      const ctx = audioRef.current;
      if (!ctx) return;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      g.connect(ctx.destination);
      [311, 392].forEach((f) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.connect(g);
        o.start(t);
        o.stop(t + 1.15);
      });
    } catch (e) {
      console.error("[StationScene2D] horn failed", e);
    }
  };

  const toggleSound = () => {
    try {
      if (!audioRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioRef.current = new AC();
      }
      if (audioRef.current.state === "suspended") audioRef.current.resume();
    } catch (e) {
      console.error("[StationScene2D] audio init failed", e);
      return;
    }
    const next = !soundRef.current;
    soundRef.current = next;
    setSoundOn(next);
    if (next) horn();
  };

  const triggerWave = () => {
    setWave(true);
    setTimeout(() => setWave(false), 3000);
  };

  /* ── lane logic ── */
  const clearLane = (L) => {
    if (L.dep) {
      doneIds.current.add(L.dep.id);
      depLane.current.delete(L.dep.id);
    }
    L.dep = null; L.status = null; L.phase = "idle"; L.x = SPAWN_X; L.v = 0;
    L.t = 0; L.stopX = STOP_X; L.wantDepart = false; L.shuntT = 0;
  };

  const spawnTrain = (L, stopX) => {
    L.phase = "arriving"; L.x = SPAWN_X; L.v = 0; L.stopX = stopX; L.t = 0;
    L.wantDepart = false; L.since = Date.now();
    horn();
  };

  const onBoard = (li) => {
    const L = lanesRef.current[li];
    personsRef.current.forEach((p) => {
      if (p.lane !== li) return;
      if (p.state === "inside") {
        p.state = "wander";
        p.door = Math.floor(Math.random() * COACHES);
        p.x = L.x + NOSE_W + p.door * COACH_W + 69;
        p.dir = -1;
        p.alpha = 0;
        p.fadeIn = true;
      } else if (p.state === "wander" && Math.random() < 0.5) {
        p.state = "toDoor";
        p.door = Math.floor(Math.random() * COACHES);
      }
    });
    emit("arrived", { lane: li, deployment: L.dep });
  };

  const applyStatus = (L, li, status) => {
    if (status === "queued") {
      if (L.phase === "idle") { L.phase = "queued"; L.since = Date.now(); }
      return;
    }
    if (status === "running") {
      L.wantDepart = false;
      if (L.phase === "idle" || L.phase === "queued") spawnTrain(L, STOP_X);
      else if (L.phase === "failed" || L.phase === "retreating") {
        L.stopX = STOP_X; L.phase = "arriving"; L.since = Date.now();
      }
      return;
    }
    if (status === "success") {
      if (L.phase === "idle" || L.phase === "queued") { clearLane(L); return; }
      if (L.phase === "failed" || L.phase === "retreating") { L.phase = "arriving"; L.since = Date.now(); }
      if (L.phase === "arriving") L.stopX = STOP_X;
      L.wantDepart = true;
      return;
    }
    if (status === "failed") {
      L.wantDepart = false;
      if (L.phase === "idle" || L.phase === "queued") spawnTrain(L, FAIL_X);
      else if (L.phase === "arriving") {
        if (L.x <= FAIL_X) {
          L.phase = "failed"; L.v = 0; L.since = Date.now();
          emit("failed", { lane: li, deployment: L.dep });
        } else L.stopX = FAIL_X;
      } else if (L.phase === "boarding") {
        L.phase = "failed"; L.since = Date.now();
        emit("failed", { lane: li, deployment: L.dep });
      }
      return;
    }
    if (status === "removed") {
      if (L.phase === "idle" || L.phase === "queued") clearLane(L);
      else if (L.phase === "failed") { L.phase = "retreating"; L.v = 0; }
      else if (L.phase === "arriving" && L.stopX === FAIL_X) { L.phase = "retreating"; L.v = 0; }
      else if (L.phase === "arriving" || L.phase === "boarding") L.wantDepart = true;
    }
  };

  const pickLane = (d) => {
    const ls = lanesRef.current;
    const pref = Number.isInteger(d.accountIndex)
      ? ((d.accountIndex % laneCount) + laneCount) % laneCount
      : hashStr(String(d.id)) % laneCount;
    for (let k = 0; k < laneCount; k++) {
      const i = (pref + k) % laneCount;
      if (ls[i].phase === "idle" && !ls[i].dep) return i;
    }
    return -1;
  };

  const reconcile = (list) => {
    const ls = lanesRef.current;
    const seen = new Set();
    const src = Array.isArray(list) ? list : [];
    for (const raw of src) {
      if (!raw || raw.id === undefined || raw.id === null) continue;
      const d = {
        id: String(raw.id),
        name: String(raw.name || raw.id),
        status: normStatus(raw.status),
        accountIndex: raw.accountIndex,
      };
      seen.add(d.id);
      if (doneIds.current.has(d.id)) continue;
      let li = depLane.current.get(d.id);
      if (li === undefined) {
        li = pickLane(d);
        if (li < 0) { pending.current.set(d.id, d); continue; }
        pending.current.delete(d.id);
        depLane.current.set(d.id, li);
        ls[li].dep = d;
        ls[li].status = null;
      }
      const L = ls[li];
      L.dep = d;
      if (L.status !== d.status) {
        L.status = d.status;
        applyStatus(L, li, d.status);
      }
    }
    for (const [id, li] of Array.from(depLane.current.entries())) {
      if (!seen.has(id)) {
        depLane.current.delete(id);
        const L = ls[li];
        if (L && L.dep && L.dep.id === id) applyStatus(L, li, "removed");
      }
    }
    for (const id of Array.from(pending.current.keys())) if (!seen.has(id)) pending.current.delete(id);
    for (const id of Array.from(doneIds.current)) if (!seen.has(id)) doneIds.current.delete(id);
  };

  /* ── imperative API for the existing HUD buttons ── */
  useImperativeHandle(ref, () => ({
    dispatch() {
      let n = 0;
      lanesRef.current.slice(0, laneCountRef.current).forEach((L) => {
        if (L.phase === "boarding") { L.wantDepart = true; L.t = Math.max(L.t, DWELL); n++; }
        else if (L.phase === "arriving" && L.stopX === STOP_X) { L.wantDepart = true; n++; }
      });
      triggerWave();
      emit("dispatch", { trains: n });
      return n;
    },
    auditTickets() {
      const T = tteRef.current;
      T.tasks = Array.from({ length: laneCountRef.current }, (_, i) => i);
      T.auditing = true;
      emit("audit-start", {});
    },
    inspect(lane) {
      const i = clamp(Math.round(Number(lane)) || 0, 0, laneCountRef.current - 1);
      tteRef.current.tasks = [i];
      emit("inspect", { lane: i });
    },
    shunt(lane) {
      const L = lanesRef.current[clamp(Math.round(Number(lane)) || 0, 0, laneCountRef.current - 1)];
      if (L && (L.phase === "boarding" || L.phase === "failed")) {
        L.shuntT = 2.4;
        horn();
        return true;
      }
      return false;
    },
    resetView() {
      vbRef.current.target = [...VIEWS.overview];
    },
  }));

  /* ── effects ── */
  useEffect(() => {
    reconcile(depsEffective);
  }, [depsEffective, laneCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => {
      if (pending.current.size) reconcile(depsRef.current);
      const next = lanesRef.current.slice(0, laneCountRef.current).map((L) => ({
        phase: L.phase,
        name: L.dep ? L.dep.name : "",
        status: L.status || "",
        accent: L.dep ? `hsl(${hashStr(L.dep.name) % 360} 70% 52%)` : "#e9c46a",
        since: L.since,
      }));
      setSnap((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, 250);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    vbRef.current.target = [...VIEWS[viewKey(view)]];
  }, [view]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      visibleRef.current = entries.some((e) => e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!usingMock) return undefined;
    const names = ["api-gateway", "auth-service", "billing-worker", "web-frontend", "queue-consumer", "cron-runner", "search-indexer", "media-resizer"];
    const timers = new Set();
    let n = 0;
    let active = 0;
    const later = (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
    };
    const patch = (id, status) => setMockDeps((d) => d.map((x) => (x.id === id ? { ...x, status } : x)));
    const drop = (id) => setMockDeps((d) => d.filter((x) => x.id !== id));
    const spawn = () => {
      if (active >= laneCount + 1) return;
      n += 1;
      active += 1;
      const id = `mock-${n}`;
      const name = `${names[n % names.length]}-${100 + n}`;
      const ok = Math.random() > 0.18;
      setMockDeps((d) => [...d, { id, name, status: "queued" }]);
      later(() => patch(id, "running"), 1500);
      later(() => patch(id, ok ? "success" : "failed"), 9000);
      later(() => { drop(id); active -= 1; }, ok ? 16000 : 20000);
    };
    spawn();
    const iv = setInterval(spawn, 5500);
    return () => {
      clearInterval(iv);
      timers.forEach(clearTimeout);
    };
  }, [usingMock, laneCount]);

  /* ── animation loop (direct DOM writes, no React re-render per frame) ── */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const step = (dt, time) => {
      const ls = lanesRef.current;
      const count = laneCountRef.current;
      const speed = clamp(560 - latencyRef.current * 1.6, 150, 560);
      const tte = tteRef.current;

      for (let i = 0; i < count; i++) {
        const L = ls[i];
        if (L.phase === "arriving") {
          const dist = L.x - L.stopX;
          L.v = Math.max(28, Math.min(speed, dist * 1.8));
          L.x -= L.v * dt;
          if (L.x <= L.stopX + 0.4) {
            L.x = L.stopX; L.v = 0; L.t = 0; L.since = Date.now();
            if (L.stopX === STOP_X) { L.phase = "boarding"; onBoard(i); }
            else { L.phase = "failed"; emit("failed", { lane: i, deployment: L.dep }); }
          }
        } else if (L.phase === "boarding") {
          L.t += dt;
          if (L.wantDepart && L.t >= DWELL) {
            L.phase = "departing"; L.v = 20; L.since = Date.now();
            horn();
            emit("departed", { lane: i, deployment: L.dep });
          }
        } else if (L.phase === "departing") {
          L.v = Math.min(speed * 1.15, L.v + 190 * dt);
          L.x -= L.v * dt;
          if (L.x < -TRAIN_LEN - 60) clearLane(L);
        } else if (L.phase === "retreating") {
          L.v = Math.min(speed * 0.6, L.v + 120 * dt);
          L.x += L.v * dt;
          if (L.x >= SPAWN_X) clearLane(L);
        } else if (L.phase === "failed" && Date.now() - L.since > FAIL_RETREAT_MS) {
          L.phase = "retreating"; L.v = 0;
        }

        const el = trainEls.current[i];
        if (el) {
          if (VISIBLE.has(L.phase)) {
            let off = 0;
            if (L.shuntT > 0) {
              L.shuntT = Math.max(0, L.shuntT - dt);
              off = Math.sin((1 - L.shuntT / 2.4) * Math.PI) * 110;
            }
            const bob = L.v > 1 ? Math.sin(time * 38) * 0.35 : 0;
            el.setAttribute("transform", `translate(${(L.x + off).toFixed(1)},${(54 + bob).toFixed(2)})`);
            el.setAttribute("visibility", "visible");
          } else {
            el.setAttribute("visibility", "hidden");
          }
        }
        const be = beamEls.current[i];
        if (be) be.setAttribute("opacity", tte.scanLane === i ? (0.3 + 0.15 * Math.sin(time * 12)).toFixed(2) : "0");
      }

      /* people */
      for (const p of personsRef.current) {
        const L = ls[p.lane];
        if (!L || !p.el) continue;
        if (p.state === "inside") {
          p.alpha = Math.max(0, p.alpha - dt * 4);
          if (L.phase === "idle" || L.phase === "queued") {
            p.state = "wander"; p.x = 24; p.dir = 1; p.alpha = 0; p.fadeIn = true;
          }
        } else if (p.state === "toDoor") {
          if (L.phase !== "boarding") p.state = "wander";
          else {
            const dx = L.x + NOSE_W + p.door * COACH_W + 69 - p.x;
            if (Math.abs(dx) < 3) p.state = "inside";
            else {
              p.dir = Math.sign(dx) || 1;
              p.x += p.dir * Math.min(46, Math.abs(dx) * 6 + 14) * dt;
            }
          }
        } else {
          p.x += p.dir * p.speed * dt;
          if (p.x < 24) { p.x = 24; p.dir = 1; }
          if (p.x > 940) { p.x = 940; p.dir = -1; }
          if (Math.random() < 0.004) p.dir *= -1;
        }
        if (p.fadeIn) {
          p.alpha = Math.min(1, p.alpha + dt * 3);
          if (p.alpha >= 1) p.fadeIn = false;
        }
        const bob = p.state === "inside" ? 0 : Math.abs(Math.sin(time * 6 + p.phase)) * 1.2;
        p.el.setAttribute("transform", `translate(${p.x.toFixed(1)},${(laneY(p.lane) + 70 - bob).toFixed(2)}) scale(${p.dir},1)`);
        p.el.setAttribute("opacity", p.alpha.toFixed(2));
      }

      /* TTE */
      if (tte.lane >= count) tte.lane = 0;
      if (tte.tasks.length) {
        const target = tte.tasks[0] < count ? tte.tasks[0] : 0;
        if (tte.lane !== target) {
          tte.dir = -1;
          tte.x -= 110 * dt;
          if (tte.x <= 24) { tte.x = 24; tte.lane = target; tte.dir = 1; }
        } else {
          const L = ls[target];
          const has = VISIBLE.has(L.phase);
          const startX = has ? L.x + 10 : 300;
          const endX = has ? L.x + TRAIN_LEN - 14 : 640;
          if (tte.x < startX - 2) {
            tte.dir = 1;
            tte.x = Math.min(startX, tte.x + 112 * dt);
            tte.scanLane = -1;
          } else if (tte.x >= endX) {
            tte.tasks.shift();
            tte.scanLane = -1;
          } else {
            tte.dir = 1;
            tte.x += 44 * dt;
            tte.scanLane = has ? target : -1;
          }
        }
      } else {
        tte.scanLane = -1;
        if (tte.auditing) { tte.auditing = false; emit("audit-complete", {}); }
        tte.x += tte.dir * 30 * dt;
        if (tte.x < 40) { tte.x = 40; tte.dir = 1; }
        if (tte.x > 900) { tte.x = 900; tte.dir = -1; }
      }
      if (tteEl.current) {
        tteEl.current.setAttribute("transform", `translate(${tte.x.toFixed(1)},${(laneY(tte.lane) + 70 - Math.abs(Math.sin(time * 6)) * 1.2).toFixed(2)}) scale(${tte.dir},1)`);
      }

      /* camera tween */
      const vb = vbRef.current;
      let moved = false;
      for (let k = 0; k < 4; k++) {
        const dv = vb.target[k] - vb.cur[k];
        if (Math.abs(dv) > 0.05) { vb.cur[k] += dv * (1 - Math.exp(-dt * 6)); moved = true; }
        else vb.cur[k] = vb.target[k];
      }
      if (moved && svgRef.current) svgRef.current.setAttribute("viewBox", vb.cur.map((v) => v.toFixed(2)).join(" "));
    };

    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || !visibleRef.current) { last = t; return; }
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      try {
        step(dt, t / 1000);
      } catch (e) {
        console.error("[StationScene2D] step failed", e);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [laneCount]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── palette & derived values ── */
  const minuteKey = Math.floor(now.getTime() / 60000);
  const d = useMemo(() => daylightAt(now, timeLock), [minuteKey, timeLock]); // eslint-disable-line react-hooks/exhaustive-deps
  const night = d < 0.45;
  const pal = useMemo(() => ({
    skyTop: mix("#0b1630", "#78c0e6", d), skyBot: mix("#26355c", "#cfeaf8", d),
    hillFar: mix("#1b3a3a", "#86bf98", d), hillNear: mix("#1a3a30", "#6cae85", d),
    grass: mix("#1d3a33", "#5fa57b", d), grassDark: mix("#17302a", "#4f9068", d),
    ballast: mix("#7a5f26", "#f2b83f", d), sleeper: mix("#8e95a3", "#ece8e0", d),
    rail: mix("#0f1520", "#2c3542", d), platform: mix("#5b6472", "#cfd4da", d),
    rock: mix("#151c2b", "#434e63", d), rockLight: mix("#222c42", "#566279", d),
    hole: mix("#05080f", "#1b2332", d), frame: mix("#aab4c3", "#f4f4f1", d),
    cloud: mix("#3a4668", "#ffffff", d), wall: mix("#4a4254", "#efe2c9", d),
    wallDark: mix("#3b3446", "#d9c7a6", d), roof: mix("#3a2a2e", "#a5453b", d),
    train: mix("#9aa3b2", "#ebebe7", d), band: mix("#2a3344", "#475569", d),
    glass: night ? "#f6d36b" : "#40536b", text: mix("#cbd5e1", "#1f2937", d),
  }), [d, night]);

  const stars = useMemo(() => Array.from({ length: 36 }, (_, k) => ({ x: (k * 173) % W, y: ((k * 61) % 190) + 8, r: (k % 3) * 0.4 + 0.8 })), []);
  const tufts = useMemo(() => Array.from({ length: 50 }, (_, k) => ({ x: (k * 97) % W, y: 250 + ((k * 53) % 460) })), []);
  const clouds = useMemo(() => [
    { y: 46, dur: 130, delay: -30, s: 1 }, { y: 110, dur: 170, delay: -120, s: 0.7 }, { y: 28, dur: 210, delay: -60, s: 1.2 },
  ], []);

  const rainI = health < 85 || issues > 0 ? clamp((100 - health) / 45 + issues * 0.12, 0.15, 1) : 0;
  const hh = now.getHours() % 12;
  const mm = now.getMinutes();
  const ss = now.getSeconds();
  const aH = (hh + mm / 60) * 30;
  const aM = (mm + ss / 60) * 6;
  const aS = ss * 6;
  const queue = clamp(Math.round(Number(tickets)) || 0, 0, 8);
  const freeY = LANE_TOP + laneCount * LANE_H;
  const selSnap = selected >= 0 && selected < laneCount ? snap[selected] : null;
  const selAcc = selected >= 0 ? accounts[selected] : null;
  const selAccName = typeof selAcc === "string" ? selAcc : selAcc && selAcc.name ? selAcc.name : `PF-0${selected + 1}`;

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 420, overflow: "hidden", background: pal.skyTop, ...style }}
    >
      <style>{CSS}</style>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: "block" }}>
        <defs>
          <linearGradient id={`${uid}sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={pal.skyTop} />
            <stop offset="1" stopColor={pal.skyBot} />
          </linearGradient>
          <linearGradient id={`${uid}beam`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#22d3ee" stopOpacity="0.1" />
            <stop offset="0.5" stopColor="#67e8f9" stopOpacity="0.9" />
            <stop offset="1" stopColor="#22d3ee" stopOpacity="0.1" />
          </linearGradient>
          <pattern id={`${uid}sleep`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="skewX(-25)">
            <rect x="3" y="0" width="5" height="14" fill={pal.sleeper} />
          </pattern>
          <pattern id={`${uid}rain`} width="60" height="140" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
            <line x1="10" y1="10" x2="10" y2="34" stroke="#bcd7ee" strokeWidth="1.2" />
            <line x1="40" y1="80" x2="40" y2="106" stroke="#bcd7ee" strokeWidth="1.2" />
          </pattern>
          <clipPath id={`${uid}clip`}>
            <rect x={-2000} y={-100} width={2000 + PORTAL_R} height={1200} />
          </clipPath>
        </defs>

        {/* sky */}
        <rect x="0" y="0" width={W} height={H} fill={`url(#${uid}sky)`} />
        {stars.map((s, k) => <circle key={k} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={(1 - d) * 0.9} />)}
        <circle cx="880" cy="72" r="44" fill="#ffe28a" opacity={d * 0.28} />
        <circle cx="880" cy="72" r="26" fill="#ffd95a" opacity={d} />
        <circle cx="880" cy="72" r="20" fill="#f4f1de" opacity={1 - d} />
        <circle cx="888" cy="66" r="18" fill={pal.skyTop} opacity={1 - d} />
        {clouds.map((c, k) => (
          <g key={k} transform={`translate(0,${c.y}) scale(${c.s})`}>
            <g className="st2d-cloud" style={{ animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} fill={pal.cloud}>
              <ellipse cx="0" cy="0" rx="46" ry="14" />
              <ellipse cx="-16" cy="-10" rx="22" ry="14" />
              <ellipse cx="14" cy="-14" rx="26" ry="17" />
            </g>
          </g>
        ))}

        {/* hills + ground */}
        <path d={`M0,240 L0,175 C140,115 260,185 400,150 C540,115 660,190 820,155 C920,132 1000,160 1200,150 L1200,240 Z`} fill={pal.hillFar} />
        <path d={`M0,240 L0,205 C160,170 300,215 460,195 C640,172 760,218 940,190 C1040,175 1120,200 1200,185 L1200,240 Z`} fill={pal.hillNear} />
        <rect x="0" y="238" width={W} height={H - 238} fill={pal.grass} />
        {tufts.map((t, k) => (
          <path key={k} d={`M${t.x},${t.y} l-2,-5 M${t.x},${t.y} l0,-6 M${t.x},${t.y} l2,-5`} stroke={pal.grassDark} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        ))}

        {/* station building + clock tower */}
        <g>
          <rect x="40" y="122" width="300" height="116" fill={pal.wall} />
          <rect x="30" y="110" width="320" height="16" rx="3" fill={pal.roof} />
          <rect x="78" y="82" width="224" height="30" rx="5" fill="#27406b" />
          <text x="190" y="102" textAnchor="middle" fontSize="14" fontWeight="800" fill="#ffffff" fontFamily="ui-sans-serif,system-ui,sans-serif">{stationName}</text>
          {[58, 98, 244, 284].map((x) => <rect key={x} x={x} y="140" width="28" height="46" rx="14" fill={pal.glass} stroke={pal.wallDark} strokeWidth="2" />)}
          <path d="M150,238 L150,196 Q190,160 230,196 L230,238 Z" fill="#2b3547" />
          <rect x="156" y="150" width="68" height="14" rx="3" fill="#0f172a" />
          <text x="190" y="161" textAnchor="middle" fontSize="9" fontWeight="700" fill="#ffd60a" fontFamily="ui-monospace,monospace">TICKETS</text>
          <rect x="350" y="70" width="56" height="168" fill={pal.wallDark} />
          <path d="M342,72 L378,34 L414,72 Z" fill={pal.roof} />
          <circle cx="378" cy="104" r="21" fill="#ffffff" stroke="#334155" strokeWidth="3" />
          {Array.from({ length: 12 }, (_, k) => (
            <line key={k} x1="0" y1="-17" x2="0" y2="-14" stroke="#334155" strokeWidth="1.4" transform={`translate(378,104) rotate(${k * 30})`} />
          ))}
          <line x1="0" y1="0" x2="0" y2="-10" stroke="#111827" strokeWidth="3" strokeLinecap="round" transform={`translate(378,104) rotate(${aH})`} />
          <line x1="0" y1="0" x2="0" y2="-15" stroke="#111827" strokeWidth="2" strokeLinecap="round" transform={`translate(378,104) rotate(${aM})`} />
          <line x1="0" y1="2" x2="0" y2="-16" stroke="#e11d48" strokeWidth="1" transform={`translate(378,104) rotate(${aS})`} />
          <rect x="360" y="150" width="36" height="22" rx="3" fill={pal.glass} />
        </g>
        {Array.from({ length: queue }, (_, k) => (
          <g key={k} transform={`translate(${136 - k * 13},237) scale(0.85)`}>
            <PersonArt p={{ color: SHIRTS[(k * 3) % SHIRTS.length], skin: SKINS[k % SKINS.length], role: "passenger", bag: k % 2 === 0 }} />
          </g>
        ))}

        {/* announcement board */}
        <g>
          <rect x="440" y="216" width="4" height="22" fill="#475569" />
          <rect x="610" y="216" width="4" height="22" fill="#475569" />
          <rect x="425" y="94" width="205" height="124" rx="6" fill="#0f172a" stroke="#f59e0b" strokeWidth="2" />
          <rect x="425" y="94" width="205" height="22" rx="6" fill="#1e293b" />
          <text x="433" y="109" fontSize="9.5" fontWeight="700" fill="#fbbf24" fontFamily="ui-monospace,monospace">ARRIVALS / DEPARTURES</text>
          <text x="622" y="109" textAnchor="end" fontSize="9.5" fill="#e2e8f0" fontFamily="ui-monospace,monospace">
            {`${String(now.getHours()).padStart(2, "0")}:${String(mm).padStart(2, "0")}`}
          </text>
          {Array.from({ length: Math.min(laneCount, 6) }, (_, i) => {
            const s = snap[i] || { phase: "idle", name: "" };
            const col = s.phase === "failed" || s.phase === "retreating" ? "#ff6b6b" : s.phase === "boarding" ? "#ffd60a" : s.phase === "idle" ? "#7dd3a8" : "#7dd3fc";
            return (
              <text key={i} x="433" y={134 + i * 13} fontSize="8.5" fontFamily="ui-monospace,monospace" fill={col} style={{ whiteSpace: "pre" }}>
                {`PF${i + 1} ${(s.name || "---").slice(0, 13).padEnd(13, " ")} ${PHASE_LABEL[s.phase] || ""}`}
              </text>
            );
          })}
        </g>

        {/* godown + crane + containers */}
        <g>
          <rect x="640" y="168" width="125" height="70" fill={pal.wallDark} />
          <path d="M634,170 L702,140 L772,170 Z" fill={pal.roof} />
          <rect x="676" y="196" width="52" height="42" fill="#8da2b8" />
          {[204, 212, 220, 228].map((y) => <line key={y} x1="676" y1={y} x2="728" y2={y} stroke="#6b7f95" strokeWidth="1.2" />)}
          <text x="702" y="188" textAnchor="middle" fontSize="8" fontWeight="700" fill="#ffffff" fontFamily="ui-monospace,monospace">GODOWN</text>
          {[0, 1].map((k) => <rect key={k} x="770" y={222 - k * 16} width="34" height="16" fill={BOXES[k]} stroke="#00000033" />)}
          <rect x="632" y="112" width="6" height="126" fill="#f4a261" />
          <rect x="812" y="112" width="6" height="126" fill="#f4a261" />
          <rect x="626" y="106" width="198" height="8" fill="#e9a23b" />
          <g transform="translate(650,114)">
            <g className="st2d-trolley">
              <rect x="-7" y="0" width="14" height="6" fill="#2b3340" />
              <g className="st2d-lift">
                <line x1="0" y1="6" x2="0" y2="40" stroke="#2b3340" strokeWidth="1.4" />
                <rect x="-14" y="40" width="28" height="14" fill="#e76f51" stroke="#00000033" />
              </g>
            </g>
          </g>
        </g>

        {/* control cabin */}
        <g>
          <rect x="836" y="150" width="44" height="88" fill={pal.wall} />
          <path d="M830,150 L858,130 L886,150 Z" fill={pal.roof} />
          <rect x="841" y="160" width="34" height="24" rx="3" fill="#0f172a" />
          <text x="858" y="172" textAnchor="middle" fontSize="7" fontWeight="700" fill="#4ade80" fontFamily="ui-monospace,monospace">{`${Math.round(health)}%`}</text>
          <text x="858" y="180" textAnchor="middle" fontSize="6" fill="#7dd3fc" fontFamily="ui-monospace,monospace">{`${Math.round(latencyMs)}ms`}</text>
          <circle cx="848" cy="196" r="3" fill={issues > 0 ? "#ff3b30" : "#30d158"} className={issues > 0 ? "st2d-blink" : undefined} />
          <circle cx="858" cy="196" r="3" fill="#ffd60a" className="st2d-blink" />
          <circle cx="868" cy="196" r="3" fill="#38bdf8" />
          <text x="858" y="226" textAnchor="middle" fontSize="7" fontWeight="700" fill={pal.text} fontFamily="ui-monospace,monospace">CONTROL</text>
        </g>

        {/* vault */}
        <g>
          <rect x="894" y="184" width="72" height="54" rx="3" fill="#566275" />
          <circle cx="930" cy="214" r="15" fill="#3c4657" stroke="#cbd5e1" strokeWidth="2" />
          <line x1="930" y1="204" x2="930" y2="224" stroke="#cbd5e1" strokeWidth="2" />
          <line x1="920" y1="214" x2="940" y2="214" stroke="#cbd5e1" strokeWidth="2" />
          <text x="930" y="196" textAnchor="middle" fontSize="7" fontWeight="700" fill="#ffffff" fontFamily="ui-monospace,monospace">AES-256</text>
          <text x="930" y="180" textAnchor="middle" fontSize="7" fontWeight="700" fill={pal.text} fontFamily="ui-monospace,monospace">VAULT</text>
        </g>

        {/* station master (lane 0 platform) */}
        <g transform={`translate(96,${laneY(0) + 70})`}>
          <rect x="-3.4" y="-9" width="2.8" height="9" rx="1" fill="#1f2937" />
          <rect x="0.6" y="-9" width="2.8" height="9" rx="1" fill="#1f2937" />
          <rect x="-4.8" y="-21" width="9.6" height="13" rx="3.2" fill="#1e3a8a" />
          <rect x="-4.8" y="-15" width="9.6" height="1.6" fill="#facc15" />
          <circle cx="0" cy="-25" r="4.2" fill="#f1c27d" />
          <rect x="-4.6" y="-31" width="9.2" height="3.4" rx="1" fill="#ffffff" />
          <g className={wave ? "st2d-wave" : undefined}>
            <rect x="5" y="-46" width="2" height="30" fill="#6b7280" />
            <path d="M7,-46 L25,-41 L7,-35 Z" fill="#30d158" />
          </g>
        </g>

        {/* mountain / tunnel rock */}
        <path d={`M${PORTAL_L - 4},${H} L${PORTAL_L - 4},262 L1014,226 L1034,200 L1052,176 L1084,150 L1110,160 L1136,126 L1168,134 L1200,112 L1200,${H} Z`} fill={pal.rock} />
        <path d="M1060,200 L1070,230 L1056,250 M1130,160 L1140,196 L1124,226 M1170,150 L1160,190 L1180,230" stroke={pal.rockLight} strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* lanes */}
        {Array.from({ length: laneCount }, (_, i) => {
          const s = snap[i] || { phase: "idle", name: "", accent: "#e9c46a" };
          const sig = SIGNAL_OF[s.phase] || "green";
          return (
            <g key={i} transform={`translate(0,${laneY(i)})`}>
              <g transform="translate(10,18)">
                <rect width="50" height="15" rx="3" fill="#1e3a8a" />
                <text x="25" y="11" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#ffffff" fontFamily="ui-monospace,monospace">{`PF-0${i + 1}`}</text>
              </g>
              <path d={HOLE_CLOSED} fill={pal.hole} />
              {s.phase === "queued" && (
                <text x="1050" y="40" textAnchor="middle" fontSize="8" fontWeight="700" fill="#ffd60a" fontFamily="ui-monospace,monospace" className="st2d-blink">QUEUED</text>
              )}
              <rect x="0" y="44" width={PORTAL_R} height="20" fill={pal.ballast} />
              <rect x="0" y="46" width={PORTAL_R} height="14" fill={`url(#${uid}sleep)`} />
              <rect x="0" y="50" width={PORTAL_R} height="2.6" fill={pal.rail} />
              <rect x="0" y="57" width={PORTAL_R} height="2.6" fill={pal.rail} />

              <g clipPath={`url(#${uid}clip)`}>
                <g
                  ref={(el) => { trainEls.current[i] = el; }}
                  visibility="hidden"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected(i)}
                >
                  <TrainArt accent={s.accent} name={s.name} body={pal.train} band={pal.band} glass={pal.glass} dark="#1f2937" />
                  <rect
                    ref={(el) => { beamEls.current[i] = el; }}
                    x="0" y="-48" width={TRAIN_LEN} height="46" fill={`url(#${uid}beam)`} opacity="0" pointerEvents="none"
                  />
                  <g display={s.phase === "failed" ? "inline" : "none"} className="st2d-blink">
                    <rect x={TRAIN_LEN / 2 - 46} y="-70" width="92" height="16" rx="4" fill="#dc2626" />
                    <text x={TRAIN_LEN / 2} y="-59" textAnchor="middle" fontSize="9" fontWeight="800" fill="#ffffff" fontFamily="ui-monospace,monospace">DEPLOY FAILED</text>
                  </g>
                </g>
              </g>

              <path d={HOLE_OPEN} fill="none" stroke={pal.frame} strokeWidth="5" strokeLinejoin="round" />

              <rect x="0" y="64" width={PORTAL_L - 2} height="8" fill={pal.platform} />
              <rect x="0" y="64" width={PORTAL_L - 2} height="1.8" fill="#f4c430" />
              {[300, 620, 900].map((x) => (
                <g key={x}>
                  <rect x={x - 1.2} y="40" width="2.4" height="26" fill="#334155" />
                  <circle cx={x} cy="39" r="3.4" fill="#ffe08a" />
                  <circle cx={x} cy="39" r="16" fill="#ffd166" opacity={(1 - d) * 0.3} />
                </g>
              ))}
              {[240, 760].map((x) => (
                <g key={x}>
                  <rect x={x} y="60" width="22" height="3" rx="1" fill="#7c4a21" />
                  <rect x={x + 2} y="63" width="2" height="5" fill="#4b2e12" />
                  <rect x={x + 18} y="63" width="2" height="5" fill="#4b2e12" />
                </g>
              ))}

              <g>
                <rect x={SIGNAL_X - 2} y="22" width="4" height="42" fill="#334155" />
                <rect x={SIGNAL_X - 9} y="2" width="18" height="34" rx="5" fill="#111827" />
                <circle cx={SIGNAL_X} cy="10" r="4.4" fill={sig === "red" ? "#ff3b30" : "#3a4252"} />
                <circle cx={SIGNAL_X} cy="19" r="4.4" fill={sig === "yellow" ? "#ffd60a" : "#3a4252"} />
                <circle cx={SIGNAL_X} cy="28" r="4.4" fill={sig === "green" ? "#30d158" : "#3a4252"} />
              </g>
            </g>
          );
        })}

        {/* foreground trees (only when there is free space) */}
        {Array.from({ length: 6 }, (_, k) => {
          const x = 70 + k * 160 + (k % 2) * 30;
          const y = freeY + 46 + (k % 3) * 18;
          if (y > H - 14) return null;
          return (
            <g key={k} transform={`translate(${x},${y})`}>
              <rect x="-4" y="-26" width="8" height="26" fill="#6b4423" />
              <circle cx="0" cy="-40" r="22" fill={mix("#18402f", "#3f8f5f", d)} />
              <circle cx="-14" cy="-30" r="14" fill={mix("#1c4a36", "#4aa06c", d)} />
              <circle cx="14" cy="-30" r="14" fill={mix("#1c4a36", "#4aa06c", d)} />
            </g>
          );
        })}

        {/* people */}
        <g>
          {persons.map((p) => (
            <g key={p.id} ref={(el) => { p.el = el; }}>
              <PersonArt p={p} />
            </g>
          ))}
        </g>

        {/* TTE */}
        <g ref={tteEl}>
          <rect x="-3.4" y="-9" width="2.8" height="9" rx="1" fill="#111827" />
          <rect x="0.6" y="-9" width="2.8" height="9" rx="1" fill="#111827" />
          <rect x="-4.8" y="-21" width="9.6" height="13" rx="3.2" fill="#1e293b" />
          <path d="M-1.6,-21 L0,-15 L1.6,-21 Z" fill="#ffffff" />
          <circle cx="0" cy="-25" r="4.2" fill="#e0ac69" />
          <rect x="-5" y="-31" width="10" height="4" rx="1.2" fill="#0f172a" />
          <rect x="4" y="-17" width="7" height="9" rx="1" fill="#f8fafc" stroke="#475569" strokeWidth="0.8" />
        </g>

        {/* weather overlays */}
        {rainI > 0 && (
          <>
            <rect x="0" y="0" width={W} height={H} fill="#0b1220" opacity={rainI * 0.28} pointerEvents="none" />
            <g opacity={0.25 + rainI * 0.55} pointerEvents="none">
              <rect className="st2d-rain" x="-200" y="-200" width={W + 400} height={H + 400} fill={`url(#${uid}rain)`} />
            </g>
          </>
        )}
        {health < 50 && <rect className="st2d-flash" x="0" y="0" width={W} height={H} fill="#ffffff" opacity="0" pointerEvents="none" />}
      </svg>

      {showControls && (
        <div style={{ position: "absolute", right: 12, bottom: 56, display: "flex", gap: 8, alignItems: "center", fontFamily: "ui-monospace,monospace", fontSize: 11, zIndex: 5 }}>
          {usingMock && (
            <span style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(245,158,11,.18)", color: "#fbbf24", border: "1px solid rgba(245,158,11,.5)" }}>MOCK DATA</span>
          )}
          <button
            type="button"
            onClick={toggleSound}
            style={{ padding: "4px 10px", borderRadius: 6, cursor: "pointer", background: "rgba(15,23,42,.8)", color: soundOn ? "#4ade80" : "#94a3b8", border: "1px solid rgba(148,163,184,.4)" }}
          >
            {soundOn ? "SOUND ON" : "SOUND OFF"}
          </button>
        </div>
      )}

      {selSnap && (
        <div style={{ position: "absolute", left: 12, bottom: 56, minWidth: 220, padding: "10px 12px", borderRadius: 8, background: "rgba(15,23,42,.88)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,.4)", fontFamily: "ui-monospace,monospace", fontSize: 11, zIndex: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong>{`PF-0${selected + 1} · ${selAccName}`}</strong>
            <button type="button" onClick={() => setSelected(-1)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}>✕</button>
          </div>
          <div>{`Deployment: ${selSnap.name || "—"}`}</div>
          <div>{`Status: ${PHASE_LABEL[selSnap.phase] || "—"}`}</div>
          <div>{`Latency: ${Math.round(latencyMs)} ms`}</div>
          <div>{`Since: ${Math.max(0, Math.round((now.getTime() - selSnap.since) / 1000))}s`}</div>
        </div>
      )}
    </div>
  );
});

export default StationScene2D;
