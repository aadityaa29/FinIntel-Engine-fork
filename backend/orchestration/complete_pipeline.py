"""
backend/orchestration/complete_pipeline.py
Optimized pipeline: parallel execution, deduped logic, dead-code removed.
"""

from __future__ import annotations

import importlib
import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
TECH_MODEL_PATH = ROOT / "models" / "technical_model" / "gru_stock_classifier-2.keras"
TECH_FEATURE_PATH = ROOT / "models" / "technical_model" / "feature_columns.json"
SENTIMENT_MODEL_PATH = ROOT / "models" / "sentiment_model" / "sentiment_expert_model_v1"

_PRICE_CACHE: Dict[Tuple[str, str], pd.DataFrame] = {}
_SENTIMENT_MODEL = None
_SENTIMENT_TOKENIZER = None
_SENTIMENT_CACHE: Dict[str, Dict[str, Any]] = {}
_SENTIMENT_CACHE_TTL_HOURS = 24

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _clean_ticker(ticker: str) -> str:
    return str(ticker or "").strip().upper()


def _is_valid_number(value: object) -> bool:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return False
    return not (math.isnan(n) or math.isinf(n))


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        n = float(value)
        return default if (math.isnan(n) or math.isinf(n)) else n
    except (TypeError, ValueError):
        return default


def _to_builtin(value: Any) -> Any:
    """Recursively convert numpy/pandas scalar types to JSON-safe Python types."""
    if isinstance(value, dict):
        return {k: _to_builtin(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        converted = [_to_builtin(v) for v in value]
        return type(value)(converted)
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return 0.0
    return value


def _load_module(module_path: str):
    try:
        return importlib.import_module(module_path)
    except Exception as exc:
        logger.warning("Unable to import %s: %s", module_path, exc)
        return None


# ──────────────────────────────────────────────
# Price data
# ──────────────────────────────────────────────

_EMPTY_PRICE_DF = pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])


