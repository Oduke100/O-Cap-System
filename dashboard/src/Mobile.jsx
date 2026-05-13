import { useState, useEffect, useRef, useCallback } from "react";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8765";
const WS_RECONNECT_MS = 3000;

const ACTION_COLORS = {
  TAKEN:"#c45a1e",SKIPPED_FULL:"#ff6b35",SKIPPED_ASSET:"#f5c518",
  ORDER_FAILED:"#ff2255",APPROVED:"#c45a1e",REJECTED:"#ff3355",
};
const ACTION_LABELS = {
  TAKEN:"EXEC",SKIPPED_FULL:"FULL",SKIPPED_ASSET:"OCCUP",
  ORDER_FAILED:"ERR",APPROVED:"✓ OK",REJECTED:"✕ REJ",
};

const SYM_PRECISION = {
  EURUSD:5,AUDUSD:5,NZDUSD:5,GBPUSD:5,USDCAD:5,EURGBP:5,USDCHF:5,
  EURJPY:3,USDJPY:3,GBPJPY:3,
  XAUUSD:2,SILVER:2,US500:2,US30:2,NAS100:2,GER40:2,USOIL:2,
  BTCUSD:2,ETHUSD:2,SOLUSD:3,
};
const symPrec = (s) => SYM_PRECISION[s] ?? 5;

const EMPTY_STATE = {
  balance:0,equity:0,floating:0,closed_pnl:0,
  open_count:0,max_concurrent:5,taken:0,skipped:0,
  wins:0,losses:0,total_pnl:0,uptime:"00:00:00",
  open_trades:[],signal_log:[],
};

function useMobileLiveData() {
  const [appState, setAppState] = useState(EMPTY_STATE);
  const [wsStatus, setWsStatus] = useState("CONNECTING");
  const [ticks,    setTicks]    = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);
  const wsRef       = useRef(null);
  const reconnTimer = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState < 2) return;
    setWsStatus("CONNECTING");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen  = () => { setWsStatus("LIVE"); clearTimeout(reconnTimer.current); };
    ws.onclose = () => { setWsStatus("DISCONNECTED"); reconnTimer.current = setTimeout(connect, WS_RECONNECT_MS); };
    ws.onerror = () => ws.close();
    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "STATE") {
          const { type, ...s } = msg;
          setAppState(s);
          setTicks(s.ticks ?? {});
          setLastUpdate(new Date());
        } else if (msg.type === "TICKS") {
          setTicks(prev => { const n={...prev}; msg.data.forEach(t=>{n[t.symbol]=t;}); return n; });
        }
      } catch(e) {}
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); clearTimeout(reconnTimer.current); };
  }, [connect]);

  return { appState, wsStatus, ticks, lastUpdate };
}

function PulsingDot({ color }) {
  return (
    <span style={{
      display:"inline-block", width:7, height:7, borderRadius:"50%",
      background:color, boxShadow:`0 0 6px ${color}`,
      animation:"pulse 2s infinite"
    }}/>
  );
}

function StatCard({ label, value, color="#c8d8e8", sub }) {
  return (
    <div style={{
      background:"#060a0e", border:"1px solid #0d1a24", borderRadius:8,
      padding:"12px 14px", flex:1, minWidth:0
    }}>
      <div style={{color:"#1a3a4a", fontSize:9, letterSpacing:2, marginBottom:4}}>{label}</div>
      <div style={{color, fontSize:20, fontWeight:700, fontVariantNumeric:"tabular-nums", fontFamily:"'JetBrains Mono',monospace", lineHeight:1}}>{value}</div>
      {sub && <div style={{color:"#1a3a4a", fontSize:9, marginTop:4}}>{sub}</div>}
    </div>
  );
}

function SlotBar({ open, max }) {
  return (
    <div style={{display:"flex", gap:4, marginTop:6}}>
      {Array.from({length:max}).map((_,i) => (
        <div key={i} style={{
          flex:1, height:4, borderRadius:2,
          background: i < open ? "linear-gradient(90deg,#8c3a00,#c45a1e)" : "#0a1520",
          boxShadow: i < open ? "0 0 4px #c45a1e55" : undefined,
          transition:"all 0.4s"
        }}/>
      ))}
    </div>
  );
}

