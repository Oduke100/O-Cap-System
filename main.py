from data.stream import stream
from nodes.mean_reverting import run_node as mr_node
from nodes.sma_crossover import run_node as sma_node
import zmq, json, os
from dotenv import load_dotenv

load_dotenv()

SIZER_PORT      = int(os.getenv("SIZER_PORT"))
STREAM_PUB_PORT = int(os.getenv("STREAM_PUB_PORT"))

ctx = zmq.Context()

push = ctx.socket(zmq.PUSH)
push.connect(f"tcp://127.0.0.1:{SIZER_PORT}")

pub = ctx.socket(zmq.PUB)
pub.bind(f"tcp://127.0.0.1:{STREAM_PUB_PORT}")

def dispatch(data, symbol, price, structure):
    pub.send_string(json.dumps({"symbol": symbol, "bid": price, "ask": price}))
    mr_node(data, symbol, price, structure, push)
    sma_node(data, symbol, price, structure, push)

if __name__ == "__main__":
    stream(dispatch)