import asyncio, json, os, sys
import websockets
import MetaTrader5 as mt5
from dotenv import load_dotenv
from frontendbridge.state import state, lock
from frontendbridge.collector import start as start_collector

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from risk.sizer    import start as start_sizer
from risk.gate     import start as start_gate
from execution.bridge import start as start_bridge

load_dotenv()

LOGIN      = int(os.getenv("login"))
PASSWORD   = os.getenv("password")
SERVER     = os.getenv("server")
WS_PORT    = int(os.getenv("WS_PORT",          8765))
LOG_PREFIX = os.getenv("SERVER_LOG_PREFIX", "SERVER")
HISTORY_CANDLES  = int(os.getenv("HISTORY_CANDLES",  300))
SIGNAL_LOG_LIMIT = int(os.getenv("SIGNAL_LOG_LIMIT",  50))

_symbols           = json.loads(os.getenv("SYMBOLS",           '["EURUSD","GBPUSD","USDJPY"]'))
_portfolio_symbols = json.loads(os.getenv("PORTFOLIO_SYMBOLS", '[]'))

if not mt5.initialize(login=LOGIN, password=PASSWORD, server=SERVER):
    print(f"[{LOG_PREFIX}] MT5 init failed:", mt5.last_error())
    quit()
print(f"[{LOG_PREFIX}] MT5 connected")

TIMEFRAME_MAP = {
    "M1":  mt5.TIMEFRAME_M1,  "M5":  mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
    "H1":  mt5.TIMEFRAME_H1,  "H4":  mt5.TIMEFRAME_H4,
    "D1":  mt5.TIMEFRAME_D1,
}

def get_history(symbol, tf):
    rates = mt5.copy_rates_from_pos(symbol, TIMEFRAME_MAP.get(tf, mt5.TIMEFRAME_M5), 0, HISTORY_CANDLES)
    if rates is None:
        return []
    return [{"time": int(r["time"]), "open": r["open"], "high": r["high"],
              "low": r["low"], "close": r["close"], "volume": int(r["tick_volume"])} for r in rates]

async def handler(websocket):
    print(f"[{LOG_PREFIX}] Client connected: {websocket.remote_address}")

    async def sender():
        while True:
            with lock:
                import time as _time
                account  = state.get("account", {})
                uptime_s = int(_time.time() - state.get("uptime_start", _time.time()))
                h, rem   = divmod(uptime_s, 3600)
                m, s     = divmod(rem, 60)
                uptime   = f"{h:02d}:{m:02d}:{s:02d}"
                floating = account.get("floating", 0)
                payload  = json.dumps({
                    "type":              "STATE",
                    "ticks":             state["ticks"],
                    "signal_log":        state["signal_log"][-SIGNAL_LOG_LIMIT:],
                    "positions":         state["positions"],
                    "open_trades":       state["positions"],
                    "open_count":        len(state["positions"]),
                    "balance":           account.get("balance",  0),
                    "equity":            account.get("equity",   0),
                    "floating":          floating,
                    "closed_pnl":        state.get("closed_pnl", 0.0),
                    "total_pnl":         state.get("total_pnl",  0.0),
                    "taken":             state.get("taken",       0),
                    "skipped":           state.get("skipped",     0),
                    "wins":              state.get("wins",        0),
                    "losses":            state.get("losses",      0),
                    "max_concurrent":    state.get("max_concurrent", 5),
                    "uptime":            uptime,
                    "symbols":           _symbols,
                    "portfolio_symbols": _portfolio_symbols,
                })
            await websocket.send(payload)
            await asyncio.sleep(1)

    async def receiver():
        async for message in websocket:
            print(f"[{LOG_PREFIX}] Received: {message[:100]}")
            try:
                msg = json.loads(message)
                if msg.get("type") == "REQUEST_HISTORY":
                    symbol, tf = msg["symbol"], msg["tf"]
                    candles    = get_history(symbol, tf)
                    await websocket.send(json.dumps({
                        "type": "HISTORY", "symbol": symbol, "tf": tf, "candles": candles
                    }))
                    print(f"[{LOG_PREFIX}] History sent | {symbol} {tf} | {len(candles)} candles")
            except Exception as e:
                print(f"[{LOG_PREFIX}] Message error: {e}")

    try:
        await asyncio.gather(sender(), receiver())
    except websockets.exceptions.ConnectionClosed:
        print(f"[{LOG_PREFIX}] Client disconnected")

async def main():
    print(f"[{LOG_PREFIX}] WebSocket running on ws://localhost:{WS_PORT}")
    async with websockets.serve(handler, "0.0.0.0", WS_PORT):
        await asyncio.Future()

def run():
    start_sizer()
    start_gate()
    start_bridge()
    start_collector()
    asyncio.run(main())

if __name__ == "__main__":
    run()