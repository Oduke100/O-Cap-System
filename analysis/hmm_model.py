import numpy as np
from hmmlearn import hmm

def build_features(data):
    return np.array([(d["Bid"] + d["Ask"]) / 2 for d in data]).reshape(-1, 1)

def fit(data, n_states):
    X     = build_features(data)
    model = hmm.GaussianHMM(n_components=n_states, covariance_type="full", n_iter=100)
    model.fit(X)
    for i in range(n_states):
        if model.transmat_[i].sum() == 0:
            model.transmat_[i] = np.ones(n_states) / n_states
    return model

def predict(model, data):
    return model.predict(build_features(data))