import zmq
import json

def send_test_signal():
    context = zmq.Context()
    socket = context.socket(zmq.PUSH)
    socket.connect("tcp://127.0.0.1:5556")

    signal = {
        "symbol":    "EURUSD",
        "direction": "buy",
        "volume":    0.01,
        "price":     1.0850,
        "sl":        1.0800,
        "tp":        1.0900
    }

    socket.send_json(signal)
    print(f"Test signal sent: {signal}")

    socket.close()
    context.term()

if __name__ == "__main__":
    send_test_signal()