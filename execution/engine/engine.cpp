#include <iostream>
#include <string>
#include <cstdlib>
#include <zmq.hpp>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

static std::string getenv_or(const char* key, const char* fallback) {
    const char* val = std::getenv(key);
    return val ? val : fallback;
}

struct Signal {
    std::string symbol, direction;
    double volume, price, sl, tp;
};

bool validate(const Signal& sig) {
    return sig.volume > 0 && sig.price > 0 && sig.sl > 0 && sig.tp > 0;
}

int main() {
    std::string pull_addr  = "tcp://127.0.0.1:" + getenv_or("ENGINE_PULL_PORT", "5556");
    std::string push_addr  = "tcp://127.0.0.1:" + getenv_or("ENGINE_PUSH_PORT", "5555");
    std::string log_prefix = "[" + getenv_or("ENGINE_LOG_PREFIX", "ENGINE") + "]";

    zmq::context_t ctx(1);

    zmq::socket_t pull(ctx, zmq::socket_type::pull);
    pull.bind(pull_addr);

    zmq::socket_t push(ctx, zmq::socket_type::push);
    push.connect(push_addr);

    std::cout << log_prefix << " Running..." << std::endl;

    while (true) {
        zmq::message_t msg;
        pull.recv(msg, zmq::recv_flags::none);

        json in = json::parse(std::string(static_cast<char*>(msg.data()), msg.size()));

        Signal sig {
            in["symbol"], in["direction"],
            in["volume"], in["price"], in["sl"], in["tp"]
        };

        if (!validate(sig)) {
            std::cout << log_prefix << " Invalid signal, dropping." << std::endl;
            continue;
        }

        std::string payload = json{
            {"symbol",    sig.symbol},
            {"direction", sig.direction},
            {"volume",    sig.volume},
            {"price",     sig.price},
            {"sl",        sig.sl},
            {"tp",        sig.tp}
        }.dump();

        push.send(zmq::message_t(payload.begin(), payload.end()), zmq::send_flags::none);
        std::cout << log_prefix << " Dispatched | " << sig.symbol << " | " << sig.direction << std::endl;
    }
}