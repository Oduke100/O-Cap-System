import zmq, json, os, threading, time
import MetaTrader5 as mt5
from dotenv import load_dotenv
from frontendbridge.state import state, lock

load_dotenv()

LOGIN              = int(os.getenv("login"))
PASSWORD           = os.getenv("password")
SERVER             = os.getenv("server")
STREAM_PUB_PORT    = int(os.getenv("STREAM_PUB_PORT",       5560))
GATE_PUB_PORT      = int(os.getenv("GATE_PUB_PORT",         5561))
LOG_PREFIX         = os.getenv("COLLECTOR_LOG_PREFIX", "COLLECTOR")
SIGNAL_LOG_MAX     = int(os.getenv("SIGNAL_LOG_MAX",          100))
POLL_INTERVAL      = int(os.getenv("POLL_INTERVAL",             5))
_portfolio_symbols = json.loads(os.getenv("PORTFOLIO_SYMBOLS",  '[]'))

def collect_ticks():
    sub = zmq.Context().socket(zmq.SUB)
    sub.connect(f"tcp://127.0.0.1:{STREAM_PUB_PORT}")
    sub.setsockopt_string(zmq.SUBSCRIBE, "")
    print(f"[{LOG_PREFIX}] Listening for ticks...")
    while True:
        tick = json.loads(sub.recv_string())
        with lock:
            state["ticks"][tick["symbol"]] = {"bid": tick["bid"], "ask": tick["ask"]}

def collect_signals():
    sub = zmq.Context().socket(zmq.SUB)
    sub.connect(f"tcp://127.0.0.1:{GATE_PUB_PORT}")
    sub.setsockopt_string(zmq.SUBSCRIBE, "")
    print(f"[{LOG_PREFIX}] Listening for gate decisions...")
    while True:
        signal = json.loads(sub.recv_string())
        with lock:
            state["signal_log"].append(signal)
            if len(state["signal_log"]) > SIGNAL_LOG_MAX:
                state["signal_log"].pop(0)
            action = signal.get("action", "")
            if action == "TAKEN":
                state["taken"] += 1
            elif action in ("SKIPPED_FULL", "SKIPPED_ASSET", "ORDER_FAILED"):
                state["skipped"] += 1

def collect_positions():
    if not mt5.initialize(login=LOGIN, password=PASSWORD, server=SERVER):
        print(f"[{LOG_PREFIX}] MT5 init failed:", mt5.last_error())
        return
    print(f"[{LOG_PREFIX}] MT5 connected, polling positions...")
    prev_tickets = set()
    while True:
        positions = mt5.positions_get() or []
        curr_tickets = {p.ticket for p in positions}

        # detect closed positions since last poll
        closed_tickets = prev_tickets - curr_tickets
        if closed_tickets:
            deals = mt5.history_deals_get_group("*") or []
            for deal in deals:
                if deal.position_id in closed_tickets:
                    with lock:
                        if deal.profit > 0:
                            state["wins"]       += 1
                            state["closed_pnl"] += deal.profit
                            state["total_pnl"]  += deal.profit
                        elif deal.profit < 0:
                            state["losses"]     += 1
                            state["closed_pnl"] += deal.profit
                            state["total_pnl"]  += deal.profit

        prev_tickets = curr_tickets
        with lock:
            state["positions"] = [
                {
                    "ticket":    p.ticket,
                    "symbol":    p.symbol,
                    "direction": "LONG" if p.type == 0 else "SHORT",
                    "entry":     p.price_open,
                    "sl":        p.sl,
                    "tp":        p.tp,
                    "lots":      p.volume,
                    "profit":    p.profit,
                    "open_time": str(p.time),
                }
                for p in positions
            ]
        time.sleep(POLL_INTERVAL)

def collect_account():
    while True:
        info = mt5.account_info()
        if info:
            with lock:
                state["account"] = {
                    "balance":  info.balance,
                    "equity":   info.equity,
                    "floating": info.profit,
                }
                state["total_pnl"]  = info.profit
        time.sleep(POLL_INTERVAL)

def collect_portfolio_ticks():
    print(f"[{LOG_PREFIX}] Polling portfolio ticks for {_portfolio_symbols}...")
    while True:
        for sym in _portfolio_symbols:
            tick = mt5.symbol_info_tick(sym)
            if tick:
                with lock:
                    state["ticks"][sym] = {"bid": tick.bid, "ask": tick.ask}
        time.sleep(POLL_INTERVAL)

def start():
    for target in [collect_ticks, collect_signals, collect_positions,
                   collect_account, collect_portfolio_ticks]:
        threading.Thread(target=target, daemon=True).start()