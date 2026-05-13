import { useState, useEffect, useRef, useCallback } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const WS_URL          = "ws://localhost:8765";
const WS_RECONNECT_MS = 3000;
const DEFAULT_SYMBOL  = "EURUSD";
const DEFAULT_TF      = "M5";
const TIMEFRAMES      = ["M1","M5","M15","H1","H4","D1"];
const TF_MAP          = { M1:1, M5:5, M15:15, H1:60, H4:240, D1:1440 };
const TRADE_START_H   = 8;
const TRADE_END_H     = 22;

const _parse = (key, fallback) => (import.meta.env[key] ?? fallback).split(",").map(s => s.trim()).filter(Boolean);
const TRADED_SYMBOLS    = _parse("VITE_TRADED_SYMBOLS",    "EURUSD,AUDUSD,XAUUSD,NZDUSD,EURJPY,US500");
const PORTFOLIO_SYMBOLS = _parse("VITE_PORTFOLIO_SYMBOLS", "EURUSD,AUDUSD,XAUUSD,NZDUSD,EURJPY,US500,GBPUSD,USDJPY,USDCAD,GBPJPY,EURGBP,USDCHF,BTCUSD,ETHUSD,SOLUSD,US30,NAS100,SILVER,USOIL,GER40");
const WATCH_SYMBOLS   = _parse("VITE_WATCH_SYMBOLS",  "GBPUSD,USDJPY,USDCAD,GBPJPY,EURGBP,USDCHF");
const CRYPTO_SYMBOLS  = _parse("VITE_CRYPTO_SYMBOLS", "BTCUSD,ETHUSD,SOLUSD");
const MACRO_SYMBOLS   = _parse("VITE_MACRO_SYMBOLS",  "US30,NAS100,SILVER,USOIL,GER40");
const TICKER_SYMBOLS    = _parse("VITE_TICKER_SYMBOLS",    "EURUSD,AUDUSD,XAUUSD,NZDUSD,EURJPY,US500,GBPUSD,USDJPY,USDCAD,GBPJPY,EURGBP,USDCHF,BTCUSD,ETHUSD,SOLUSD,US30,NAS100,SILVER,USOIL,GER40");

const SYM_PRECISION = {
  EURUSD:5,AUDUSD:5,NZDUSD:5,GBPUSD:5,USDCAD:5,EURGBP:5,USDCHF:5,
  EURJPY:3,USDJPY:3,GBPJPY:3,
  XAUUSD:2,SILVER:2,US500:2,US30:2,NAS100:2,GER40:2,USOIL:2,
  BTCUSD:2,ETHUSD:2,SOLUSD:3,
};
const symPrec = (s) => SYM_PRECISION[s] ?? 5;
const symMove = (s) => parseFloat((Math.pow(10,-symPrec(s))).toFixed(symPrec(s)));

const calcSpread = (sym, bid, ask) => {
  if (bid == null || ask == null) return "--";
  const raw = ask - bid;
  if (sym.includes("JPY")) return (raw * 100).toFixed(1);
  if (["XAUUSD","SILVER","US500","US30","NAS100","GER40","USOIL","BTCUSD","ETHUSD"].includes(sym)) return raw.toFixed(1);
  if (sym === "SOLUSD") return (raw * 1000).toFixed(1);
  return (raw * 10000).toFixed(1);
};

const ACTION_COLORS = {
  TAKEN:"#c45a1e",SKIPPED_FULL:"#ff6b35",SKIPPED_ASSET:"#f5c518",
  ORDER_FAILED:"#ff2255",APPROVED:"#c45a1e",REJECTED:"#ff3355",
};
const ACTION_LABELS = {
  TAKEN:"EXEC",SKIPPED_FULL:"FULL",SKIPPED_ASSET:"OCCUP",
  ORDER_FAILED:"ERR",APPROVED:"✓ OK",REJECTED:"✕ REJ",
};

const EMPTY_STATE = {
  balance:0,equity:0,floating:0,closed_pnl:0,
  open_count:0,max_concurrent:5,taken:0,skipped:0,
  wins:0,losses:0,win_rate:0,total_pnl:0,uptime:"00:00:00",
  open_trades:[],signal_log:[],timestamp:null,
};

const STRIP_SECTIONS = [
  { label:"TRADED", syms:TRADED_SYMBOLS,  color:"#c45a1e" },
  { label:"FOREX",  syms:WATCH_SYMBOLS,   color:"#7ec8e3" },
  { label:"CRYPTO", syms:CRYPTO_SYMBOLS,  color:"#a78bfa" },
  { label:"MACRO",  syms:MACRO_SYMBOLS,   color:"#f5c518" },
];

const INDICATOR_DEFS = [
  { id:"sma",    label:"SMA",     hasLen:true,  defaultLen:14,  color:"#f5c518", pane:"main" },
  { id:"ema",    label:"EMA",     hasLen:true,  defaultLen:21,  color:"#00aaff", pane:"main" },
  { id:"bb",     label:"BB",      hasLen:true,  defaultLen:20,  color:"#aa55ff", pane:"main" },
  { id:"vwap",   label:"VWAP",    hasLen:false, defaultLen:null,color:"#ff8844", pane:"main" },
  { id:"zscore", label:"Z-Score", hasLen:true,  defaultLen:14,  color:"#c45a1e", pane:"sub"  },
  { id:"rsi",    label:"RSI",     hasLen:true,  defaultLen:14,  color:"#ff6b35", pane:"sub"  },
  { id:"macd",   label:"MACD",    hasLen:false, defaultLen:null,color:"#7ec8e3", pane:"sub"  },
];

const NEWS_CHANNELS = [
  { id:"bloomberg",color:"#c45a1e",short:"BB",  label:"BLOOMBERG", videoId:"iEpJwprxDdk" },
  { id:"yahoo",    color:"#6c3fd4",short:"YF",  label:"YAHOO FIN", videoId:"KQp-e_XQnDE" },
  { id:"skynews",  color:"#00aaff",short:"SKY", label:"SKY NEWS",  videoId:"YDvsBbKfLPA" },
  { id:"france24", color:"#0044aa",short:"F24", label:"FRANCE 24", videoId:"Ap-UM1O9RBU" },
  { id:"citizen",  color:"#e8281e",short:"CIT", label:"CITIZEN KE",videoId:"dqYh0d4K-Ac" },
];

const INDEX_DISPLAY = {
  "JP225":{label:"NIKKEI",d:0,region:"AS"},"JPN225":{label:"NIKKEI",d:0,region:"AS"},
  "N225":{label:"NIKKEI",d:0,region:"AS"},"HK50":{label:"HANG SENG",d:0,region:"AS"},
  "HSI":{label:"HANG SENG",d:0,region:"AS"},"CN50":{label:"CHINA 50",d:2,region:"AS"},
  "CHINAH":{label:"CHINA H",d:2,region:"AS"},"AUS200":{label:"ASX 200",d:0,region:"AS"},
  "AUS200.cash":{label:"ASX 200",d:0,region:"AS"},"UK100":{label:"FTSE 100",d:0,region:"LN"},
  "FTSE100":{label:"FTSE 100",d:0,region:"LN"},"GER40":{label:"DAX 40",d:0,region:"LN"},
  "GER30":{label:"DAX",d:0,region:"LN"},"DAX40":{label:"DAX 40",d:0,region:"LN"},
  "DAX":{label:"DAX",d:0,region:"LN"},"FRA40":{label:"CAC 40",d:0,region:"LN"},
  "ESP35":{label:"IBEX 35",d:0,region:"LN"},"US30":{label:"DOW",d:0,region:"NY"},
  "USA30":{label:"DOW",d:0,region:"NY"},"US100":{label:"NASDAQ",d:2,region:"NY"},
  "NAS100":{label:"NASDAQ",d:2,region:"NY"},"NDX":{label:"NASDAQ",d:2,region:"NY"},
  "US2000":{label:"RUSSELL",d:2,region:"NY"},"RUSSELL":{label:"RUSSELL",d:2,region:"NY"},
  "EURUSD":{label:"EUR/USD",d:5,region:"FX"},"AUDUSD":{label:"AUD/USD",d:5,region:"FX"},
  "NZDUSD":{label:"NZD/USD",d:5,region:"FX"},"GBPUSD":{label:"GBP/USD",d:5,region:"FX"},
  "USDJPY":{label:"USD/JPY",d:3,region:"FX"},"USDCAD":{label:"USD/CAD",d:5,region:"FX"},
  "GBPJPY":{label:"GBP/JPY",d:3,region:"FX"},"EURGBP":{label:"EUR/GBP",d:5,region:"FX"},
  "USDCHF":{label:"USD/CHF",d:5,region:"FX"},"EURJPY":{label:"EUR/JPY",d:3,region:"FX"},
  "XAUUSD":{label:"GOLD",d:2,region:"CM"},"SILVER":{label:"SILVER",d:2,region:"CM"},
  "USOIL":{label:"WTI OIL",d:2,region:"CM"},"US500":{label:"S&P 500",d:2,region:"NY"},
  "BTCUSD":{label:"BITCOIN",d:2,region:"CR"},"ETHUSD":{label:"ETHEREUM",d:2,region:"CR"},
  "SOLUSD":{label:"SOLANA",d:3,region:"CR"},
};
const REGION_COLORS = { AS:"#7ec8e3",LN:"#00aaff",NY:"#ff6b35",FX:"#c45a1e",CM:"#f5c518",CR:"#a78bfa" };

const SESSIONS = [
  { label:"SYDNEY",   tz:"Australia/Sydney",  open:22,close:7,  color:"#7ec8e3" },
  { label:"TOKYO",    tz:"Asia/Tokyo",         open:0, close:9,  color:"#f5c518" },
  { label:"BEIJING",  tz:"Asia/Shanghai",      open:1, close:9,  color:"#ff6b9d" },
  { label:"LONDON",   tz:"Europe/London",      open:8, close:17, color:"#00aaff" },
  { label:"NEW YORK", tz:"America/New_York",   open:13,close:22, color:"#ff6b35" },
];