def _get_price_data(ticker: str, period: str = "2y") -> pd.DataFrame:
    cache_key = (_clean_ticker(ticker), period)
    if cache_key in _PRICE_CACHE:
        logger.debug("Cache hit: price data for %s", cache_key[0])
        return _PRICE_CACHE[cache_key].copy()

    logger.info("Fetching price data for %s (%s)", cache_key[0], period)

    # Try dedicated scraper first
    stock_mod = _load_module("backend.preprocessing.stock_feature_scraper")
    if stock_mod and hasattr(stock_mod, "fetch_price_data"):
        try:
            df = stock_mod.fetch_price_data(cache_key[0], period=period)
            if isinstance(df, pd.DataFrame) and not df.empty:
                _PRICE_CACHE[cache_key] = df.copy()
                return df.copy()
        except Exception as exc:
            logger.warning("stock_feature_scraper.fetch_price_data failed: %s", exc)

    # Fallback to yfinance
    try:
        yf = importlib.import_module("yfinance")
        df = yf.download(cache_key[0], period=period, progress=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df[["Open", "High", "Low", "Close", "Volume"]]
        _PRICE_CACHE[cache_key] = df.copy()
        return df.copy()
    except Exception as exc:
        logger.exception("Price fetch failed for %s: %s", cache_key[0], exc)
        return _EMPTY_PRICE_DF.copy()


# ──────────────────────────────────────────────
# Sentiment model
# ──────────────────────────────────────────────

def _load_sentiment_model():
    global _SENTIMENT_MODEL, _SENTIMENT_TOKENIZER
    if _SENTIMENT_MODEL is not None and _SENTIMENT_TOKENIZER is not None:
        return _SENTIMENT_TOKENIZER, _SENTIMENT_MODEL

    if not SENTIMENT_MODEL_PATH.exists():
        logger.info("Sentiment model path not found; using fallback scoring")
        return None, None

    try:
        transformers = importlib.import_module("transformers")
        torch = importlib.import_module("torch")
    except Exception as exc:
        logger.warning("Sentiment model dependencies unavailable: %s", exc)
        return None, None

    try:
        _SENTIMENT_TOKENIZER = transformers.AutoTokenizer.from_pretrained(str(SENTIMENT_MODEL_PATH))
        _SENTIMENT_MODEL = transformers.AutoModelForSequenceClassification.from_pretrained(
            str(SENTIMENT_MODEL_PATH)
        )
        _SENTIMENT_MODEL.eval()
        _SENTIMENT_MODEL.to(torch.device("cpu"))
        logger.info("Loaded sentiment model from %s", SENTIMENT_MODEL_PATH)
        return _SENTIMENT_TOKENIZER, _SENTIMENT_MODEL
    except Exception as exc:
        logger.warning("Failed to load sentiment model: %s", exc)
        _SENTIMENT_MODEL = _SENTIMENT_TOKENIZER = None
        return None, None


def _fallback_sentiment_score(text: str) -> float:
    lower = text.lower()
    pos = sum(w in lower for w in ["beat", "bull", "buy", "growth", "gain", "up", "profit", "strong", "surge"])
    neg = sum(w in lower for w in ["bear", "sell", "loss", "down", "risk", "drop", "weak", "concern", "miss"])
    return float(np.clip(0.5 + 0.1 * (pos - neg), 0.0, 1.0))


def _score_sentiment_texts(texts: List[str]) -> List[float]:
    texts = [t.strip() for t in map(str, texts) if t.strip()]
    if not texts:
        return []

    tokenizer, model = _load_sentiment_model()
    if tokenizer is None or model is None:
        return [_fallback_sentiment_score(t) for t in texts]

    torch = importlib.import_module("torch")
    scores: List[float] = []

    # Batch tokenization for speed
    try:
        inputs = tokenizer(texts, return_tensors="pt", truncation=True,
                           max_length=128, padding=True)
        with torch.no_grad():
            logits = model(**inputs).logits
            probs = torch.softmax(logits, dim=-1).cpu().numpy()
            # [neg=0, neutral=1, pos=2]
            scores = (probs[:, 2] * 1.0 + probs[:, 1] * 0.5 + probs[:, 0] * 0.0).tolist()
    except Exception as exc:
        logger.warning("Batch sentiment scoring failed, falling back item-by-item: %s", exc)
        for text in texts:
            try:
                inp = tokenizer(text, return_tensors="pt", truncation=True, max_length=128)
                with torch.no_grad():
                    logits = model(**inp).logits[0]
                    p = torch.softmax(logits, dim=0).cpu().numpy()
                    scores.append(float(p[2] * 1.0 + p[1] * 0.5 + p[0] * 0.0))
            except Exception:
                scores.append(_fallback_sentiment_score(text))

    return scores


# ──────────────────────────────────────────────
# Sentiment cache
# ──────────────────────────────────────────────

def _get_cached_sentiment(ticker: str) -> Optional[Dict[str, Any]]:
    entry = _SENTIMENT_CACHE.get(ticker)
    if not entry:
        return None
    ts = entry.get("timestamp")
    if not isinstance(ts, datetime):
        return None
    if datetime.now(timezone.utc) - ts > timedelta(hours=_SENTIMENT_CACHE_TTL_HOURS):
        return None
    return entry


def _store_sentiment_cache(ticker: str, sentiment_score: float,
                            num_articles: int, news_volume_score: float) -> None:
    _SENTIMENT_CACHE[ticker] = {
        "sentiment_score": float(sentiment_score),
        "num_articles": int(num_articles),
        "news_volume_score": float(news_volume_score),
        "timestamp": datetime.now(timezone.utc),
    }


def _compute_news_volume_score(num_articles: int) -> float:
    return float(np.clip(num_articles / 20.0, 0.0, 1.0)) if num_articles > 0 else 0.0


# ──────────────────────────────────────────────
# Individual analysis steps
# ──────────────────────────────────────────────

def get_technical_result(ticker: str) -> dict:
    """Fetch price data and run the technical model."""
    cleaned = _clean_ticker(ticker)
    logger.info("Technical analysis: %s", cleaned)

    price_df = _get_price_data(cleaned)
    if price_df.empty:
        logger.warning("No price data for technical analysis: %s", cleaned)
        return {"technical_score": 0.5, "signal": "HOLD", "confidence": "low"}

    # Try dedicated model runner
    stock_mod = _load_module("backend.preprocessing.stock_feature_scraper")
    if stock_mod and hasattr(stock_mod, "run_technical_model"):
        try:
            result = stock_mod.run_technical_model(price_df)
            if isinstance(result, dict):
                logger.info("Technical model completed: %s", cleaned)
                return result
        except Exception as exc:
            logger.exception("Technical model failed for %s: %s", cleaned, exc)

    # MA crossover fallback
    try:
        close = price_df["Close"]
        ma20 = close.rolling(20).mean().iloc[-1]
        ma50 = close.rolling(50).mean().iloc[-1]
        diff_pct = abs(ma20 - ma50) / (ma50 + 1e-9)
        score = float(np.clip(0.5 + np.sign(ma20 - ma50) * 0.25, 0.0, 1.0))
        signal = "BUY" if ma20 > ma50 else ("SELL" if ma20 < ma50 else "HOLD")
        confidence = "high" if diff_pct > 0.01 else "medium"
        logger.info("Technical fallback completed: %s", cleaned)
        return {"technical_score": score, "signal": signal, "confidence": confidence}
    except Exception as exc:
        logger.exception("Technical fallback failed for %s: %s", cleaned, exc)
        return {"technical_score": 0.5, "signal": "HOLD", "confidence": "low"}


def get_sentiment_result(ticker: str) -> dict:
    """Fetch news, score each item, and aggregate sentiment."""
    cleaned = _clean_ticker(ticker)
    logger.info("Sentiment analysis: %s", cleaned)

    cached = _get_cached_sentiment(cleaned)

    news_mod = _load_module("backend.scraper.news_scraper")
    if news_mod is None or not hasattr(news_mod, "get_news"):
        logger.warning("News scraper unavailable for %s", cleaned)
        return {"sentiment_score": 0.5, "num_articles": 0, "news_volume_score": 0.0, "used_cache": False}

    try:
        news_items = news_mod.get_news(cleaned) or []
    except Exception as exc:
        logger.exception("News fetch failed for %s: %s", cleaned, exc)
        return {"sentiment_score": 0.5, "num_articles": 0, "news_volume_score": 0.0, "used_cache": False}

    texts = [str(item.get("text", "")).strip() for item in news_items
             if isinstance(item, dict) and str(item.get("text", "")).strip()]

    def _cached_fallback(label: str) -> dict:
        if cached:
            logger.info("%s for %s; reusing cached sentiment", label, cleaned)
            return {
                "sentiment_score": float(cached["sentiment_score"]),
                "num_articles": int(cached["num_articles"]),
                "news_volume_score": float(cached.get("news_volume_score", 0.0)),
                "used_cache": True,
            }
        logger.info("%s for %s; using neutral fallback", label, cleaned)
        return {"sentiment_score": 0.5, "num_articles": 0, "news_volume_score": 0.0, "used_cache": False}

    if not texts:
        return _cached_fallback("No sentiment texts")

    scores = _score_sentiment_texts(texts)
    if not scores:
        return _cached_fallback("Empty sentiment scores")

    base_score = float(np.mean(scores))
    volume_score = _compute_news_volume_score(len(texts))
    sentiment_score = float(np.clip(0.75 * base_score + 0.25 * volume_score, 0.0, 1.0))

    _store_sentiment_cache(cleaned, sentiment_score, len(texts), volume_score)
    logger.info("Sentiment completed for %s: %.4f (%d articles)", cleaned, sentiment_score, len(texts))

    return {
        "sentiment_score": sentiment_score,
        "num_articles": len(texts),
        "news_volume_score": volume_score,
        "used_cache": False,
    }


def get_fundamental_result(ticker: str) -> dict:
    """Fetch financial data and run the fundamental pipeline."""
    cleaned = _clean_ticker(ticker)
    logger.info("Fundamental analysis: %s", cleaned)

    fin_mod = _load_module("backend.scraper.fundamental_financial_scraper")
    fund_mod = _load_module("backend.aggregation.fundamentalFunctions.fundamental_models")

    financial_data: Dict[str, Any] = {}
    if fin_mod and hasattr(fin_mod, "get_financial_data"):
        try:
            financial_data = fin_mod.get_financial_data(cleaned)
        except Exception as exc:
            logger.exception("Financial data fetch failed for %s: %s", cleaned, exc)

    if fund_mod is None or not hasattr(fund_mod, "run_full_fundamental_pipeline"):
        logger.warning("Fundamental pipeline unavailable for %s", cleaned)
        return {"fundamental_score": 0.0, "risk_score": 0.0, "details": {}}

    price_df = _get_price_data(cleaned)
    returns = (
        price_df["Close"].pct_change().dropna().to_numpy(dtype=np.float64)
        if not price_df.empty and "Close" in price_df.columns
        else np.array([], dtype=np.float64)
    )

    try:
        pipeline_result = fund_mod.run_full_fundamental_pipeline(financial_data, returns)
    except Exception as exc:
        logger.exception("Fundamental pipeline failed for %s: %s", cleaned, exc)
        return {"fundamental_score": 0.0, "risk_score": 0.0, "details": {}}

    fundamental_score = _safe_float(pipeline_result.get("fundamental", {}).get("fundamental_score", 0.0))
    risk_score = _safe_float(pipeline_result.get("risk", {}).get("risk_score", 0.0))

    logger.info("Fundamental completed: %s", cleaned)
    return {
        "fundamental_score": fundamental_score,
        "risk_score": risk_score,
        "details": _to_builtin(pipeline_result),
    }


# ──────────────────────────────────────────────
# Fusion
# ──────────────────────────────────────────────

def fuse_and_decide(tech: dict, fund: dict, senti: dict, risk: dict) -> Tuple[float, str]:
    tech_score  = _safe_float(tech.get("technical_score"),   0.5)
    fund_score  = _safe_float(fund.get("fundamental_score"), 0.0)
    senti_score = _safe_float(senti.get("sentiment_score"),  0.5)
    risk_score  = _safe_float(risk.get("risk_score"),        0.0)

    # High risk penalises the final score
    risk_penalty = 1.0 - risk_score

    # Amplify extreme sentiment
    if senti_score > 0.7:
        senti_score = min(1.0, senti_score + 0.1)
    elif senti_score < 0.3:
        senti_score = max(0.0, senti_score - 0.1)

    final_score = float(np.clip(
        0.35 * tech_score +
        0.35 * fund_score +
        0.25 * senti_score +
        0.05 * risk_penalty,
        0.0, 1.0
    ))

    if final_score >= 0.70:
        decision = "BUY"
    elif final_score >= 0.45:
        decision = "HOLD"
    else:
        decision = "SELL"

    # News override for extreme sentiment
    if senti_score < 0.25:
        decision = "SELL (Negative News Impact)"
    elif senti_score > 0.75:
        decision = "BUY (Positive News Momentum)"

    return final_score, decision


# ──────────────────────────────────────────────
# Complete pipeline (parallel)
# ──────────────────────────────────────────────

def _extract_risk(fundamental: dict) -> dict:
    details = fundamental.get("details", {})
    risk_block = details.get("risk", {}) if isinstance(details, dict) else {}
    risk_score = _safe_float(
        risk_block.get("risk_score") if isinstance(risk_block, dict) else None,
        _safe_float(fundamental.get("risk_score", 0.0))
    )
    return {"risk_score": risk_score, "details": risk_block}


def run_complete_pipeline(ticker: str) -> dict:
    """Run the full analysis pipeline for a ticker, with parallel I/O steps."""
    cleaned = _clean_ticker(ticker)
    logger.info("Pipeline start: %s", cleaned)

    # Pre-fetch price data once so all sub-steps hit the cache
    _get_price_data(cleaned)

    defaults = {
        "technical":  {"technical_score": 0.5, "signal": "HOLD", "confidence": "low"},
        "sentiment":  {"sentiment_score": 0.5, "num_articles": 0, "news_volume_score": 0.0},
        "fundamental": {"fundamental_score": 0.0, "risk_score": 0.0, "details": {}},
    }

    steps = {
        "technical":   lambda: get_technical_result(cleaned),
        "sentiment":   lambda: get_sentiment_result(cleaned),
        "fundamental": lambda: get_fundamental_result(cleaned),
    }

    results: Dict[str, dict] = dict(defaults)

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fn): key for key, fn in steps.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
            except Exception as exc:
                logger.exception("Step '%s' failed for %s: %s", key, cleaned, exc)

    technical   = results["technical"]
    sentiment   = results["sentiment"]
    fundamental = results["fundamental"]
    risk        = _extract_risk(fundamental)

    try:
        final_score, decision = fuse_and_decide(technical, fundamental, sentiment, risk)
    except Exception as exc:
        logger.exception("Fusion failed for %s: %s", cleaned, exc)
        final_score, decision = 0.0, "SELL"

    logger.info("Pipeline done: %s → %s (%.4f)", cleaned, decision, final_score)

    return _to_builtin({
        "ticker":      cleaned,
        "technical":   technical,
        "sentiment":   sentiment,
        "fundamental": fundamental,
        "risk":        risk,
        "final_score": float(final_score),
        "decision":    decision,
    })


__all__ = [
    "get_technical_result",
    "get_sentiment_result",
    "get_fundamental_result",
    "fuse_and_decide",
    "run_complete_pipeline",
]