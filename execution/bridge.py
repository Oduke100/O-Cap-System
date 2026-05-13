import zmq, os, threading
from dotenv import load_dotenv
try:
    from .sender import send_order
except ImportError:
    from sender import send_order

load_dotenv()

BRIDGE_PORT = int(os.getenv("BRIDGE_PORT",         5555))
LOG_PREFIX  = os.getenv("BRIDGE_LOG_PREFIX",    "BRIDGE")

def run():
    socket = zmq.Context().socket(zmq.PULL)
    socket.bind(f"tcp://127.0.0.1:{BRIDGE_PORT}")
    print(f"[{LOG_PREFIX}] Listening on port {BRIDGE_PORT}...")

    while True:
        msg = socket.recv_json()
        print(f"[{LOG_PREFIX}] Signal received | {msg['symbol']} | {msg['direction'].upper()}")
        send_order(msg["symbol"], msg["direction"], msg["volume"], msg["price"], msg["sl"], msg["tp"])

def start():
    threading.Thread(target=run, daemon=True).start()

if __name__ == "__main__":
    run()