// ─── MATH HELPERS ─────────────────────────────────────────────────────────────
function calcSMA(data, len) {
  return data.map((d,i) => {
    if (i < len-1) return null;
    return { time:d.time, value:data.slice(i-len+1,i+1).reduce((a,c)=>a+c.close,0)/len };
  }).filter(Boolean);
}

function calcEMA(data, len) {
  const k = 2/(len+1);
  let ema = data[0]?.close ?? 0;
  return data.map((d,i) => {
    if (i===0) { ema=d.close; return {time:d.time,value:ema}; }
    ema = d.close*k + ema*(1-k);
    return {time:d.time,value:ema};
  });
}

function calcBB(data, len, mult=2) {
  const mid=[],upper=[],lower=[];
  data.forEach((d,i) => {
    if (i < len-1) return;
    const sl = data.slice(i-len+1,i+1);
    const m  = sl.reduce((a,c)=>a+c.close,0)/len;
    const sd = Math.sqrt(sl.reduce((a,c)=>a+Math.pow(c.close-m,2),0)/len);
    mid.push({time:d.time,value:m});
    upper.push({time:d.time,value:m+mult*sd});
    lower.push({time:d.time,value:m-mult*sd});
  });
  return {mid,upper,lower};
}

function calcVWAP(data) {
  let cumPV=0,cumV=0;
  return data.map(d => {
    const typ = (d.high+d.low+d.close)/3;
    cumPV += typ*(d.volume||1);
    cumV  += (d.volume||1);
    return {time:d.time,value:cumPV/cumV};
  });
}

function calcZScore(data, len) {
  return data.map((d,i) => {
    if (i < len-1) return null;
    const sl = data.slice(i-len+1,i+1);
    const m  = sl.reduce((a,c)=>a+c.close,0)/len;
    const sd = Math.sqrt(sl.reduce((a,c)=>a+Math.pow(c.close-m,2),0)/len);
    return sd < 0.000001 ? null : {time:d.time,value:(d.close-m)/sd};
  }).filter(Boolean);
}

function calcRSI(data, len) {
  const gains=[],losses=[];
  for (let i=1;i<data.length;i++) {
    const d = data[i].close-data[i-1].close;
    gains.push(d>0?d:0);
    losses.push(d<0?-d:0);
  }
  const out=[];
  for (let i=len-1;i<gains.length;i++) {
    const ag = gains.slice(i-len+1,i+1).reduce((a,c)=>a+c,0)/len;
    const al = losses.slice(i-len+1,i+1).reduce((a,c)=>a+c,0)/len;
    const rs = al===0?100:ag/al;
    out.push({time:data[i+1].time,value:100-100/(1+rs)});
  }
  return out;
}

function calcMACD(data, fast=12, slow=26, sig=9) {
  const k1=2/(fast+1),k2=2/(slow+1),k3=2/(sig+1);
  let e1=data[0].close,e2=data[0].close;
  const macdLine = data.map(d => {
    e1=d.close*k1+e1*(1-k1);
    e2=d.close*k2+e2*(1-k2);
    return {time:d.time,value:e1-e2};
  });
  let sig_=macdLine[0].value;
  const sigLine = macdLine.map(d => {
    sig_=d.value*k3+sig_*(1-k3);
    return {time:d.time,value:sig_};
  });
  const hist = macdLine.map((d,i) => ({
    time:d.time,
    value:d.value-sigLine[i].value,
    color:d.value-sigLine[i].value>=0?"#c45a1e55":"#ff335555",
  }));
  return {macdLine,sigLine,hist};
}

// ─── SESSION HELPERS ──────────────────────────────────────────────────────────
function sessionDateKey(date) {
  const day=date.getUTCDay(),h=date.getUTCHours();
  let d=new Date(date);
  if (day===0) { d.setUTCDate(d.getUTCDate()+1); }
  else if (day===6) { d.setUTCDate(d.getUTCDate()+2); }
  else if (h<TRADE_START_H) {
    d.setUTCDate(d.getUTCDate()-1);
    if (d.getUTCDay()===0) d.setUTCDate(d.getUTCDate()-2);
    if (d.getUTCDay()===6) d.setUTCDate(d.getUTCDate()-1);
  }
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;
}

// ─── HOOKS ────────────────────────────────────────────────────────────────────
function useSessionReset(appState) {
  const LS_KEY = "ocap_session_baseline";
  const [baseline,setBaseline] = useState(()=>{
    try { const r=localStorage.getItem(LS_KEY); return r?JSON.parse(r):null; } catch { return null; }
  });
  const prevKey = useRef(null);
  useEffect(()=>{
    const tick=()=>{
      const key=sessionDateKey(new Date());
      if (prevKey.current && prevKey.current!==key) {
        const snap={
          sessionKey:key,
          taken:appState.taken??0,skipped:appState.skipped??0,
          wins:appState.wins??0,losses:appState.losses??0,
          closed_pnl:appState.closed_pnl??0,total_pnl:appState.total_pnl??0,
        };
        setBaseline(snap);
        try { localStorage.setItem(LS_KEY,JSON.stringify(snap)); } catch {}
      }
      prevKey.current=key;
    };
    tick();
    const id=setInterval(tick,5000);
    return ()=>clearInterval(id);
  },[appState]);
  const b=baseline;
  return {
    taken:     (appState.taken     ??0)-(b?.taken     ??0),
    skipped:   (appState.skipped   ??0)-(b?.skipped   ??0),
    wins:      (appState.wins      ??0)-(b?.wins      ??0),
    losses:    (appState.losses    ??0)-(b?.losses    ??0),
    closed_pnl:(appState.closed_pnl??0)-(b?.closed_pnl??0),
    total_pnl: (appState.total_pnl ??0)-(b?.total_pnl ??0),
  };
}

function useJourneyReset(totalPnl) {
  const LS_KEY="ocap_journey_reset_base";
  const [journeyBase,setJourneyBase]=useState(()=>{
    try { const r=localStorage.getItem(LS_KEY); return r!==null?parseFloat(r):0; } catch { return 0; }
  });
  const resetJourney=useCallback(()=>{
    const base=totalPnl??0;
    setJourneyBase(base);
    try { localStorage.setItem(LS_KEY,String(base)); } catch {}
  },[totalPnl]);
  return { journeyPnl:(totalPnl??0)-journeyBase, resetJourney };
}

function useLiveData(onSymbols, onPortfolio) {
  const [appState,   setAppState]   = useState(EMPTY_STATE);
  const [wsStatus,   setWsStatus]   = useState("CONNECTING");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [pnlHistory, setPnlHistory] = useState([]);
  const [ticks,      setTicks]      = useState({});
  const [indexSymbols,setIndexSymbols]=useState([]);
  const [indexOpens,  setIndexOpens] = useState({});
  const [streamUrls,  setStreamUrls] = useState({});
  const historyHandlers = useRef({});
  const candleHandlers  = useRef({});
  const wsRef           = useRef(null);
  const reconnTimer     = useRef(null);

  const connect = useCallback(()=>{
    if (wsRef.current?.readyState<2) return;
    setWsStatus("CONNECTING");
    const ws=new WebSocket(WS_URL);
    wsRef.current=ws;
    ws.onopen  = ()=>{ setWsStatus("LIVE"); clearTimeout(reconnTimer.current); };
    ws.onclose = ()=>{ setWsStatus("DISCONNECTED"); reconnTimer.current=setTimeout(connect,WS_RECONNECT_MS); };
    ws.onerror = ()=>ws.close();
    ws.onmessage=({data})=>{
      try {
        const msg=JSON.parse(data);
        switch(msg.type) {
          case "STATE": {
            const {type,...s}=msg;
            setAppState(s);
            setLastUpdate(new Date());
            setPnlHistory(p=>[...p,s.floating??0].slice(-80));
            setTicks(s.ticks??{});
            if (s.symbols)           onSymbols(s.symbols);
            if (s.portfolio_symbols) onPortfolio(s.portfolio_symbols);
            break;
          }
          case "TICKS":
            setTicks(prev=>{ const n={...prev}; msg.data.forEach(t=>{n[t.symbol]=t;}); return n; });
            break;
          case "HISTORY":
            historyHandlers.current[`${msg.symbol}_${msg.tf}`]?.(msg.candles);
            break;
          case "CANDLE":
            candleHandlers.current[`${msg.symbol}_${msg.tf}`]?.(msg);
            break;
          case "INDEX_SYMBOLS":
            setIndexSymbols(msg.symbols??[]);
            break;
          case "INDEX_OPENS":
            setIndexOpens(prev=>({...prev,...msg.opens}));
            break;
          case "STREAM_URL":
            setStreamUrls(prev=>({...prev,[msg.key]:msg.url}));
            break;
        }
      } catch(e){ console.error("WS:",e); }
    };
  },[]);

  useEffect(()=>{
    connect();
    return ()=>{ wsRef.current?.close(); clearTimeout(reconnTimer.current); };
  },[connect]);

  const requestHistory=useCallback((symbol,tf)=>{
    if (wsRef.current?.readyState===WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({type:"REQUEST_HISTORY",symbol,tf,tf_minutes:TF_MAP[tf]}));
  },[]);

  const registerChart=useCallback((symbol,tf,onCandle,onHistory)=>{
    const key=`${symbol}_${tf}`;
    candleHandlers.current[key]=onCandle;
    historyHandlers.current[key]=onHistory;
    return ()=>{ delete candleHandlers.current[key]; delete historyHandlers.current[key]; };
  },[]);

  return { appState,wsStatus,lastUpdate,pnlHistory,ticks,indexSymbols,indexOpens,streamUrls,registerChart,requestHistory };
}

