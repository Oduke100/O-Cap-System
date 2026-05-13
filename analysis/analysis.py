import numpy as np
from statsmodels.tsa.stattools import adfuller
from statsmodels.regression.linear_model import OLS
from statsmodels.tools import add_constant

def hurst_exponent(series):
    lags = range(2, 100)
    tau  = [np.std(np.subtract(series[lag:], series[:-lag])) for lag in lags]
    return np.polyfit(np.log(lags), np.log(tau), 1)[0]

def adf_test(series):
    return adfuller(series, autolag="AIC")[1]

def variance_ratio(series, lag=5):
    returns     = np.diff(np.log(series))
    var1        = np.var(returns, ddof=1)
    returns_lag = np.array([np.sum(returns[i:i+lag]) for i in range(len(series) - lag)])
    return (np.var(returns_lag, ddof=1) / lag) / var1

def autocorrelation(series, lag=1):
    returns = np.diff(np.log(series))
    return np.corrcoef(returns[:-lag], returns[lag:])[0, 1]

def half_life(series):
    price = np.array(series)
    model = OLS(np.diff(price), add_constant(price[:-1])).fit()
    return -np.log(2) / model.params[1]