export default function MobileTerminal() {
  const { appState, wsStatus, ticks, lastUpdate } = useMobileLiveData();
  const [tab, setTab] = useState("overview");
  const [now, setNow] = useState(new Date());

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);

  const wsConf = {
    LIVE:        { color:"#c45a1e", label:"● LIVE" },
    CONNECTING:  { color:"#f5c518", label:"◌ CONNECTING" },
    DISCONNECTED:{ color:"#ff3355", label:"✕ OFFLINE" },
  }[wsStatus] || { color:"#4a7a9b", label:"?" };

  const equity    = appState.equity ?? appState.balance ?? 0;
  const balance   = appState.balance ?? 0;
  const floating  = appState.floating ?? 0;
  const sessionPnl= appState.total_pnl ?? 0;
  const wins      = appState.wins ?? 0;
  const losses    = appState.losses ?? 0;
  const winRate   = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "--";
  const wrCol     = wins + losses === 0 ? "#1a3a4a" : parseFloat(winRate) >= 55 ? "#c45a1e" : parseFloat(winRate) >= 40 ? "#f5c518" : "#ff3355";
  const pnlCol    = sessionPnl >= 0 ? "#c45a1e" : "#ff3355";
  const floatCol  = floating >= 0 ? "#c45a1e" : "#ff3355";

  const utcTime     = now.toLocaleTimeString("en-GB", { timeZone:"UTC",            hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit" });
  const nairobiTime = now.toLocaleTimeString("en-GB", { timeZone:"Africa/Nairobi", hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit" });
  const lastStr     = lastUpdate?.toLocaleTimeString() ?? "--:--:--";

  const TABS = ["overview", "positions", "prices", "signals"];

  return (
    <div style={{
      position:"fixed", inset:0, background:"#040810", color:"#c8d8e8",
      fontFamily:"'JetBrains Mono','Courier New',monospace",
      display:"flex", flexDirection:"column", overflow:"hidden",
      fontSize:11, userSelect:"none"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&display=swap');
        @keyframes pulse {0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes fadeIn {from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { display:none; }
      `}</style>

      {/* TOP BAR */}
      <div style={{
        flexShrink:0, background:"#060a0e", borderBottom:"1px solid #0a1520",
        padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center"
      }}>
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <svg width="28" height="24" viewBox="0 0 110 90" xmlns="http://www.w3.org/2000/svg" style={{filter:"drop-shadow(0 0 6px #c45a1e33)"}}>
            <polygon points="18,0 52,0 70,18 70,62 52,80 18,80 0,62 0,18" fill="#c45a1e"/>
            <polygon points="24,10 46,10 58,22 58,58 46,70 24,70 12,58 12,22" fill="#0a0a0a"/>
            <polygon points="35,20 45,35 35,50 25,35" fill="#9a9a9a" opacity="0.55"/>
            <rect x="58" y="0" width="10" height="80" fill="#0a0a0a"/>
            <path d="M64,0 L100,0 L110,10 L110,28 L98,28 L98,18 L72,18 L72,62 L98,62 L98,52 L110,52 L110,70 L100,80 L64,80 L54,70 L54,62 L66,62 L66,18 L54,18 L54,10 Z" fill="#b0b0b0"/>
          </svg>
          <div>
            <div style={{color:"#c45a1e", fontWeight:700, fontSize:14, letterSpacing:4, textShadow:"0 0 14px #c45a1e55"}}>O-CAP</div>
            <div style={{color:"#1a3a4a", fontSize:7, letterSpacing:2}}>ODUKE CAPITAL</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{color:wsConf.color, fontSize:9, letterSpacing:1}}>{wsConf.label}</div>
          <div style={{color:"#f5c518", fontSize:11, fontWeight:700}}>{nairobiTime}</div>
          <div style={{color:"#1a3a4a", fontSize:8}}>{utcTime} UTC</div>
        </div>
      </div>

      {/* TAB BAR */}
      <div style={{
        flexShrink:0, display:"flex", background:"#060a0e",
        borderBottom:"1px solid #0a1520"
      }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex:1, padding:"10px 0", fontSize:8, letterSpacing:1.5,
            background:"transparent", border:"none",
            borderBottom: tab === t ? "2px solid #c45a1e" : "2px solid transparent",
            color: tab === t ? "#c45a1e" : "#1a3a4a",
            cursor:"pointer", fontFamily:"'JetBrains Mono',monospace",
            textTransform:"uppercase", transition:"all 0.2s"
          }}>{t}</button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{flex:1, overflowY:"auto", padding:"12px"}}>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div style={{display:"flex", flexDirection:"column", gap:10, animation:"fadeIn 0.2s"}}>

            {/* equity + balance */}
            <div style={{background:"#060a0e", border:"1px solid #0d1a24", borderRadius:8, padding:"16px"}}>
              <div style={{color:"#1a3a4a", fontSize:8, letterSpacing:2, marginBottom:6}}>ACCOUNT</div>
              <div style={{fontSize:32, fontWeight:700, color:"#c8d8e8", letterSpacing:1, lineHeight:1}}>${equity.toFixed(2)}</div>
              <div style={{color:"#1a3a4a", fontSize:9, marginTop:4}}>EQUITY · BAL ${balance.toFixed(2)}</div>
              <div style={{marginTop:12, display:"flex", gap:8}}>
                <div style={{flex:1}}>
                  <div style={{color:"#1a3a4a", fontSize:8}}>FLOATING</div>
                  <div style={{color:floatCol, fontSize:16, fontWeight:700}}>{floating >= 0 ? "+" : ""}{floating.toFixed(2)}</div>
                </div>
                <div style={{flex:1}}>
                  <div style={{color:"#1a3a4a", fontSize:8}}>SESSION P&L</div>
                  <div style={{color:pnlCol, fontSize:16, fontWeight:700}}>{sessionPnl >= 0 ? "+" : ""}{sessionPnl.toFixed(2)}</div>
                </div>
              </div>
            </div>

            {/* stats row */}
            <div style={{display:"flex", gap:8}}>
              <StatCard label="WIN RATE"  value={wins+losses===0?"--":winRate+"%"} color={wrCol} sub={`${wins}W / ${losses}L`}/>
              <StatCard label="TRADES"    value={appState.taken ?? 0}              color="#7ec8e3" sub={`${appState.skipped ?? 0} skipped`}/>
            </div>

            {/* trade slots */}
            <div style={{background:"#060a0e", border:"1px solid #0d1a24", borderRadius:8, padding:"14px"}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <div style={{color:"#1a3a4a", fontSize:8, letterSpacing:2}}>TRADE SLOTS</div>
                <div style={{color: appState.open_count >= appState.max_concurrent ? "#ff6b35" : "#c45a1e", fontSize:18, fontWeight:700}}>
                  {appState.open_count} <span style={{color:"#1a3a4a", fontSize:13}}>/ {appState.max_concurrent}</span>
                </div>
              </div>
              <SlotBar open={appState.open_count} max={appState.max_concurrent}/>
            </div>

            {/* system status */}
            <div style={{background:"#060a0e", border:"1px solid #0d1a24", borderRadius:8, padding:"14px"}}>
              <div style={{color:"#1a3a4a", fontSize:8, letterSpacing:2, marginBottom:8}}>SYSTEM</div>
              {[
                {label:"MT5 API",   alive:wsStatus==="LIVE"},
                {label:"WS BRIDGE", alive:wsStatus==="LIVE"},
                {label:"UPTIME",    alive:true, detail:appState.uptime},
                {label:"SYNCED",    alive:true, detail:lastStr},
              ].map(({label, alive, detail}) => (
                <div key={label} style={{display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid #080d12"}}>
                  <div style={{display:"flex", alignItems:"center", gap:8, color:"#1a3a4a", fontSize:9}}>
                    <PulsingDot color={alive ? "#c45a1e" : "#ff3355"}/>
                    {label}
                  </div>
                  <div style={{color: alive ? "#c45a1e" : "#ff3355", fontSize:9}}>
                    {detail ?? (alive ? "OK" : "OFFLINE")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── POSITIONS ── */}
        {tab === "positions" && (
          <div style={{display:"flex", flexDirection:"column", gap:8, animation:"fadeIn 0.2s"}}>
            <div style={{color:"#1a3a4a", fontSize:8, letterSpacing:2, marginBottom:4}}>OPEN POSITIONS · {appState.open_count}</div>
            {!appState.open_trades?.length ? (
              <div style={{color:"#1a3a4a", textAlign:"center", padding:"40px 0", fontSize:10}}>— No open positions —</div>
            ) : appState.open_trades.map(t => {
              const pnl    = t.profit ?? null;
              const pnlCol = pnl == null ? "#1a3a4a" : pnl >= 0 ? "#c45a1e" : "#ff3355";
              const dirCol = t.direction === "LONG" ? "#c45a1e" : "#ff3355";
              const dp     = (t.entry ?? 0) > 100 ? 2 : 5;
              return (
                <div key={t.ticket} style={{
                  background:"#060a0e", border:"1px solid #0d1a24", borderRadius:8,
                  padding:"14px", animation:"fadeIn 0.3s"
                }}>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
                    <div style={{display:"flex", alignItems:"center", gap:8}}>
                      <span style={{color:"#fff", fontWeight:700, fontSize:15, letterSpacing:1}}>{t.symbol}</span>
                      <span style={{color:dirCol, fontSize:9, background:dirCol+"18", border:`1px solid ${dirCol}33`, padding:"1px 6px", borderRadius:3}}>{t.direction}</span>
                    </div>
                    <div style={{color:pnlCol, fontWeight:700, fontSize:18, fontVariantNumeric:"tabular-nums"}}>
                      {pnl != null ? (pnl >= 0 ? "+" : "") + pnl.toFixed(2) : "--"}
                    </div>
                  </div>
                  <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6}}>
                    {[
                      {l:"ENTRY", v:t.entry?.toFixed(dp)},
                      {l:"SL",    v:t.sl?.toFixed(dp),   c:"#ff6680"},
                      {l:"TP",    v:t.tp?.toFixed(dp),   c:"#b85018"},
                      {l:"LOTS",  v:t.lots},
                      {l:"TICKET",v:t.ticket},
                      {l:"TIME",  v:t.open_time?.split("T")[1]?.slice(0,5) ?? "--"},
                    ].map(({l,v,c}) => (
                      <div key={l}>
                        <div style={{color:"#1a3a4a", fontSize:7, letterSpacing:1}}>{l}</div>
                        <div style={{color:c??"#c8d8e8", fontSize:10, fontVariantNumeric:"tabular-nums"}}>{v ?? "--"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── PRICES ── */}
        {tab === "prices" && (
          <div style={{display:"flex", flexDirection:"column", gap:2, animation:"fadeIn 0.2s"}}>
            <div style={{color:"#1a3a4a", fontSize:8, letterSpacing:2, marginBottom:8}}>LIVE PRICES</div>
            {(appState.portfolio_symbols ?? Object.keys(ticks)).map(sym => {
              const tick = ticks[sym];
              const dp   = symPrec(sym);
              const inTrade = appState.open_trades?.some(t => t.symbol === sym);
              return (
                <div key={sym} style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 12px", background:"#060a0e",
                  border:`1px solid ${inTrade ? "#f5c51833" : "#0d1a24"}`,
                  borderRadius:6, borderLeft:`3px solid ${inTrade ? "#f5c518" : "#0d1a24"}`
                }}>
                  <div style={{display:"flex", alignItems:"center", gap:8}}>
                    {inTrade && <PulsingDot color="#f5c518"/>}
                    <span style={{color: inTrade ? "#f5c518" : "#2a5a6a", fontWeight:"bold", fontSize:11, letterSpacing:1}}>{sym}</span>
                  </div>
                  {tick ? (
                    <div style={{textAlign:"right"}}>
                      <div style={{color:"#c8d8e8", fontSize:13, fontWeight:700, fontVariantNumeric:"tabular-nums"}}>{tick.bid?.toFixed(dp)}</div>
                      <div style={{color:"#cc2233", fontSize:9}}>{tick.ask?.toFixed(dp)}</div>
                    </div>
                  ) : <span style={{color:"#1a3a4a"}}>···</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* ── SIGNALS ── */}
        {tab === "signals" && (
          <div style={{display:"flex", flexDirection:"column", gap:6, animation:"fadeIn 0.2s"}}>
            <div style={{color:"#1a3a4a", fontSize:8, letterSpacing:2, marginBottom:4}}>SIGNAL LOG</div>
            {!appState.signal_log?.length ? (
              <div style={{color:"#1a3a4a", textAlign:"center", padding:"40px 0", fontSize:10}}>— Awaiting signals —</div>
            ) : [...appState.signal_log].reverse().map((s, i) => {
              const ac = ACTION_COLORS[s.action] ?? "#666";
              return (
                <div key={i} style={{
                  background:"#060a0e", border:"1px solid #0d1a24", borderRadius:6,
                  padding:"10px 12px", display:"flex", justifyContent:"space-between",
                  alignItems:"center", animation: i===0 ? "fadeIn 0.25s" : undefined
                }}>
                  <div>
                    <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:3}}>
                      <span style={{color:"#fff", fontWeight:700, fontSize:12}}>{s.symbol}</span>
                      <span style={{color: s.direction==="LONG" ? "#c45a1e" : "#ff3355", fontSize:9}}>{s.direction}</span>
                    </div>
                    <div style={{color:"#1a3a4a", fontSize:8}}>{s.time?.split("T")[1]?.slice(0,8) ?? s.time}</div>
                  </div>
                  <span style={{
                    color:ac, background:ac+"18", border:`1px solid ${ac}33`,
                    padding:"3px 8px", fontSize:9, borderRadius:4, letterSpacing:1
                  }}>{ACTION_LABELS[s.action] ?? s.action}</span>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* BOTTOM STATUS BAR */}
      <div style={{
        flexShrink:0, background:"#060a0e", borderTop:"1px solid #0a1520",
        padding:"6px 14px", display:"flex", justifyContent:"space-between", alignItems:"center"
      }}>
        <span style={{color:"#1a3a4a", fontSize:8}}>O-CAP · Z±1.5 · SL10p · RR1.5</span>
        <span style={{color: wsStatus==="LIVE" ? "#c45a1e" : "#ff3355", fontSize:8}}>{wsConf.label}</span>
      </div>
    </div>
  );
}