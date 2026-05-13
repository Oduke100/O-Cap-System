import zmq, json, os, threading
import datetime
import MetaTrader5 as mt5
from dotenv import load_dotenv

load_dotenv()

LOGIN         = int(os.getenv("login"))
PASSWORD      = os.getenv("password")
SERVER        = os.getenv("server")
GATE_PORT     = int(os.getenv("GATE_PORT",     5558))
BRIDGE_PORT   = int(os.getenv("BRIDGE_PORT",   5555))
GATE_PUB_PORT = int(os.getenv("GATE_PUB_PORT", 5561))
LOG_PREFIX    = os.getenv("GATE_LOG_PREFIX",   "GATE")
MAX_POSITIONS = int(os.getenv("MAX_POSITIONS",  1))

ctx = zmq.Context()
pub = ctx.socket(zmq.PUB)
pub.bind(f"tcp://127.0.0.1:{GATE_PUB_PORT}")

def get_open_positions(symbol):
    positions = mt5.positions_get(symbol=symbol)
    return 0 if positions is None else len(positions)

def run():
    if not mt5.initialize(login=LOGIN, password=PASSWORD, server=SERVER):
        print(f"[{LOG_PREFIX}] MT5 init failed:", mt5.last_error())
        return
    print(f"[{LOG_PREFIX}] MT5 connected")

    pull = ctx.socket(zmq.PULL)
    pull.bind(f"tcp://127.0.0.1:{GATE_PORT}")
    push = ctx.socket(zmq.PUSH)
    push.connect(f"tcp://127.0.0.1:{BRIDGE_PORT}")
    print(f"[{LOG_PREFIX}] Running — max {MAX_POSITIONS} position(s) per symbol")

    while True:
        signal     = json.loads(pull.recv_string())
        symbol     = signal["symbol"]
        open_count = get_open_positions(symbol)
        now        = datetime.datetime.now().isoformat()

        if open_count >= MAX_POSITIONS:
            print(f"[{LOG_PREFIX}] REJECTED | {symbol} | {open_count} open position(s)")
            pub.send_string(json.dumps({
                "symbol":    symbol,
                "direction": signal.get("direction"),
                "action":    "REJECTED",
                "reason":    f"{open_count} position(s) open",
                "time":      now,
            }))
            continue

        push.send_string(json.dumps(signal))
        print(f"[{LOG_PREFIX}] APPROVED | {symbol} | {signal['direction']} | vol={signal['volume']}")
        pub.send_string(json.dumps({
            "symbol":    symbol,
            "direction": signal.get("direction"),
            "action":    "APPROVED",
            "volume":    signal.get("volume"),
            "time":      now,
        }))

def start():
    threading.Thread(target=run, daemon=True).start()

if __name__ == "__main__":
    run()