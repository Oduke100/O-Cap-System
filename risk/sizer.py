import zmq, json, os, sys, threading
import MetaTrader5 as mt5
from dotenv import load_dotenv

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from risk.order_sizing import size_order

load_dotenv()

LOGIN      = int(os.getenv("login"))
PASSWORD   = os.getenv("password")
SERVER     = os.getenv("server")
SIZER_PORT = int(os.getenv("SIZER_PORT"))
GATE_PORT  = int(os.getenv("GATE_PORT"))
LOG_PREFIX = os.getenv("SIZER_LOG_PREFIX", "SIZER")

def run():
    if not mt5.initialize(login=LOGIN, password=PASSWORD, server=SERVER):
        print(f"[{LOG_PREFIX}] MT5 init failed:", mt5.last_error())
        return
    print(f"[{LOG_PREFIX}] MT5 connected")

    ctx  = zmq.Context()
    pull = ctx.socket(zmq.PULL)
    pull.bind(f"tcp://127.0.0.1:{SIZER_PORT}")
    push = ctx.socket(zmq.PUSH)
    push.connect(f"tcp://127.0.0.1:{GATE_PORT}")
    print(f"[{LOG_PREFIX}] Running...")

    while True:
        signal = json.loads(pull.recv_string())
        sized  = size_order(signal)
        push.send_string(json.dumps(sized))
        print(f"[{LOG_PREFIX}] {sized['symbol']} | {sized['direction']} | vol={sized['volume']}")

def start():
    threading.Thread(target=run, daemon=True).start()

if __name__ == "__main__":
    run()