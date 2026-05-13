import os, json, time, threading
import yfinance as yf
import MetaTrader5 as mt5
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from analysis.regime import classify
from analysis.microstructure import classify_structure

load_dotenv()

LOGIN      = int(os.getenv("login"))
PASSWORD   = os.getenv("password")
SERVER     = os.getenv("server")
DATA_SOURCE      = os.getenv("DATA_SOURCE",       "mt5").lower()
N_STATES         = int(os.getenv("NUMBER_OF_STATES"))
LOG_PREFIX       = os.getenv("STREAM_LOG_PREFIX", "STREAM")
PRELOAD_CANDLES  = int(os.getenv("PRELOAD_CANDLES",       100))
EAT_OFFSET_HOURS = int(os.getenv("EAT_OFFSET_HOURS",        3))
EAT              = timezone(timedelta(hours=EAT_OFFSET_HOURS))

TIMEFRAME_MAP = {
    "M1": mt5.TIMEFRAME_M1,  "M5":  mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,  "H4":  mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
}
TIMEFRAME_SECONDS = {
    "M1": 60,   "M5": 300,  "M15": 900,
    "M30": 1800, "H1": 3600, "H4": 14400, "D1": 86400,
}
TF_STR    = os.getenv("TIMEFRAME", "M5")
TIMEFRAME = TIMEFRAME_MAP.get(TF_STR, mt5.TIMEFRAME_M5)

SOURCE_SYMBOL_MAP = {
    "mt5":      "SYMBOLS",
    "yfinance": "YFINANCE_SYMBOLS",
    "binance":  "BINANCE_SYMBOLS",
}
symbols = json.loads(os.getenv(SOURCE_SYMBOL_MAP.get(DATA_SOURCE, "SYMBOLS"), "[]"))

data = []

if DATA_SOURCE == "mt5":
    if not mt5.initialize(login=LOGIN, password=PASSWORD, server=SERVER):
        print(f"[{LOG_PREFIX}] MT5 init failed:", mt5.last_error())
        quit()
    print(f"[{LOG_PREFIX}] MT5 connected")

def _make_candle(s, time_ts, bid, ask, source):
    return {
        "Ticker": s,
        "Time":   datetime.fromtimestamp(time_ts, tz=timezone.utc).astimezone(EAT).replace(tzinfo=None),
        "Bid":    bid,
        "Ask":    ask,
        "Source": source,
    }

def preload_mt5(s):
    rates = mt5.copy_rates_from_pos(s, TIMEFRAME, 0, PRELOAD_CANDLES)
    if rates is None:
        return
    for r in rates:
        data.append(_make_candle(s, r["time"], r["open"], r["close"], "mt5"))
    print(f"[{LOG_PREFIX}] Preloaded {len(rates)} candles for {s}")

def preload_yfinance(s):
    try:
        hist = yf.Ticker(s).history(period="1d", interval="5m").tail(PRELOAD_CANDLES)
        for ts, row in hist.iterrows():
            data.append({"Ticker": s, "Time": ts.to_pydatetime(),
                         "Bid": row["Open"], "Ask": row["Close"], "Source": "yfinance"})
        print(f"[{LOG_PREFIX}] Preloaded {len(hist)} candles for {s}")
    except Exception as e:
        print(f"[{LOG_PREFIX}] yfinance preload failed for {s}: {e}")

def preload():
    print(f"[{LOG_PREFIX}] Preloading history...")
    for s in symbols:
        preload_mt5(s) if DATA_SOURCE == "mt5" else preload_yfinance(s)
    print(f"[{LOG_PREFIX}] Preload complete. {len(data)} total ticks loaded.")

def get_tick_mt5(s):
    rates = mt5.copy_rates_from_pos(s, TIMEFRAME, 0, 1)
    if rates and len(rates) > 0:
        r = rates[0]
        return _make_candle(s, r["time"], r["open"], r["close"], "mt5")
    return None

def get_tick_yfinance(s):
    try:
        hist = yf.Ticker(s).history(period="1d", interval="1m").tail(2)
        row  = hist.iloc[0]
        return {"Ticker": s, "Time": hist.index[0].to_pydatetime(),
                "Bid": round(row["Open"], 4), "Ask": round(row["Close"], 4), "Source": "yfinance"}
    except Exception as e:
        print(f"[{LOG_PREFIX}] yfinance failed for {s}: {e}")
        return None

def get_tick_binance(s):
    import websocket
    def on_message(ws, message):
        msg = json.loads(message)
        data.append({"Ticker": s, "Time": datetime.now(),
                     "Bid": float(msg["b"]), "Ask": float(msg["a"]), "Source": "binance"})
    threading.Thread(
        target=websocket.WebSocketApp(f"wss://stream.binance.com:9443/ws/{s.lower()}@bookTicker",
                                      on_message=on_message).run_forever,
        daemon=True
    ).start()

def get_tick(s):
    if DATA_SOURCE == "mt5":
        tick = get_tick_mt5(s)
        if tick:
            return tick
        print(f"[{LOG_PREFIX}] {s} not in MT5, falling back to yfinance...")
        return get_tick_yfinance(s)
    if DATA_SOURCE == "yfinance": return get_tick_yfinance(s)
    if DATA_SOURCE == "binance":  return get_tick_binance(s)
    print(f"[{LOG_PREFIX}] Unknown DATA_SOURCE: {DATA_SOURCE}")
    return None

def sleep_until_next_candle():
    bar = TIMEFRAME_SECONDS.get(TF_STR, 300)
    now = datetime.utcnow()
    elapsed = now.hour * 3600 + now.minute * 60 + now.second + now.microsecond / 1_000_000
    time.sleep(bar - (elapsed % bar))

def stream(dispatcher=None):
    preload()
    try:
        while True:
            for s in symbols:
                tick = get_tick(s)
                if not tick:
                    print(f"[{LOG_PREFIX}] Failed to load tick for {s}")
                    continue
                data.append(tick)
                state = classify(data, N_STATES)
                if state is None:
                    continue
                structure = classify_structure([d["Bid"] for d in data if d["Ticker"] == s])
                print(
                    f"[{LOG_PREFIX}] {tick['Ticker']} | {tick['Time']} | "
                    f"Open: {tick['Bid']:.4f} | Close: {tick['Ask']:.4f} | "
                    f"Regime: {state} | Structure: {structure} | Source: {tick['Source']}"
                )
                if dispatcher:
                    dispatcher(data, s, tick["Bid"], structure)
            sleep_until_next_candle()
    except KeyboardInterrupt:
        print(f"[{LOG_PREFIX}] Shutting down!")