// ─── SMALL UI PRIMITIVES ──────────────────────────────────────────────────────
const SRow = ({label,val,color="#c8d8e8"}) => (
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #090f16"}}>
    <span style={{color:"#1e3a50",fontSize:9}}>{label}</span>
    <span style={{color,fontWeight:"bold",fontSize:11,fontVariantNumeric:"tabular-nums",fontFamily:"'JetBrains Mono',monospace"}}>{val}</span>
  </div>
);

const PanelHead = ({label}) => (
  <div style={{color:"#1a3a4a",fontSize:8,letterSpacing:2.5,marginBottom:8}}>{label}</div>
);

function Sparkline({ values, width=100, height=32, color="#c45a1e" }) {
  if (!values||values.length<2) return (
    <svg width={width} height={height}>
      <line x1="0" y1={height/2} x2={width} y2={height/2} stroke="#0d1520" strokeDasharray="3,3" strokeWidth="1"/>
    </svg>
  );
  const min=Math.min(...values),max=Math.max(...values),rng=max-min||0.001;
  const pts=values.map((v,i)=>{
    const x=(i/(values.length-1))*width;
    const y=height-((v-min)/rng)*(height-3)-1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const id=`sg${color.replace(/[^a-z0-9]/gi,"")}`;
  const lv=values[values.length-1];
  const ly=height-((lv-min)/rng)*(height-3)-1;
  return (
    <svg width={width} height={height} style={{display:"block",overflow:"visible"}}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={`url(#${id})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={width} cy={ly} r="2.5" fill={color}/>
    </svg>
  );
}

// ─── TIME & CLOCK COMPONENTS ──────────────────────────────────────────────────
function SessionClock({ session, nowUtc }) {
  const [localTime,setLocalTime]=useState("");
  useEffect(()=>{
    const tick=()=>{
      try { setLocalTime(new Date().toLocaleTimeString("en-GB",{timeZone:session.tz,hour12:false,hour:"2-digit",minute:"2-digit"})); }
      catch { setLocalTime("--:--"); }
    };
    tick();
    const id=setInterval(tick,1000);
    return ()=>clearInterval(id);
  },[session.tz]);
  const utcH=nowUtc.getUTCHours();
  const {open,close}=session;
  const isOpen=open<close?utcH>=open&&utcH<close:utcH>=open||utcH<close;
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 10px",borderRight:"1px solid #0a1520",minWidth:62}}>
      <span style={{color:isOpen?session.color:"#1a3a4a",fontSize:7,letterSpacing:1.5,marginBottom:1}}>{session.label}</span>
      <span style={{color:isOpen?session.color:"#1a3040",fontSize:12,fontWeight:700,fontVariantNumeric:"tabular-nums",textShadow:isOpen?`0 0 10px ${session.color}66`:"none"}}>{localTime}</span>
      <span style={{fontSize:6,letterSpacing:1,color:isOpen?session.color+"99":"#0d2030",marginTop:1}}>{isOpen?"● OPEN":"○ CLOSED"}</span>
    </div>
  );
}

function TradingCountdown() {
  const [display,setDisplay]=useState({label:"",time:"--:--:--",isOpen:false,note:""});
  useEffect(()=>{
    const fmt=(s)=>`${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
    const calc=()=>{
      const now=new Date();
      const day=now.getUTCDay();
      const secs=now.getUTCHours()*3600+now.getUTCMinutes()*60+now.getUTCSeconds();
      const openSecs=TRADE_START_H*3600,closeSecs=TRADE_END_H*3600;
      const isWeekday=day>=1&&day<=5;
      const inSession=isWeekday&&secs>=openSecs&&secs<closeSecs;
      if (inSession) { setDisplay({label:"SESSION CLOSE",time:fmt(closeSecs-secs),isOpen:true,note:day===5?"FRI":""}); return; }
      const left=86400-secs;
      if      (day===5&&secs>=closeSecs) setDisplay({label:"MON OPEN",time:fmt(left+2*86400+openSecs),isOpen:false,note:"MON"});
      else if (day===6)                  setDisplay({label:"MON OPEN",time:fmt(left+1*86400+openSecs),isOpen:false,note:"MON"});
      else if (day===0)                  setDisplay({label:"MON OPEN",time:fmt(left+openSecs),         isOpen:false,note:"MON"});
      else if (secs>=closeSecs)          setDisplay({label:"SESSION OPEN",time:fmt(left+openSecs),     isOpen:false,note:""});
      else                               setDisplay({label:"SESSION OPEN",time:fmt(openSecs-secs),     isOpen:false,note:""});
    };
    calc();
    const id=setInterval(calc,1000);
    return ()=>clearInterval(id);
  },[]);
  const col=display.isOpen?"#c45a1e":display.note==="MON"?"#7ec8e3":"#f5c518";
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 10px",borderRight:"1px solid #0a1520",minWidth:90,flexShrink:0}}>
      <span style={{color:"#1a3a4a",fontSize:6,letterSpacing:1.5,marginBottom:1}}>{display.label}</span>
      <span style={{color:col,fontSize:13,fontWeight:700,fontVariantNumeric:"tabular-nums",textShadow:`0 0 10px ${col}55`,fontFamily:"'JetBrains Mono',monospace"}}>{display.time}</span>
      <span style={{fontSize:6,letterSpacing:1,color:col+"99",marginTop:1}}>
        {display.isOpen?(display.note==="FRI"?"▶ FRI SESSION":"▶ LIVE"):display.note==="MON"?"◼ WEEKEND":"◼ CLOSED"}
      </span>
    </div>
  );
}

function TopBar({ wsStatus, wsConf, appState, lastStr }) {
  const [now,setNow]=useState(new Date());
  useEffect(()=>{ const id=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(id); },[]);
  const utcTime     =now.toLocaleTimeString("en-GB",{timeZone:"UTC",           hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
  const nairobiTime =now.toLocaleTimeString("en-GB",{timeZone:"Africa/Nairobi",hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
  return (
    <div style={{height:44,flexShrink:0,background:"#060a0e",borderBottom:"1px solid #0a1520",display:"flex",alignItems:"center",zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"0 10px",borderRight:"1px solid #0a1520",flexShrink:0}}>
        <svg width="34" height="30" viewBox="0 0 110 90" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0,filter:"drop-shadow(0 0 6px #c45a1e33)"}}>
          <polygon points="18,0 52,0 70,18 70,62 52,80 18,80 0,62 0,18" fill="#c45a1e"/>
          <polygon points="24,10 46,10 58,22 58,58 46,70 24,70 12,58 12,22" fill="#0a0a0a"/>
          <polygon points="35,20 45,35 35,50 25,35" fill="#9a9a9a" opacity="0.55"/>
          <rect x="58" y="0" width="10" height="80" fill="#0a0a0a"/>
          <path d="M64,0 L100,0 L110,10 L110,28 L98,28 L98,18 L72,18 L72,62 L98,62 L98,52 L110,52 L110,70 L100,80 L64,80 L54,70 L54,62 L66,62 L66,18 L54,18 L54,10 Z" fill="#b0b0b0"/>
        </svg>
        <div style={{display:"flex",flexDirection:"column",lineHeight:1,gap:2}}>
          <span style={{color:"#c45a1e",fontWeight:700,fontSize:13,letterSpacing:4,textShadow:"0 0 14px #c45a1e55",fontFamily:"'JetBrains Mono',monospace"}}>O-CAP</span>
          <span style={{color:"#2a3a4a",fontSize:6,letterSpacing:2}}>ODUKE CAPITAL</span>
        </div>
        <span style={{color:wsConf.color,fontSize:9,letterSpacing:1,textShadow:`0 0 8px ${wsConf.color}55`,animation:wsStatus==="CONNECTING"?"pulse 1s infinite":undefined}}>{wsConf.label}</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 12px",borderRight:"1px solid #0a1520",flexShrink:0}}>
        <span style={{color:"#1a3a4a",fontSize:7,letterSpacing:2}}>UTC</span>
        <span style={{color:"#c8d8e8",fontSize:13,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{utcTime}</span>
      </div>
      <div style={{display:"flex",alignItems:"center",flex:1,overflowX:"auto"}}>
        {SESSIONS.map(s=><SessionClock key={s.label} session={s} nowUtc={now}/>)}
        <TradingCountdown/>
      </div>
      <div style={{display:"flex",gap:16,alignItems:"center",padding:"0 16px",borderLeft:"1px solid #0a1520",flexShrink:0}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
          <span style={{color:"#1a3a4a",fontSize:7,letterSpacing:1}}>UPTIME</span>
          <span style={{color:"#7ec8e3",fontSize:10,fontVariantNumeric:"tabular-nums"}}>{appState.uptime}</span>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
          <span style={{color:"#1a3a4a",fontSize:7,letterSpacing:1}}>SYNCED</span>
          <span style={{color:"#7ec8e3",fontSize:10,fontVariantNumeric:"tabular-nums"}}>{lastStr}</span>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 0 0 8px",borderLeft:"1px solid #0a1520"}}>
          <span style={{color:"#f5c518",fontSize:7,letterSpacing:2}}>NAIROBI</span>
          <span style={{color:"#f5c518",fontSize:13,fontWeight:700,fontVariantNumeric:"tabular-nums",textShadow:"0 0 10px #f5c51844"}}>{nairobiTime}</span>
        </div>
      </div>
    </div>
  );
}

// ─── MARKET TICKER ────────────────────────────────────────────────────────────
function MarketTicker({ ticks, indexSymbols, indexOpens, portfolioSymbols }) {
  const trackRef   = useRef(null);
  const rafRef     = useRef(null);
  const posRef     = useRef(0);
  const sessionOpen= useRef({});

  useEffect(()=>{
    TICKER_SYMBOLS.forEach(sym=>{
      const tick=ticks[sym];
      if (tick?.bid&&!sessionOpen.current[sym]) sessionOpen.current[sym]=tick.bid;
    });
  },[ticks]);

  const activePortfolio=portfolioSymbols??TICKER_SYMBOLS;
  const allSyms=[...indexSymbols.filter(s=>!activePortfolio.includes(s)),...activePortfolio];
  const items=allSyms.map(sym=>{
    const cfg  =INDEX_DISPLAY[sym]??{label:sym,d:2,region:"FX"};
    const tick =ticks[sym];
    const price=tick?.bid??null;
    const open =indexOpens[sym]??sessionOpen.current[sym]??null;
    const pct  =(price&&open)?((price-open)/open*100):null;
    return {sym,...cfg,price,pct};
  });
  const doubled=[...items,...items];

  useEffect(()=>{
    const step=()=>{
      const halfW=(trackRef.current?.scrollWidth??0)/2;
      if (halfW>0) {
        posRef.current+=0.55;
        if (posRef.current>=halfW) posRef.current-=halfW;
      }
      trackRef.current.style.transform=`translateX(${-posRef.current}px)`;
      rafRef.current=requestAnimationFrame(step);
    };
    rafRef.current=requestAnimationFrame(step);
    return ()=>cancelAnimationFrame(rafRef.current);
  },[]);

  return (
    <div style={{height:26,flexShrink:0,background:"#04080e",borderBottom:"1px solid #0a1520",overflow:"hidden",position:"relative",zIndex:99}}>
      <div style={{position:"absolute",left:0,top:0,bottom:0,width:32,background:"linear-gradient(90deg,#04080e,transparent)",zIndex:2,pointerEvents:"none"}}/>
      <div style={{position:"absolute",right:0,top:0,bottom:0,width:32,background:"linear-gradient(270deg,#04080e,transparent)",zIndex:2,pointerEvents:"none"}}/>
      <div style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",zIndex:3,display:"flex",alignItems:"center",gap:4}}>
        <span style={{color:"#1a3a4a",fontSize:7}}>{indexSymbols.length>0?`${indexSymbols.length} IDX`:"IDX ···"}</span>
        <span style={{width:4,height:4,borderRadius:"50%",background:indexSymbols.length>0?"#c45a1e":"#1a3040",display:"inline-block"}}/>
      </div>
      <div ref={trackRef} style={{display:"flex",alignItems:"center",height:"100%",whiteSpace:"nowrap",willChange:"transform"}}>
        {doubled.map((item,i)=>{
          const col  =REGION_COLORS[item.region]??"#7ec8e3";
          const up   =item.pct>0,dn=item.pct<0;
          const pCol =up?"#c45a1e":dn?"#ff3355":"#2a5a6a";
          const arrow=up?"▲":dn?"▼":"";
          return (
            <div key={i} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 12px",borderRight:"1px solid #0a1520",height:"100%",flexShrink:0}}>
              <span style={{color:col,fontSize:7,letterSpacing:1,opacity:0.55}}>{item.region}</span>
              <span style={{color:"#2a5a6a",fontSize:8,fontWeight:"bold"}}>{item.label}</span>
              {item.price!=null?(
                <>
                  <span style={{color:"#b8c8d8",fontSize:10,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{item.price.toFixed(item.d)}</span>
                  <span style={{color:pCol,fontSize:9,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{arrow}{item.pct!=null?Math.abs(item.pct).toFixed(2)+"%":"--"}</span>
                </>
              ):<span style={{color:"#1a2a3a",fontSize:9}}>···</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CHART ────────────────────────────────────────────────────────────────────
function IndicatorToolbar({ active, onAdd, onRemove }) {
  const [showMenu,setShowMenu]=useState(false);
  const [cfg,setCfg]=useState({id:null,len:"14"});
  const startAdd =(def)=>{ setCfg({id:def.id,len:String(def.defaultLen??""),color:def.color}); setShowMenu(false); };
  const confirmAdd=()=>{
    if (!cfg.id) return;
    const def=INDICATOR_DEFS.find(d=>d.id===cfg.id);
    onAdd({...def,len:def.hasLen?parseInt(cfg.len)||def.defaultLen:null,instanceId:`${cfg.id}_${cfg.len}_${Date.now()}`});
    setCfg({id:null,len:"14"});
  };
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:"#060a0e",borderBottom:"1px solid #0a1520",flexShrink:0,flexWrap:"wrap"}}>
      {active.map(ind=>(
        <div key={ind.instanceId} style={{display:"flex",alignItems:"center",gap:4,background:"#0a1428",border:`1px solid ${ind.color}44`,borderRadius:3,padding:"2px 6px",fontSize:9}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:ind.color,display:"inline-block"}}/>
          <span style={{color:ind.color,letterSpacing:1}}>{ind.label}{ind.len?`(${ind.len})`:""}</span>
          <span onClick={()=>onRemove(ind.instanceId)} style={{color:"#2a4a6a",cursor:"pointer",marginLeft:2,fontSize:10,lineHeight:1}}>✕</span>
        </div>
      ))}
      <div style={{position:"relative"}}>
        <button onClick={()=>setShowMenu(v=>!v)} style={{background:showMenu?"#0a1828":"transparent",border:"1px solid #1a2a3a",color:"#c45a1e",padding:"2px 10px",fontSize:9,cursor:"pointer",borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}>+ INDICATOR</button>
        {showMenu&&(
          <div style={{position:"absolute",top:"100%",left:0,zIndex:200,background:"#080e14",border:"1px solid #1a2a3a",borderRadius:4,overflow:"hidden",marginTop:3,minWidth:130,boxShadow:"0 8px 24px #000a"}}>
            {INDICATOR_DEFS.map(def=>(
              <div key={def.id} onClick={()=>startAdd(def)}
                style={{padding:"6px 12px",cursor:"pointer",fontSize:10,color:"#7ec8e3",letterSpacing:1,borderBottom:"1px solid #0a1520",display:"flex",alignItems:"center",gap:8}}
                onMouseEnter={e=>e.currentTarget.style.background="#0d1e2a"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span style={{width:6,height:6,borderRadius:"50%",background:def.color,display:"inline-block",flexShrink:0}}/>
                {def.label}
                <span style={{color:"#2a4a6a",fontSize:8,marginLeft:"auto"}}>{def.pane==="sub"?"↓ pane":""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {cfg.id&&(()=>{
        const def=INDICATOR_DEFS.find(d=>d.id===cfg.id);
        return (
          <div style={{display:"flex",alignItems:"center",gap:6,background:"#0a1428",border:`1px solid ${def.color}44`,borderRadius:3,padding:"2px 8px"}}>
            <span style={{color:def.color,fontSize:9,letterSpacing:1}}>{def.label}</span>
            {def.hasLen&&<>
              <span style={{color:"#2a4a6a",fontSize:9}}>Period:</span>
              <input value={cfg.len} onChange={e=>setCfg(v=>({...v,len:e.target.value}))}
                style={{width:36,background:"#050810",border:"1px solid #1a2a3a",color:"#c45a1e",fontSize:10,padding:"1px 4px",outline:"none",fontFamily:"'JetBrains Mono',monospace",borderRadius:2}}
                onKeyDown={e=>e.key==="Enter"&&confirmAdd()}/>
            </>}
            <button onClick={confirmAdd} style={{background:"#0a1828",border:"1px solid #c45a1e44",color:"#c45a1e",padding:"1px 8px",fontSize:9,cursor:"pointer",borderRadius:2,fontFamily:"'JetBrains Mono',monospace"}}>ADD</button>
            <button onClick={()=>setCfg({id:null,len:"14"})} style={{background:"transparent",border:"none",color:"#2a4a6a",cursor:"pointer",fontSize:11,padding:"0 2px"}}>✕</button>
          </div>
        );
      })()}
    </div>
  );
}

function ChartPanel({ symbol, tf, ticks, registerChart, requestHistory, indicators }) {
  const cRef=useRef(null),subRef=useRef(null);
  const chartMain=useRef(null),chartSub=useRef(null);
  const candSer=useRef(null),volSer=useRef(null);
  const indSeries=useRef({}),candles=useRef([]);
  const bidLine=useRef(null),askLine=useRef(null);
  const [noData,setNoData]=useState(false);
  const noDataTimer=useRef(null);

  const CHART_STYLE={
    layout:{background:{type:"solid",color:"#060a0e"},textColor:"#3a6a7a",fontFamily:"'JetBrains Mono','Courier New',monospace",fontSize:10},
    grid:{vertLines:{color:"#0a1520",style:LineStyle.Dotted},horzLines:{color:"#0a1520",style:LineStyle.Dotted}},
    crosshair:{mode:CrosshairMode.Normal,vertLine:{color:"#1a3a5a",labelBackgroundColor:"#0a1828"},horzLine:{color:"#1a3a5a",labelBackgroundColor:"#0a1828"}},
    rightPriceScale:{borderColor:"#0a1520",textColor:"#3a6a7a"},
    timeScale:{borderColor:"#0a1520",timeVisible:true,secondsVisible:false,barSpacing:7,rightOffset:8},
  };

  useEffect(()=>{
    if (!cRef.current) return;
    const ch=createChart(cRef.current,{...CHART_STYLE,width:cRef.current.clientWidth,height:cRef.current.clientHeight});
    chartMain.current=ch;
    ch.applyOptions({rightPriceScale:{borderColor:"#0a1520",textColor:"#3a6a7a",scaleMargins:{top:0.08,bottom:0.12}},localization:{priceFormatter:p=>p.toFixed(symPrec(symbol))}});
    (async()=>{
      const lc=await import("lightweight-charts");
      const addSeries=(type,opts)=>lc[type]&&ch.addSeries?ch.addSeries(lc[type],opts):ch[`add${type}`]?.(opts);
      candSer.current=addSeries("CandlestickSeries",{upColor:"#c45a1e",downColor:"#ff3355",borderUpColor:"#c45a1e",borderDownColor:"#ff3355",wickUpColor:"#8c3c10",wickDownColor:"#cc2244",priceLineVisible:false,priceFormat:{type:"price",precision:symPrec(symbol),minMove:symMove(symbol)}});
      volSer.current =addSeries("HistogramSeries",{color:"#c45a1e22",priceFormat:{type:"volume"},priceScaleId:"vol",scaleMargins:{top:0.87,bottom:0}});
    })();
    const ro=new ResizeObserver(()=>{ if(cRef.current) ch.applyOptions({width:cRef.current.clientWidth,height:cRef.current.clientHeight}); });
    ro.observe(cRef.current);
    return ()=>{ ro.disconnect(); ch.remove(); };
  },[]);

  useEffect(()=>{
    if (!subRef.current) return;
    const ch=createChart(subRef.current,{...CHART_STYLE,width:subRef.current.clientWidth,height:subRef.current.clientHeight});
    chartSub.current=ch;
    const ro=new ResizeObserver(()=>{ if(subRef.current) ch.applyOptions({width:subRef.current.clientWidth,height:subRef.current.clientHeight}); });
    ro.observe(subRef.current);
    return ()=>{ ro.disconnect(); ch.remove(); };
  },[]);

  const scrollToLast=useCallback(()=>{ chartMain.current?.timeScale().scrollToRealTime(); chartSub.current?.timeScale().scrollToRealTime(); },[]);

  useEffect(()=>{
    setNoData(false);
    clearTimeout(noDataTimer.current);
    noDataTimer.current=setTimeout(()=>{ if(!candles.current.length) setNoData(true); },8000);
    return ()=>clearTimeout(noDataTimer.current);
  },[symbol,tf]);

  useEffect(()=>{
    const unregister=registerChart(symbol,tf,
      (c)=>{
        setNoData(false); clearTimeout(noDataTimer.current);
        candles.current.push(c); if(candles.current.length>500) candles.current.shift();
        candSer.current?.update({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close});
        volSer.current?.update({time:c.time,value:c.volume,color:c.close>=c.open?"#c45a1e22":"#ff335522"});
        refreshIndicators(candles.current); scrollToLast();
      },
      (hist)=>{
        if (!hist?.length) return;
        setNoData(false); clearTimeout(noDataTimer.current);
        candles.current=[...hist];
        const wait=()=>{
          if (!candSer.current) { setTimeout(wait,100); return; }
          candSer.current.setData(hist.map(r=>({time:r.time,open:r.open,high:r.high,low:r.low,close:r.close})));
          volSer.current?.setData(hist.map(r=>({time:r.time,value:r.volume,color:r.close>=r.open?"#c45a1e22":"#ff335522"})));
          chartMain.current?.timeScale().fitContent(); scrollToLast(); refreshIndicators(hist);
        };
        wait();
      }
    );
    requestHistory(symbol,tf);
    return unregister;
  },[symbol,tf,registerChart,requestHistory,scrollToLast]);

  const refreshIndicators=useCallback((data)=>{ if(!data?.length||!chartMain.current) return; indicators.forEach(ind=>drawIndicator(ind,data)); },[indicators]);
  useEffect(()=>{ if(candles.current.length) refreshIndicators(candles.current); },[indicators]);

  const drawIndicator=async(ind,data)=>{
    const lc=await import("lightweight-charts");
    const addMain=(type,opts)=>lc[type]&&chartMain.current.addSeries?chartMain.current.addSeries(lc[type],opts):chartMain.current[`add${type}`]?.(opts);
    const addSub =(type,opts)=>lc[type]&&chartSub.current?.addSeries?chartSub.current.addSeries(lc[type],opts):chartSub.current?.[`add${type}`]?.(opts);
    const old=indSeries.current[ind.instanceId];
    if (old) {
      const rm=(ch,s)=>{ try{ ch?.removeSeries(s); }catch{} };
      if (Array.isArray(old)) old.forEach(s=>{ rm(chartMain.current,s); rm(chartSub.current,s); });
      else { rm(chartMain.current,old); rm(chartSub.current,old); }
      delete indSeries.current[ind.instanceId];
    }
    const len=ind.len??14;
    if      (ind.id==="sma")    { const s=addMain("LineSeries",{color:ind.color,lineWidth:1,priceLineVisible:false,lastValueVisible:false}); s?.setData(calcSMA(data,len)); indSeries.current[ind.instanceId]=s; }
    else if (ind.id==="ema")    { const s=addMain("LineSeries",{color:ind.color,lineWidth:1,priceLineVisible:false,lastValueVisible:false}); s?.setData(calcEMA(data,len)); indSeries.current[ind.instanceId]=s; }
    else if (ind.id==="bb")     { const {mid,upper,lower}=calcBB(data,len); const sm=addMain("LineSeries",{color:ind.color+"88",lineWidth:1,priceLineVisible:false,lastValueVisible:false}); const su=addMain("LineSeries",{color:ind.color+"66",lineWidth:1,lineStyle:LineStyle.Dashed,priceLineVisible:false,lastValueVisible:false}); const sl=addMain("LineSeries",{color:ind.color+"66",lineWidth:1,lineStyle:LineStyle.Dashed,priceLineVisible:false,lastValueVisible:false}); sm?.setData(mid); su?.setData(upper); sl?.setData(lower); indSeries.current[ind.instanceId]=[sm,su,sl].filter(Boolean); }
    else if (ind.id==="vwap")   { const s=addMain("LineSeries",{color:ind.color,lineWidth:1,lineStyle:LineStyle.Dashed,priceLineVisible:false,lastValueVisible:false}); s?.setData(calcVWAP(data)); indSeries.current[ind.instanceId]=s; }
    else if (ind.id==="zscore") { const s=addSub("LineSeries",{color:ind.color,lineWidth:1.5,priceLineVisible:false,lastValueVisible:true,priceScaleId:"zscore"}); s?.setData(calcZScore(data,len)); [1.5,-1.5].forEach(v=>s?.createPriceLine({price:v,color:v>0?"#ff335566":"#c45a1e66",lineWidth:1,lineStyle:LineStyle.Dotted,axisLabelVisible:false,title:v>0?"+1.5":"-1.5"})); s?.createPriceLine({price:0,color:"#2a4a6a",lineWidth:1,lineStyle:LineStyle.Solid,axisLabelVisible:false,title:""}); indSeries.current[ind.instanceId]=s; }
    else if (ind.id==="rsi")    { const s=addSub("LineSeries",{color:ind.color,lineWidth:1.5,priceLineVisible:false,lastValueVisible:true,priceScaleId:"rsi"}); s?.setData(calcRSI(data,len)); [70,30,50].forEach((v,i)=>s?.createPriceLine({price:v,color:i===2?"#2a4a6a":"#ff6b3566",lineWidth:1,lineStyle:LineStyle.Dotted,axisLabelVisible:false,title:String(v)})); indSeries.current[ind.instanceId]=s; }
    else if (ind.id==="macd")   { const {macdLine,sigLine,hist}=calcMACD(data); const sh=addSub("HistogramSeries",{priceScaleId:"macd",scaleMargins:{top:0.1,bottom:0.1}}); const sm=addSub("LineSeries",{color:"#7ec8e3",lineWidth:1,priceScaleId:"macd",priceLineVisible:false,lastValueVisible:false}); const ss=addSub("LineSeries",{color:"#ff6b35",lineWidth:1,priceScaleId:"macd",priceLineVisible:false,lastValueVisible:false,lineStyle:LineStyle.Dashed}); sh?.setData(hist); sm?.setData(macdLine); ss?.setData(sigLine); indSeries.current[ind.instanceId]=[sh,sm,ss].filter(Boolean); }
  };

  useEffect(()=>{
    const tick=ticks[symbol]; if(!tick) return;
    const attach=()=>{
      if (!candSer.current) { setTimeout(attach,100); return; }
      try{ if(bidLine.current) candSer.current.removePriceLine(bidLine.current); }catch{}
      try{ if(askLine.current) candSer.current.removePriceLine(askLine.current); }catch{}
      bidLine.current=candSer.current.createPriceLine({price:tick.bid,color:"#c45a1e88",lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:"BID"});
      askLine.current=candSer.current.createPriceLine({price:tick.ask,color:"#ff335588",lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:"ASK"});
    };
    attach();
  },[ticks,symbol]);

  const tick  =ticks[symbol];
  const d     =symPrec(symbol);
  const spread=tick?calcSpread(symbol,tick.bid,tick.ask):"--";
  const hasSub=indicators.some(i=>i.pane==="sub");

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",position:"relative"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 12px",height:38,flexShrink:0,background:"#060a0e",borderBottom:"1px solid #0a1520"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <span style={{color:"#fff",fontWeight:700,fontSize:17,letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>{symbol}</span>
          <span style={{color:"#1a3a4a",fontSize:10,letterSpacing:1}}>{tf}</span>
          {tick&&<>
            <span style={{color:"#c45a1e",fontSize:19,fontWeight:700,fontVariantNumeric:"tabular-nums",fontFamily:"'JetBrains Mono',monospace"}}>{tick.bid?.toFixed(d)}</span>
            <span style={{color:"#8c3c10",fontSize:10}}>B&nbsp;{tick.bid?.toFixed(d)}</span>
            <span style={{color:"#cc2233",fontSize:10}}>A&nbsp;{tick.ask?.toFixed(d)}</span>
            <span style={{color:"#1a4a5a",fontSize:10}}>SPD&nbsp;{spread}</span>
          </>}
        </div>
        <button onClick={scrollToLast}
          style={{background:"transparent",border:"1px solid #1a2a3a",color:"#c45a1e44",padding:"2px 8px",fontSize:9,cursor:"pointer",borderRadius:2,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}
          onMouseEnter={e=>e.currentTarget.style.color="#c45a1e"}
          onMouseLeave={e=>e.currentTarget.style.color="#c45a1e44"}>▶▶</button>
      </div>
      {noData&&(
        <div style={{position:"absolute",inset:0,top:38,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#060a0ecc",zIndex:10,gap:10}}>
          <div style={{color:"#1a3a4a",fontSize:11,letterSpacing:3}}>NO CHART DATA</div>
          <div style={{color:"#0d2030",fontSize:9,letterSpacing:1}}>{symbol} · {tf}</div>
          <div style={{color:"#0d1828",fontSize:8}}>Symbol may not be available on your broker</div>
          <div style={{color:"#0d1828",fontSize:8}}>or MT5 bridge is not connected</div>
        </div>
      )}
      <div ref={cRef} style={{flex:hasSub?"1 1 65%":"1 1 100%",minHeight:0}}/>
      {hasSub&&<div ref={subRef} style={{flex:"1 1 35%",minHeight:0,borderTop:"1px solid #0a1520"}}/>}
    </div>
  );
}

// ─── LEFT PANEL ───────────────────────────────────────────────────────────────
function SymbolStrip({ active, ticks, openTrades, onSelect, tradedSymbols }) {
  return (
    <div style={{display:"flex",flexDirection:"column",width:88,flexShrink:0,background:"#060a0e",borderRight:"1px solid #0a1520",overflowY:"auto"}}>
      {[{label:"TRADED",syms:tradedSymbols,color:"#c45a1e"}].map(({label,syms,color})=>(
        <div key={label}>
          <div style={{padding:"4px 7px 3px",color:color+"88",fontSize:7,letterSpacing:2,background:"#04080e",borderBottom:"1px solid #0a1520",borderTop:"1px solid #0a1520",fontFamily:"'JetBrains Mono',monospace"}}>{label}</div>
          {syms.map(sym=>{
            const tick    =ticks[sym];
            const hasTrade=openTrades?.some(t=>t.symbol===sym);
            const isActive=sym===active;
            const dp      =symPrec(sym);
            return (
              <div key={sym} onClick={()=>onSelect(sym)}
                style={{padding:"7px 7px 6px",cursor:"pointer",background:isActive?"#08101a":"transparent",borderLeft:`2px solid ${isActive?color:hasTrade?"#f5c518":"transparent"}`,borderBottom:"1px solid #0a1520",transition:"background 0.15s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{color:isActive?color:hasTrade?"#f5c518":"#2a5a6a",fontSize:8,fontWeight:"bold",letterSpacing:1,fontFamily:"'JetBrains Mono',monospace"}}>{sym.length>7?sym.slice(0,7):sym}</span>
                  {hasTrade&&<span style={{fontSize:5,color:"#f5c518",animation:"pulse 2s infinite"}}>●</span>}
                </div>
                {tick&&<div style={{color:isActive?"#8c3c10":"#1a4a3a",fontSize:8,marginTop:2,fontVariantNumeric:"tabular-nums",fontFamily:"'JetBrains Mono',monospace"}}>{tick.bid?.toFixed(dp)}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function LeftPanel({ appState, ticks, pnlHistory, activeSym, setActiveSym, logRef, sessionMetrics, journeyPnl, resetJourney }) {
  const PROFIT_TARGET=40;
  const floating   =appState.floating??0;
  const equity     =appState.equity??appState.balance??0;
  const sessionPnl =sessionMetrics.total_pnl;
  const closedPnl  =sessionMetrics.closed_pnl;
  const wins       =Math.max(sessionMetrics.wins,0);
  const losses     =Math.max(sessionMetrics.losses,0);
  const total      =Math.max(wins+losses,1);
  const winRate    =(wins/total)*100;
  const wrCol      =winRate>=55?"#c45a1e":winRate>=40?"#f5c518":"#ff3355";
  const pf         =losses>0?(wins*15)/(losses*10):wins>0?999:0;
  const pfCol      =pf>=1.5?"#c45a1e":pf>=1.0?"#f5c518":"#ff3355";
  const pnlCol     =sessionPnl>=0?"#c45a1e":"#ff3355";
  const profitMade =Math.max(journeyPnl,0);
  const journeyPct =Math.min((profitMade/PROFIT_TARGET)*100,100);
  const journeyColor=journeyPct>=100?"#f5c518":journeyPnl>0?"#c45a1e":journeyPnl<0?"#ff3355":"#1a3a4a";

  return (
    <div style={{width:240,flexShrink:0,background:"#060a0e",borderRight:"1px solid #0a1520",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",flexShrink:0,borderBottom:"1px solid #0a1520"}}>
        <button style={{flex:1,padding:"8px 0",fontSize:8,letterSpacing:1.5,background:"#050a10",color:"#c45a1e",border:"none",borderBottom:"2px solid #c45a1e",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",transition:"all 0.2s"}}>ACCOUNT</button>
      </div>
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"12px 12px 10px",borderBottom:"1px solid #0a1520"}}>
          <PanelHead label="ACCOUNT"/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
            <div>
              <div style={{fontSize:22,fontWeight:700,color:"#c8d8e8",textShadow:"0 0 20px #c8d8e822",letterSpacing:1,lineHeight:1}}>${equity.toFixed(2)}</div>
              <div style={{color:"#1a3a4a",fontSize:8,letterSpacing:1,marginTop:3}}>EQUITY · USD &nbsp;<span style={{color:"#0d2a3a"}}>BAL ${(appState.balance??0).toFixed(2)}</span></div>
            </div>
            <Sparkline values={pnlHistory} color={pnlCol} width={74} height={28}/>
          </div>
          <div style={{marginTop:10,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
            <div>
              <div style={{color:pnlCol,fontSize:16,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{sessionPnl>=0?"+":""}{sessionPnl.toFixed(2)}</div>
              <div style={{color:"#1a3a4a",fontSize:7,marginTop:2,lineHeight:1.6}}>SESSION P&L<br/><span style={{color:"#0d2a3a"}}>FLOAT {floating>=0?"+":""}{floating.toFixed(2)}</span></div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{color:wrCol,fontSize:15,fontWeight:700}}>{wins+losses===0?"--":winRate.toFixed(1)+"%"}</div>
              <div style={{color:"#1a3a4a",fontSize:8}}>WIN RATE</div>
            </div>
          </div>
          <div style={{marginTop:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
              <span style={{color:"#1a3a4a",fontSize:8,letterSpacing:1}}>JOURNEY</span>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{color:journeyColor,fontSize:8,fontWeight:"bold"}}>+${profitMade.toFixed(2)} / $40 &nbsp; {journeyPct.toFixed(1)}%</span>
                <button onClick={resetJourney} title="Reset journey baseline"
                  style={{background:"transparent",border:"1px solid #1a2a3a",color:"#2a4a6a",padding:"0px 5px",fontSize:7,cursor:"pointer",borderRadius:2,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1,lineHeight:"14px"}}
                  onMouseEnter={e=>{e.currentTarget.style.color="#f5c518";e.currentTarget.style.borderColor="#f5c51844";}}
                  onMouseLeave={e=>{e.currentTarget.style.color="#2a4a6a";e.currentTarget.style.borderColor="#1a2a3a";}}>↺ RST</button>
              </div>
            </div>
            <div style={{position:"relative",background:"#090f16",height:7,borderRadius:3}}>
              <div style={{width:`${journeyPct}%`,height:"100%",borderRadius:3,background:`linear-gradient(90deg,#7a2800,${journeyColor})`,boxShadow:`2px 0 12px ${journeyColor}44`,transition:"width 1.2s ease"}}/>
              {[0,25,50,75,100].map(pct=><div key={pct} style={{position:"absolute",left:`${pct}%`,top:-2,width:1,height:11,background:pct<=journeyPct?journeyColor+"66":"#0d1f2a"}}/>)}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
              {["$0","$10","$20","$30"].map(l=><span key={l} style={{color:"#1a3a4a",fontSize:7}}>{l}</span>)}
              <span style={{color:"#f5c518aa",fontSize:7}}>$40🎯</span>
            </div>
            <div style={{marginTop:5,textAlign:"center"}}>
              <span style={{color:"#0d2a3a",fontSize:8}}>{profitMade>=PROFIT_TARGET?"🏆 TARGET HIT — SCALE UP":`$${(PROFIT_TARGET-profitMade).toFixed(2)} to target`}</span>
            </div>
          </div>
        </div>

        <div style={{padding:"10px 12px",borderBottom:"1px solid #0a1520"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <PanelHead label="PERFORMANCE"/>
            <span style={{fontSize:7,letterSpacing:1,color:"#1a3a4a",background:"#0a1520",padding:"2px 6px",borderRadius:2}}>SESSION</span>
          </div>
          <SRow label="WIN RATE"      val={wins+losses===0?"--":winRate.toFixed(1)+"%"}         color={wrCol}/>
          <SRow label="PROFIT FACTOR" val={losses===0&&wins===0?"--":pf>=999?"∞":pf.toFixed(2)} color={pfCol}/>
          <SRow label="TRADES TAKEN"  val={Math.max(sessionMetrics.taken,0)}                     color="#7ec8e3"/>
          <SRow label="SKIPPED"       val={Math.max(sessionMetrics.skipped,0)}                   color="#ff6b35"/>
          <SRow label="WINS"          val={wins}                                                  color="#c45a1e"/>
          <SRow label="LOSSES"        val={losses}                                                color="#ff3355"/>
          <SRow label="CLOSED P&L"    val={(closedPnl>=0?"+":"")+closedPnl.toFixed(2)}           color={closedPnl>=0?"#c45a1e":"#ff3355"}/>
          <SRow label="FLOATING"      val={(floating>=0?"+":"")+floating.toFixed(2)}              color={floating>=0?"#c45a1e":"#ff3355"}/>
          <SRow label="SESSION P&L"   val={(sessionPnl>=0?"+":"")+sessionPnl.toFixed(2)}         color={pnlCol}/>
          <div style={{marginTop:8}}>
            <div style={{display:"flex",height:5,borderRadius:2,overflow:"hidden",background:"#090f16"}}>
              <div style={{flex:wins,  background:"linear-gradient(90deg,#6e2000,#c45a1e)",transition:"flex 1s"}}/>
              <div style={{flex:losses,background:"linear-gradient(90deg,#7a0010,#ff3355)",transition:"flex 1s"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
              <span style={{color:"#c45a1e",fontSize:8}}>{wins}W</span>
              <span style={{color:"#ff3355",fontSize:8}}>{losses}L</span>
            </div>
          </div>
        </div>

        <div style={{padding:"10px 12px",borderBottom:"1px solid #0a1520"}}>
          <PanelHead label="LIVE PRICES"/>
          {(appState.portfolio_symbols??PORTFOLIO_SYMBOLS).map(sym=>{
            const t  =ticks[sym];
            const dp =symPrec(sym);
            const spd=t?calcSpread(sym,t.bid,t.ask):"--";
            const sectionColor=STRIP_SECTIONS.find(s=>s.syms.includes(sym))?.color??"#c45a1e";
            return (
              <div key={sym} onClick={()=>setActiveSym(sym)}
                style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid #080d12",cursor:"pointer"}}>
                <span style={{color:sym===activeSym?sectionColor:"#2a5a6a",fontSize:9,fontWeight:"bold",letterSpacing:1,width:58}}>{sym}</span>
                {t?<>
                  <span style={{color:"#a04818",fontSize:10,fontVariantNumeric:"tabular-nums"}}>{t.bid?.toFixed(dp)}</span>
                  <span style={{color:"#cc2233",fontSize:10,fontVariantNumeric:"tabular-nums"}}>{t.ask?.toFixed(dp)}</span>
                  <span style={{color:"#1a3a4a",fontSize:8}}>{spd}p</span>
                </>:<span style={{color:"#1a3a4a",fontSize:9}}>…</span>}
              </div>
            );
          })}
        </div>

        <div style={{padding:"10px 12px"}}>
          <PanelHead label="SIGNAL LOG"/>
          <div ref={logRef} style={{overflowY:"auto",maxHeight:300}}>
            {!appState.signal_log?.length?(
              <div style={{color:"#181820",fontSize:9,textAlign:"center",padding:"16px 0"}}>— Awaiting signals —</div>
            ):[...appState.signal_log].reverse().map((s,i)=>(
              <div key={i} style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap",padding:"3px 0",borderBottom:"1px solid #080d12",animation:i===0?"fadeIn 0.25s ease":undefined}}>
                <span style={{color:"#1a3a4a",fontSize:8,fontVariantNumeric:"tabular-nums",width:46}}>{s.time?.split("T")[1]?.slice(0,8)??s.time}</span>
                <span style={{color:"#fff",fontWeight:"bold",fontSize:9,width:46,letterSpacing:1}}>{s.symbol}</span>
                <span style={{color:s.direction==="LONG"?"#c45a1e":"#ff3355",fontSize:8,width:32}}>{s.direction}</span>
                <span style={{color:ACTION_COLORS[s.action]??"#666",background:(ACTION_COLORS[s.action]??"#666")+"18",border:`1px solid ${(ACTION_COLORS[s.action]??"#666")}33`,padding:"0 4px",fontSize:8,borderRadius:2,letterSpacing:1}}>{ACTION_LABELS[s.action]??s.action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RIGHT PANEL ──────────────────────────────────────────────────────────────
function NewsWidget() {
  const [activeId,setActiveId]=useState(null);
  const [muted,setMuted]=useState(true);
  const active=NEWS_CHANNELS.find(c=>c.id===activeId)??null;
  const embedUrl=active?`https://www.youtube.com/embed/${active.videoId}?autoplay=1&mute=${muted?1:0}`:null;
  const toggle=(id)=>setActiveId(prev=>prev===id?null:id);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {active&&(
        <div style={{width:"100%",aspectRatio:"16/9",background:"#04080e",border:`1px solid ${active.color}33`,borderRadius:3,overflow:"hidden",boxShadow:"0 4px 16px #000a"}}>
          <iframe key={activeId+muted} width="100%" height="100%" src={embedUrl} title={active.label}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin" allowFullScreen
            style={{border:"none",display:"block",width:"100%",height:"100%"}}/>
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",gap:0,overflowX:"auto",scrollbarWidth:"none"}}>
        {NEWS_CHANNELS.map(ch=>{
          const isOn=activeId===ch.id;
          return (
            <button key={ch.id} onClick={()=>toggle(ch.id)}
              style={{flex:"0 0 auto",background:isOn?"#0a1828":"transparent",border:`1px solid ${isOn?ch.color+"88":"#1a2a3a"}`,borderRight:"none",color:isOn?ch.color:"#2a5a6a",padding:"3px 7px",fontSize:8,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",letterSpacing:1,transition:"all 0.2s",boxShadow:isOn?`0 0 6px ${ch.color}22`:"none",whiteSpace:"nowrap"}}
              onMouseEnter={e=>{ if(!isOn){ e.currentTarget.style.color=ch.color; e.currentTarget.style.borderColor=ch.color+"44"; }}}
              onMouseLeave={e=>{ if(!isOn){ e.currentTarget.style.color="#2a5a6a"; e.currentTarget.style.borderColor="#1a2a3a"; }}}>
              {isOn?`▶ ${ch.short}`:ch.short}
            </button>
          );
        })}
        <div style={{flex:"0 0 auto",border:"1px solid #1a2a3a",borderLeft:"none",height:"100%",display:"flex",alignItems:"center",paddingRight:2}}>
          {active&&(
            <button onClick={()=>setMuted(v=>!v)}
              style={{background:"transparent",border:"none",color:muted?"#1a3a4a":"#c45a1e",padding:"3px 6px",fontSize:10,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",transition:"color 0.2s"}}
              title={muted?"Unmute":"Mute"}>{muted?"🔇":"🔊"}</button>
          )}
        </div>
      </div>
      {active&&(
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{color:active.color+"99",fontSize:7,letterSpacing:1.5}}>▶ {active.label}</span>
          <span style={{color:"#1a3a4a",fontSize:7}}>LIVE</span>
        </div>
      )}
    </div>
  );
}

function RightPanel({ appState, wsStatus, streamUrls, tradedSymbols }) {
  return (
    <div style={{width:230,flexShrink:0,background:"#060a0e",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"8px 12px 10px",borderBottom:"1px solid #0a1520",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
          <span style={{color:"#1a3a4a",fontSize:8,letterSpacing:2}}>TRADE SLOTS</span>
          <div style={{display:"flex",alignItems:"baseline",gap:4}}>
            <span style={{fontSize:16,fontWeight:700,color:appState.open_count>=appState.max_concurrent?"#ff6b35":"#c45a1e",textShadow:appState.open_count>=appState.max_concurrent?"0 0 10px #ff6b3566":"0 0 10px #c45a1e44",lineHeight:1}}>{appState.open_count}</span>
            <span style={{color:"#1e3a50",fontSize:11}}>/ {appState.max_concurrent}</span>
          </div>
        </div>
        <div style={{display:"flex",gap:3,marginBottom:10}}>
          {Array.from({length:appState.max_concurrent}).map((_,i)=>(
            <div key={i} style={{flex:1,height:3,borderRadius:1,background:i<appState.open_count?"linear-gradient(90deg,#8c3a00,#c45a1e)":"#0a1520",boxShadow:i<appState.open_count?"0 0 4px #c45a1e55":undefined,transition:"all 0.4s"}}/>
          ))}
        </div>
        <NewsWidget/>
      </div>

      <div style={{padding:"12px",flex:"1 1 auto",display:"flex",flexDirection:"column",overflow:"hidden",borderBottom:"1px solid #0a1520"}}>
        <PanelHead label="SYSTEM"/>
        {[
          {label:"MT5 API",   alive:wsStatus==="LIVE",           detail:wsStatus==="LIVE"?"CONNECTED":"OFFLINE"},
          {label:"PIPE IN",   alive:wsStatus==="LIVE",           detail:"MRV2_Signals"},
          {label:"WS BRIDGE", alive:wsStatus==="LIVE",           detail:"ws:8765"},
          {label:"BLOOMBERG", alive:!!streamUrls.bloomberg,      detail:streamUrls.bloomberg?"STREAM OK":"RESOLVING"},
        ].map(({label,alive,detail})=>(
          <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid #080d12"}}>
            <span style={{display:"flex",alignItems:"center",gap:5,color:"#1e3a50",fontSize:9}}>
              <span style={{width:5,height:5,borderRadius:"50%",display:"inline-block",flexShrink:0,background:alive?"#c45a1e":"#ff3355",boxShadow:alive?"0 0 4px #c45a1e":undefined}}/>
              {label}
            </span>
            <span style={{color:alive?"#c45a1e":"#ff3355",fontSize:8}}>{detail}</span>
          </div>
        ))}
        <div style={{marginTop:8}}>
          {(appState.symbols??tradedSymbols).map(sym=>{
            const inTrade=appState.open_trades?.some(t=>t.symbol===sym);
            const alive  =wsStatus==="LIVE";
            return (
              <div key={sym} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid #080d12"}}>
                <span style={{display:"flex",alignItems:"center",gap:5,color:"#1e3a50",fontSize:9}}>
                  <span style={{width:5,height:5,borderRadius:"50%",display:"inline-block",flexShrink:0,background:inTrade?"#f5c518":alive?"#c45a1e":"#ff3355",boxShadow:inTrade?"0 0 4px #f5c518":alive?"0 0 4px #c45a1e":undefined}}/>
                  {sym}
                </span>
                <span style={{color:inTrade?"#f5c518":alive?"#c45a1e":"#ff3355",fontSize:8}}>{inTrade?"IN TRADE":alive?"M5 LIVE":"OFFLINE"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function OCapTerminal() {
  const [tradedSymbols,    setTradedSymbols]    = useState(TRADED_SYMBOLS);
  const [portfolioSymbols, setPortfolioSymbols] = useState(PORTFOLIO_SYMBOLS);
  const { appState,wsStatus,lastUpdate,pnlHistory,ticks,indexSymbols,indexOpens,streamUrls,registerChart,requestHistory } = useLiveData(setTradedSymbols,setPortfolioSymbols);

  const [activeSym,  setActiveSym]  = useState(DEFAULT_SYMBOL);
  const [activeTf,   setActiveTf]   = useState(DEFAULT_TF);
  const [indicators, setIndicators] = useState([]);
  const [cursor,     setCursor]     = useState(true);
  const logRef = useRef(null);

  const sessionMetrics             = useSessionReset(appState);
  const { journeyPnl, resetJourney } = useJourneyReset(appState.total_pnl??0);

  useEffect(()=>{ document.title="O-Cap | Oduke Capital"; },[]);
  useEffect(()=>{ const i=setInterval(()=>setCursor(v=>!v),530); return ()=>clearInterval(i); },[]);
  useEffect(()=>{ if(logRef.current) logRef.current.scrollTop=0; },[appState.signal_log?.length]);

  const addIndicator   =(ind)=>setIndicators(p=>[...p,ind]);
  const removeIndicator=(id) =>setIndicators(p=>p.filter(i=>i.instanceId!==id));

  const lastStr=lastUpdate?.toLocaleTimeString()??"--:--:--";
  const wsConf={
    LIVE:        {color:"#c45a1e",label:"● LIVE"},
    CONNECTING:  {color:"#f5c518",label:"◌ CONNECTING"},
    DISCONNECTED:{color:"#ff3355",label:"✕ DISCONNECTED"},
  }[wsStatus]||{color:"#4a7a9b",label:"?"};

  return (
    <div style={{position:"fixed",inset:0,background:"#040810",color:"#c8d8e8",fontFamily:"'JetBrains Mono','Courier New',monospace",fontSize:11,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700&display=swap');
        @keyframes pulse  {0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes fadeIn {from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:#060a0e}
        ::-webkit-scrollbar-thumb{background:#1a3a4a;border-radius:2px}
        button:focus{outline:none} input:focus{outline:none}
      `}</style>

      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px)"}}/>

      <TopBar wsStatus={wsStatus} wsConf={wsConf} lastStr={lastStr} appState={appState}/>
      <MarketTicker ticks={ticks} indexSymbols={indexSymbols} indexOpens={indexOpens} portfolioSymbols={portfolioSymbols}/>

      {wsStatus!=="LIVE"&&(
        <div style={{flexShrink:0,background:"#160808",borderBottom:"1px solid #ff335533",borderLeft:"3px solid #ff3355",padding:"6px 16px",color:"#ff6680",fontSize:10,display:"flex",alignItems:"center",gap:10,animation:"fadeIn 0.3s"}}>
          <span style={{fontSize:14}}>⚠</span>
          {wsStatus==="CONNECTING"?`Connecting to ${WS_URL} — run: python mrv2_ws_bridge.py`:`Lost connection — auto-reconnecting…`}
        </div>
      )}

      <div style={{flex:1,minHeight:0,display:"flex",overflow:"hidden"}}>
        <LeftPanel
          appState={appState} ticks={ticks} pnlHistory={pnlHistory}
          activeSym={activeSym} setActiveSym={setActiveSym} logRef={logRef}
          sessionMetrics={sessionMetrics} journeyPnl={journeyPnl} resetJourney={resetJourney}/>

        <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",borderRight:"1px solid #0a1520"}}>
          <div style={{flexShrink:0,background:"#060a0e",borderBottom:"1px solid #0a1520"}}>
            <div style={{display:"flex",gap:3,padding:"5px 10px",borderBottom:"1px solid #0a1520"}}>
              {TIMEFRAMES.map(tf=>(
                <button key={tf} onClick={()=>setActiveTf(tf)}
                  style={{background:tf===activeTf?"#0a1828":"transparent",border:`1px solid ${tf===activeTf?"#c45a1e66":"#0d1a24"}`,color:tf===activeTf?"#c45a1e":"#1e3a50",padding:"2px 10px",fontSize:9,cursor:"pointer",borderRadius:2,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1,transition:"all 0.2s",boxShadow:tf===activeTf?"0 0 8px #c45a1e22":"none"}}>{tf}</button>
              ))}
              <div style={{flex:1}}/>
              <span style={{color:"#1a3a4a",fontSize:9,alignSelf:"center",letterSpacing:1}}>TIMEFRAME</span>
            </div>
            <IndicatorToolbar active={indicators} onAdd={addIndicator} onRemove={removeIndicator}/>
          </div>

          <div style={{flex:1,minHeight:0,display:"flex"}}>
            <SymbolStrip active={activeSym} ticks={ticks} openTrades={appState.open_trades} onSelect={setActiveSym} tradedSymbols={tradedSymbols}/>
            <div style={{flex:1,minWidth:0}}>
              <ChartPanel key={`${activeSym}_${activeTf}`} symbol={activeSym} tf={activeTf} ticks={ticks} registerChart={registerChart} requestHistory={requestHistory} indicators={indicators}/>
            </div>
          </div>

          <div style={{height:148,flexShrink:0,borderTop:"1px solid #0a1520",background:"#060a0e",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"5px 12px",borderBottom:"1px solid #0a1018",flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"#1e3a50",fontSize:8,letterSpacing:2}}>OPEN POSITIONS</span>
              <span style={{color:appState.open_count>0?"#c45a1e":"#1e3a50",fontSize:9,fontWeight:"bold"}}>{appState.open_count} / {appState.max_concurrent}</span>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{color:"#1a3040",fontSize:8,letterSpacing:1}}>
                    {["TICKET","SRC","SYMBOL","DIR","ENTRY","SL","TP","LOTS","OPENED","LIVE P&L"].map(h=>(
                      <th key={h} style={{textAlign:"left",padding:"3px 8px",borderBottom:"1px solid #090e14",fontWeight:"normal",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!appState.open_trades?.length?(
                    <tr><td colSpan={10} style={{color:"#181820",padding:"14px",textAlign:"center",fontSize:10}}>— No open positions —</td></tr>
                  ):appState.open_trades.map(t=>{
                    const livePnl=t.profit??null;
                    const pc    =livePnl==null?"#1e3a50":livePnl>=0?"#c45a1e":"#ff3355";
                    const dp    =(t.entry??0)>100?2:5;
                    const srcCol=t.source==="MANUAL"?"#f5c518":"#c45a1e";
                    return (
                      <tr key={t.ticket} style={{borderBottom:"1px solid #080d12",animation:"fadeIn 0.3s"}}>
                        <td style={{padding:"3px 8px",color:"#1e4a5a",fontSize:9}}>{t.ticket}</td>
                        <td style={{padding:"3px 8px"}}><span style={{color:srcCol,fontSize:7,background:srcCol+"18",border:`1px solid ${srcCol}33`,padding:"1px 4px",borderRadius:2}}>{t.source??"EA"}</span></td>
                        <td style={{padding:"3px 8px",color:"#fff",fontWeight:"bold",fontSize:10,letterSpacing:1}}>{t.symbol}</td>
                        <td style={{padding:"3px 8px",color:t.direction==="LONG"?"#c45a1e":"#ff3355",fontWeight:"bold"}}>{t.direction}</td>
                        <td style={{padding:"3px 8px",color:"#c8d8e8",fontVariantNumeric:"tabular-nums"}}>{t.entry?.toFixed(dp)}</td>
                        <td style={{padding:"3px 8px",color:"#ff6680",fontVariantNumeric:"tabular-nums"}}>{t.sl?.toFixed(dp)}</td>
                        <td style={{padding:"3px 8px",color:"#b85018",fontVariantNumeric:"tabular-nums"}}>{t.tp?.toFixed(dp)}</td>
                        <td style={{padding:"3px 8px",color:"#1e3a50"}}>{t.lots}</td>
                        <td style={{padding:"3px 8px",color:"#1e3a50",fontVariantNumeric:"tabular-nums"}}>{t.open_time?.split("T")[1]?.slice(0,8)??"--"}</td>
                        <td style={{padding:"3px 8px",color:pc,fontWeight:"bold",fontVariantNumeric:"tabular-nums"}}>{livePnl!=null?(livePnl>=0?"+":"")+livePnl.toFixed(2):"--"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <RightPanel appState={appState} wsStatus={wsStatus} streamUrls={streamUrls} tradedSymbols={tradedSymbols}/>
      </div>

      <div style={{height:22,flexShrink:0,background:"#060a0e",borderTop:"1px solid #0a1520",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px",color:"#1a3a4a",fontSize:9}}>
        <span>O-CAP · SMA14 · Z±1.5 · SL10p · TP15p · RR1.5 · 0.03L · 20 ASSETS</span>
        <span>FLOOR $10 · TARGET $100 · SCALE @$100</span>
        <span style={{color:wsStatus==="LIVE"?"#c45a1e":"#ff3355",fontVariantNumeric:"tabular-nums"}}>{wsStatus==="LIVE"?`● ${WS_URL}`:"RECONNECTING…"}{cursor?"▌":" "}</span>
      </div>
    </div>
  );
}