"""
llm_filter_worker.py - 주식 자동매매 비동기 거시 LLM 리스크 관리자 (Chief Risk Officer)
- 1시간 주기(환경변수 LLM_FILTER_INTERVAL_SEC, 기본 3600초)로 실행 (하루 총 5~7회)
- 코스피/코스닥 지수 (20일선 이격도), 원/달러 환율, 최신 주요 증시 뉴스 20건 종합 수집
- Gemini API를 호출하여 거시 시장 체제 판정 및 트레이딩 봇 진입 강도 통제
- market_regime_filter 테이블(id=1 단일 행)을 원자적으로 갱신
- 네트워크 장애 및 429 Quota Exceeded 발생 시 자동 룰베이스 폴백 (20MA 기준 0.5/1.0)
"""

import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import requests
except ImportError:
    requests = None

# 상위/동일 디렉터리 init_db 임포트 및 프로젝트 루트 경로 설정
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from init_db import get_db_connection

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("llm_filter_worker")

SYSTEM_PROMPT = """당신은 한·미 주식 자동매매 시스템의 수석 리스크 관리 에이전트(Chief Risk Officer)입니다. 직접 매수 타점을 잡지 마십시오.
당신의 임무는 거시적 시장 충격(환율, 금리, 지정학적 리스크, 각국 지수 및 급락/급등세 등)을 종합 분석하여,
🇰🇷 한국 시장(국내 온주 매매)과 🇺🇸 미국 시장(미국 소수점/온주 매매)의 트레이딩 봇 진입 강도를 각각 '독립적'으로 통제하는 것입니다.

한국 증시와 미국 증시가 디커플링(탈동조화)될 수 있으므로, 한국과 미국의 매매 지침을 반드시 분리하여 판정해야 합니다.

반드시 다른 부연설명이나 마크다운 없이 아래 순수 JSON 포맷으로만 응답해야 합니다:
{
  "kr": {
    "sentiment_score": -0.60,
    "market_regime": "BEAR",
    "risk_alert": false,
    "recommended_action": "REDUCE_SIZE",
    "position_size_multiplier": 0.5,
    "blacklist_tickers": ["005930"],
    "reason": "코스피 급락 및 20일선 이탈로 국내 주식 매수 비중 50% 축소 방어"
  },
  "us": {
    "sentiment_score": 0.65,
    "market_regime": "BULL",
    "risk_alert": false,
    "recommended_action": "NORMAL",
    "position_size_multiplier": 1.0,
    "blacklist_tickers": [],
    "reason": "미국 나스닥/S&P500 견조한 상승세 및 빅테크 모멘텀으로 미국 주식 정상 매매 유지"
  }
}

[필드 규칙]
1. sentiment_score: -1.0(극단 비관) ~ 1.0(극단 낙관) 사이 실수
2. market_regime: 'BULL', 'BEAR', 'SIDEWAYS', 'CRASH_SHOCK' 중 하나
3. risk_alert: 해당 시장에 긴급 악재 발생 시 true, 평상시 false
4. recommended_action: 'NORMAL'(정상 매매 100%), 'REDUCE_SIZE'(비중 축소 50%), 'HALT_NEW_BUYS'(신규 매수 전면 차단 0%) 중 하나
5. position_size_multiplier: 1.0(정상 100%), 0.5(50% 축소), 0.0(진입 금지)
6. blacklist_tickers: 해당 국가 종목 중 치명적 악재 발생 종목코드 리스트
7. reason: 해당 국가 시장 한 줄 요약 판단 근거 (한국어)
"""


def load_config() -> Dict[str, str]:
    """
    .env 및 config/broker_config.json에서 Gemini 설정 로드
    """
    api_key = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

    # .env 파일 파싱
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    val = line.split("=", 1)[1].strip()
                    if val and not api_key:
                        api_key = val

    # broker_config.json 파싱
    broker_conf = PROJECT_ROOT / "config" / "broker_config.json"
    if broker_conf.exists():
        try:
            with open(broker_conf, "r", encoding="utf-8") as f:
                data = json.load(f)
                g = data.get("gemini", {})
                if g.get("api_key"):
                    api_key = g.get("api_key")
                if g.get("model"):
                    model = g.get("model")
        except Exception:
            pass

    return {"api_key": api_key, "model": model}


def fetch_stock_market_summary() -> Dict[str, Any]:
    """
    네이버 금융 API 및 국내 지수 데이터를 수집합니다.
    """
    summary = {
        "kospi_index": 2610.5,
        "kospi_change_rate": 0.35,
        "kospi_20ma": 2605.1,
        "kospi_above_20ma": True,
        "kosdaq_index": 725.0,
        "kosdaq_change_rate": -0.10,
        "usd_krw_rate": 1338.5,
    }

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

    # 1. 코스피 지수
    try:
        req = urllib.request.Request("https://m.stock.naver.com/api/index/KOSPI/basic", headers=headers)
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            close_str = str(data.get("closePrice", "2610.5")).replace(",", "")
            summary["kospi_index"] = float(close_str)
            summary["kospi_change_rate"] = float(data.get("fluctuationsRatio", 0.0))
    except Exception as exc:
        logger.warning("KOSPI 지수 조회 실패(폴백 사용): %s", exc)

    # 2. 코스닥 지수
    try:
        req = urllib.request.Request("https://m.stock.naver.com/api/index/KOSDAQ/basic", headers=headers)
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            close_str = str(data.get("closePrice", "725.0")).replace(",", "")
            summary["kosdaq_index"] = float(close_str)
            summary["kosdaq_change_rate"] = float(data.get("fluctuationsRatio", 0.0))
    except Exception as exc:
        logger.warning("KOSDAQ 지수 조회 실패(폴백 사용): %s", exc)

    # 3. 코스피 20일 이동평균선 동적 산출 (네이버 금융 실제 일봉 API 연동)
    try:
        req_p = urllib.request.Request("https://m.stock.naver.com/api/index/KOSPI/price?page=1&pageSize=20", headers=headers)
        with urllib.request.urlopen(req_p, timeout=4) as resp_p:
            price_data = json.loads(resp_p.read().decode("utf-8"))
            close_prices = [float(str(p.get("closePrice", "0")).replace(",", "")) for p in price_data if p.get("closePrice")]
            if len(close_prices) >= 5:
                kospi_ma20 = sum(close_prices[:20]) / len(close_prices[:20])
                summary["kospi_20ma"] = round(kospi_ma20, 2)
            else:
                summary["kospi_20ma"] = summary["kospi_index"]
    except Exception as exc:
        logger.warning("KOSPI 20MA 동적 수집 실패(현재가 근사 사용): %s", exc)
        summary["kospi_20ma"] = summary["kospi_index"]

    summary["kospi_above_20ma"] = summary["kospi_index"] >= summary["kospi_20ma"]

    # 4. 환율 (토스 설정 또는 네이버)
    try:
        broker_conf = PROJECT_ROOT / "config" / "broker_config.json"
        if broker_conf.exists():
            with open(broker_conf, "r", encoding="utf-8") as f:
                conf = json.load(f)
                toss_api_key = conf.get("toss", {}).get("api_key")
                if toss_api_key:
                    toss_url = "https://openapi.tossinvest.com/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW"
                    t_req = urllib.request.Request(toss_url, headers={"Authorization": f"Bearer {toss_api_key}", "User-Agent": "AutoStockTrader"})
                    with urllib.request.urlopen(t_req, timeout=3) as t_resp:
                        t_data = json.loads(t_resp.read().decode("utf-8"))
                        rate = float(t_data.get("result", {}).get("rate", 1338.5))
                        summary["usd_krw_rate"] = rate
    except Exception:
        pass

    # 5. 미국 나스닥 (.IXIC) 및 S&P 500 (.INX) 주요 거시 지수
    summary["nasdaq_index"] = 25437.0
    summary["nasdaq_change_rate"] = -2.86
    summary["sp500_index"] = 7580.0
    summary["sp500_change_rate"] = -1.50
    try:
        n_req = urllib.request.Request("https://api.stock.naver.com/index/.IXIC/basic", headers=headers)
        with urllib.request.urlopen(n_req, timeout=4) as n_resp:
            n_data = json.loads(n_resp.read().decode("utf-8"))
            summary["nasdaq_index"] = float(str(n_data.get("closePrice", "25437.0")).replace(",", ""))
            summary["nasdaq_change_rate"] = float(n_data.get("fluctuationsRatio", 0.0))
    except Exception:
        pass

    try:
        s_req = urllib.request.Request("https://api.stock.naver.com/index/.INX/basic", headers=headers)
        with urllib.request.urlopen(s_req, timeout=4) as s_resp:
            s_data = json.loads(s_resp.read().decode("utf-8"))
            summary["sp500_index"] = float(str(s_data.get("closePrice", "7580.0")).replace(",", ""))
            summary["sp500_change_rate"] = float(s_data.get("fluctuationsRatio", 0.0))
    except Exception:
        pass

    return summary


def fetch_recent_news_headlines(db_path: Optional[str] = None, limit: int = 20) -> List[Dict[str, str]]:
    """
    PostgreSQL stock_news 테이블에서 최근 20개 뉴스 헤드라인을 가져옵니다.
    """
    news_list = []
    try:
        conn = get_db_connection(db_path)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT title, summary, sentiment, keywords, published_at
                FROM stock_news
                ORDER BY id DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
            for r in rows:
                news_list.append({
                    "title": r["title"] or "",
                    "summary": (r["summary"] or "")[:120],
                    "sentiment": r["sentiment"] or "NEUTRAL",
                })
        conn.close()
    except Exception as exc:
        logger.warning("최근 뉴스 조회 실패: %s", exc)

    return news_list


def fetch_open_positions_tickers(db_path: Optional[str] = None) -> List[str]:
    """
    현재 OPEN 상태인 포지션의 종목 목록을 조회합니다.
    """
    tickers = []
    try:
        conn = get_db_connection(db_path)
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT stock_code FROM bot_positions WHERE status = 'OPEN'")
            rows = cur.fetchall()
            tickers = [r["stock_code"] for r in rows]
        conn.close()
    except Exception as exc:
        logger.warning("보유 포지션 조회 실패: %s", exc)
    return tickers


def fetch_current_regime_from_db(db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    현재 DB에 저장되어 있는 최신 market_regime_filter 상태를 조회합니다.
    """
    try:
        conn = get_db_connection(db_path)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sentiment_score, market_regime, risk_alert, recommended_action,
                       position_size_multiplier, blacklist_tickers_json, reason
                FROM market_regime_filter
                WHERE id = 1
                """
            )
            row = cur.fetchone()
            if row:
                blist = []
                try:
                    blist = json.loads(row.get("blacklist_tickers_json") or "[]")
                except Exception:
                    pass
                return {
                    "sentiment_score": float(row.get("sentiment_score", 0.0)),
                    "market_regime": row.get("market_regime", "SIDEWAYS"),
                    "risk_alert": bool(row.get("risk_alert", 0)),
                    "recommended_action": row.get("recommended_action", "NORMAL"),
                    "position_size_multiplier": float(row.get("position_size_multiplier", 1.0)),
                    "blacklist_tickers": blist,
                    "reason": row.get("reason", ""),
                }
        conn.close()
    except Exception as exc:
        logger.warning("현재 DB market_regime_filter 조회 실패: %s", exc)
    return None


def make_fallback_regime(market_summary: Dict[str, Any], previous_filter: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Gemini 호출 실패 시 발동하는 기계적 룰베이스 Fallback:
    한국(KR)과 미국(US)을 각각의 시장 지표에 따라 완전히 독립적으로 판정합니다.
    """
    # 1. 한국 시장 지표
    kospi = market_summary.get("kospi_index", 2610.0)
    ma20 = market_summary.get("kospi_20ma", 2605.0)
    is_above = market_summary.get("kospi_above_20ma", kospi >= ma20)
    kospi_chg = market_summary.get("kospi_change_rate", 0.0)
    kosdaq_chg = market_summary.get("kosdaq_change_rate", 0.0)
    min_kr_chg = min(kospi_chg, kosdaq_chg)

    # 한국(KR) 판정 로직
    if min_kr_chg <= -4.0:
        kr_regime = {
            "sentiment_score": -0.80,
            "market_regime": "CRASH_SHOCK",
            "risk_alert": True,
            "recommended_action": "HALT_NEW_BUYS",
            "position_size_multiplier": 0.0,
            "blacklist_tickers": [],
            "reason": f"기계적 룰베이스 한국 폭락 경보: 코스피/코스닥 급락({min_kr_chg:.2f}%), 국내 온주 매수 전면 차단",
        }
    elif min_kr_chg <= -2.0:
        kr_regime = {
            "sentiment_score": -0.50,
            "market_regime": "BEAR",
            "risk_alert": False,
            "recommended_action": "REDUCE_SIZE",
            "position_size_multiplier": 0.5,
            "blacklist_tickers": [],
            "reason": f"기계적 룰베이스 한국 위험 관리: 국내 증시 급락({min_kr_chg:.2f}%), 국내 온주 매수 비중 50% 축소",
        }
    elif not is_above or min_kr_chg <= -1.0:
        kr_regime = {
            "sentiment_score": -0.30,
            "market_regime": "BEAR",
            "risk_alert": False,
            "recommended_action": "REDUCE_SIZE",
            "position_size_multiplier": 0.5,
            "blacklist_tickers": [],
            "reason": f"기계적 룰베이스 한국 약세: 코스피({kospi:.1f})가 20일선({ma20:.1f}) 하회 중, 국내 1회 투자금 50% 축소",
        }
    else:
        kr_regime = {
            "sentiment_score": 0.20,
            "market_regime": "SIDEWAYS",
            "risk_alert": False,
            "recommended_action": "NORMAL",
            "position_size_multiplier": 1.0,
            "blacklist_tickers": [],
            "reason": f"기계적 룰베이스 한국 정상: 코스피({kospi:.1f})가 20일선({ma20:.1f}) 상회 중, 정상 비중 유지",
        }

    # 2. 미국 시장 지표
    nasdaq_idx = market_summary.get("nasdaq_index", 25437.0)
    nasdaq_chg = market_summary.get("nasdaq_change_rate", 0.0)
    sp500_idx = market_summary.get("sp500_index", 7580.0)
    sp500_chg = market_summary.get("sp500_change_rate", 0.0)
    min_us_chg = min(nasdaq_chg, sp500_chg)

    # 미국(US) 판정 로직
    if min_us_chg <= -4.0:
        us_regime = {
            "sentiment_score": -0.80,
            "market_regime": "CRASH_SHOCK",
            "risk_alert": True,
            "recommended_action": "HALT_NEW_BUYS",
            "position_size_multiplier": 0.0,
            "blacklist_tickers": [],
            "reason": f"기계적 룰베이스 미국 폭락 경보: 나스닥/S&P500 급락({min_us_chg:.2f}%), 미국 소수점/온주 매수 전면 차단",
        }
    elif min_us_chg <= -2.0:
        us_regime = {
            "sentiment_score": -0.50,
            "market_regime": "BEAR",
            "risk_alert": False,
            "recommended_action": "REDUCE_SIZE",
            "position_size_multiplier": 0.5,
            "blacklist_tickers": [],
            "reason": f"기계적 룰베이스 미국 위험 관리: 미국 증시 변동성 확대({min_us_chg:.2f}%), 미국 주식 매수 비중 50% 축소",
        }
    elif min_us_chg <= -1.0:
        us_regime = {
            "sentiment_score": -0.10,
            "market_regime": "SIDEWAYS",
            "risk_alert": False,
            "recommended_action": "REDUCE_SIZE",
            "position_size_multiplier": 0.7,
            "blacklist_tickers": [],
            "reason": f"기계적 룰베이스 미국 횡보/조정: 나스닥({nasdaq_idx:.1f}, {nasdaq_chg:.2f}%), 보수적 분할 매수",
        }
    else:
        us_regime = {
            "sentiment_score": 0.35,
            "market_regime": "BULL",
            "risk_alert": False,
            "recommended_action": "NORMAL",
            "position_size_multiplier": 1.0,
            "blacklist_tickers": [],
            "reason": f"기계적 룰베이스 미국 안정/상승: 나스닥({nasdaq_idx:.1f}) 견조한 추세 유지, 미국 소수점 정상 매매",
        }

    # 3. 종합 하위 호환 대표값 (둘 중 더 보수적인 값)
    overall_sentiment = round((kr_regime["sentiment_score"] + us_regime["sentiment_score"]) / 2, 2)
    overall_mult = min(kr_regime["position_size_multiplier"], us_regime["position_size_multiplier"])
    if kr_regime["recommended_action"] == "HALT_NEW_BUYS" or us_regime["recommended_action"] == "HALT_NEW_BUYS":
        overall_action = "HALT_NEW_BUYS"
    elif kr_regime["recommended_action"] == "REDUCE_SIZE" or us_regime["recommended_action"] == "REDUCE_SIZE":
        overall_action = "REDUCE_SIZE"
    else:
        overall_action = "NORMAL"

    if kr_regime["market_regime"] == "CRASH_SHOCK" or us_regime["market_regime"] == "CRASH_SHOCK":
        overall_regime = "CRASH_SHOCK"
    elif kr_regime["market_regime"] == "BEAR" or us_regime["market_regime"] == "BEAR":
        overall_regime = "BEAR"
    elif kr_regime["market_regime"] == "SIDEWAYS" or us_regime["market_regime"] == "SIDEWAYS":
        overall_regime = "SIDEWAYS"
    else:
        overall_regime = "BULL"

    overall_reason = f"[🇰🇷국내: {kr_regime['recommended_action']}] {kr_regime['reason']} | [🇺🇸미국: {us_regime['recommended_action']}] {us_regime['reason']}"

    return {
        "sentiment_score": overall_sentiment,
        "market_regime": overall_regime,
        "risk_alert": kr_regime["risk_alert"] or us_regime["risk_alert"],
        "recommended_action": overall_action,
        "position_size_multiplier": overall_mult,
        "blacklist_tickers": kr_regime["blacklist_tickers"] + us_regime["blacklist_tickers"],
        "reason": overall_reason,
        "kr": kr_regime,
        "us": us_regime,
    }


def call_llm_filter_api(market_summary: Dict[str, Any], news_list: List[Dict[str, str]], open_positions: List[str], db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Gemini API를 호출하여 한국(KR)과 미국(US)을 분리하여 거시적 시장 체제 판정을 받아옵니다.
    - 503(High Demand) 또는 일시적 오류 시 Exponential Backoff로 최대 3회 재시도
    - 대체 모델 자동 폴백 지원
    """
    config = load_config()
    api_key = config["api_key"]
    primary_model = config["model"].replace("models/", "")
    candidate_models = [primary_model, "gemini-3.5-flash", "gemini-flash-latest"]
    models_to_try = []
    for m in candidate_models:
        if m and m not in models_to_try:
            models_to_try.append(m)

    prev_regime = fetch_current_regime_from_db(db_path)

    if not api_key:
        logger.warning("Gemini API Key 미설정. 한국/미국 분리 룰베이스 폴백을 적용합니다.")
        return make_fallback_regime(market_summary, prev_regime)

    # 거시 분석 프롬프트 작성 (한국 및 미국 증시 명확히 분리 제공)
    news_text = "\n".join([f"- [{n['sentiment']}] {n['title']}: {n['summary']}" for n in news_list[:20]])
    user_prompt = f"""[🇰🇷 한국 시장(KRX: KOSPI/KOSDAQ) 거시 지표]
• 코스피(KOSPI): {market_summary.get('kospi_index')} (전일대비 {market_summary.get('kospi_change_rate')}%, 20일선: {market_summary.get('kospi_20ma')}, 상회여부: {market_summary.get('kospi_above_20ma')})
• 코스닥(KOSDAQ): {market_summary.get('kosdaq_index')} (전일대비 {market_summary.get('kosdaq_change_rate')}%)

[🇺🇸 미국 시장(NYSE/NASDAQ) 거시 지표]
• 나스닥(NASDAQ): {market_summary.get('nasdaq_index')} (변동률 {market_summary.get('nasdaq_change_rate')}%)
• S&P 500: {market_summary.get('sp500_index')} (변동률 {market_summary.get('sp500_change_rate')}%)
• 원/달러 환율: {market_summary.get('usd_krw_rate')}원

[현재 보유 포지션 종목]: {', '.join(open_positions) if open_positions else '없음'}

[최근 주요 증시 뉴스 헤드라인 (국내/글로벌 20건)]
{news_text if news_text else '최근 뉴스 없음'}

한국 증시와 미국 증시는 디커플링(탈동조화)될 수 있습니다. 
Chief Risk Officer로서 🇰🇷 한국 시장(국내 온주 매매)과 🇺🇸 미국 시장(소수점 매매)의 봇 매매 지침을 각각 '독립적으로 분리'하여 순수 JSON 포맷({{"kr": {{...}}, "us": {{...}}}})으로만 응답하세요.
"""

    payload = {
        "contents": [{"parts": [{"text": f"{SYSTEM_PROMPT}\n\n{user_prompt}"}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 4096,
            "responseMimeType": "application/json",
        },
    }

    # 지수 백오프 및 다중 모델 재시도 루프 (최대 3회)
    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        for attempt in range(1, 4):
            try:
                req = urllib.request.Request(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=15) as response:
                    res_data = json.loads(response.read().decode("utf-8"))
                    raw_text = res_data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")

                    match = re.search(r"\{[\s\S]*\}", raw_text)
                    if match:
                        raw_text = match.group(0)

                    parsed = json.loads(raw_text)

                    # kr 및 us 객체 추출 (하위 호환성 지원)
                    kr_raw = parsed.get("kr") if isinstance(parsed.get("kr"), dict) else parsed
                    us_raw = parsed.get("us") if isinstance(parsed.get("us"), dict) else parsed

                    # 1. 한국 파싱
                    kr_sentiment = float(kr_raw.get("sentiment_score", 0.0))
                    kr_regime = str(kr_raw.get("market_regime", "SIDEWAYS")).upper()
                    if kr_regime not in ["BULL", "BEAR", "SIDEWAYS", "CRASH_SHOCK"]:
                        kr_regime = "SIDEWAYS"
                    kr_action = str(kr_raw.get("recommended_action", "NORMAL")).upper()
                    if kr_action not in ["NORMAL", "REDUCE_SIZE", "HALT_NEW_BUYS"]:
                        kr_action = "NORMAL"
                    kr_risk_alert = bool(kr_raw.get("risk_alert", False)) and (kr_action == "HALT_NEW_BUYS")
                    kr_multiplier = max(0.0, min(1.0, float(kr_raw.get("position_size_multiplier", 1.0))))
                    kr_blacklist = kr_raw.get("blacklist_tickers", [])
                    if not isinstance(kr_blacklist, list):
                        kr_blacklist = []
                    kr_reason = str(kr_raw.get("reason", "한국 거시 LLM 판정 완료"))

                    kr_dict = {
                        "sentiment_score": kr_sentiment,
                        "market_regime": kr_regime,
                        "risk_alert": kr_risk_alert,
                        "recommended_action": kr_action,
                        "position_size_multiplier": kr_multiplier,
                        "blacklist_tickers": kr_blacklist,
                        "reason": kr_reason,
                    }

                    # 2. 미국 파싱
                    us_sentiment = float(us_raw.get("sentiment_score", 0.0))
                    us_regime = str(us_raw.get("market_regime", "SIDEWAYS")).upper()
                    if us_regime not in ["BULL", "BEAR", "SIDEWAYS", "CRASH_SHOCK"]:
                        us_regime = "SIDEWAYS"
                    us_action = str(us_raw.get("recommended_action", "NORMAL")).upper()
                    if us_action not in ["NORMAL", "REDUCE_SIZE", "HALT_NEW_BUYS"]:
                        us_action = "NORMAL"
                    us_risk_alert = bool(us_raw.get("risk_alert", False)) and (us_action == "HALT_NEW_BUYS")
                    us_multiplier = max(0.0, min(1.0, float(us_raw.get("position_size_multiplier", 1.0))))
                    us_blacklist = us_raw.get("blacklist_tickers", [])
                    if not isinstance(us_blacklist, list):
                        us_blacklist = []
                    us_reason = str(us_raw.get("reason", "미국 거시 LLM 판정 완료"))

                    us_dict = {
                        "sentiment_score": us_sentiment,
                        "market_regime": us_regime,
                        "risk_alert": us_risk_alert,
                        "recommended_action": us_action,
                        "position_size_multiplier": us_multiplier,
                        "blacklist_tickers": us_blacklist,
                        "reason": us_reason,
                    }

                    # 3. 종합 하위 호환 대표값 산출
                    overall_sentiment = round((kr_sentiment + us_sentiment) / 2, 2)
                    overall_mult = min(kr_multiplier, us_multiplier)
                    if kr_action == "HALT_NEW_BUYS" or us_action == "HALT_NEW_BUYS":
                        overall_action = "HALT_NEW_BUYS"
                    elif kr_action == "REDUCE_SIZE" or us_action == "REDUCE_SIZE":
                        overall_action = "REDUCE_SIZE"
                    else:
                        overall_action = "NORMAL"

                    if kr_regime == "CRASH_SHOCK" or us_regime == "CRASH_SHOCK":
                        overall_regime = "CRASH_SHOCK"
                    elif kr_regime == "BEAR" or us_regime == "BEAR":
                        overall_regime = "BEAR"
                    elif kr_regime == "SIDEWAYS" or us_regime == "SIDEWAYS":
                        overall_regime = "SIDEWAYS"
                    else:
                        overall_regime = "BULL"

                    overall_reason = f"[🇰🇷국내: {kr_action}] {kr_reason} | [🇺🇸미국: {us_action}] {us_reason}"

                    return {
                        "sentiment_score": overall_sentiment,
                        "market_regime": overall_regime,
                        "risk_alert": kr_risk_alert or us_risk_alert,
                        "recommended_action": overall_action,
                        "position_size_multiplier": overall_mult,
                        "blacklist_tickers": kr_blacklist + us_blacklist,
                        "reason": overall_reason,
                        "kr": kr_dict,
                        "us": us_dict,
                    }
            except urllib.error.HTTPError as http_err:
                err_msg = http_err.read().decode("utf-8", errors="ignore")
                if http_err.code == 503:
                    logger.warning("[LLM Filter] Gemini 서버 일시 과부하(HTTP 503, %s) 발생 (시도 %d/3). %d초 후 재시도합니다.",
                                   model, attempt, attempt * 2)
                    time.sleep(attempt * 2)
                    continue
                elif http_err.code == 429:
                    logger.warning("[LLM Filter] Gemini 429 Rate Limit 감지 (시도 %d/3). %d초 후 재시도합니다.", attempt, attempt * 2)
                    time.sleep(attempt * 2)
                    continue
                else:
                    logger.warning("[LLM Filter] Gemini API 호출 실패 (HTTP %d, 모델 %s): %s", http_err.code, model, err_msg[:120])
                    break
            except Exception as exc:
                logger.warning("[LLM Filter] Gemini 호출 또는 파싱 오류 (시도 %d/3): %s", attempt, exc)
                time.sleep(attempt * 1.5)
                continue

    logger.warning("[LLM Filter] 모든 Gemini API 시도 실패. 한국/미국 분리 룰베이스 Fallback을 적용합니다.")
    return make_fallback_regime(market_summary, prev_regime)


def update_market_regime_filter_table(filter_data: Dict[str, Any], db_path: Optional[str] = None) -> None:
    """
    market_regime_filter 테이블(id=1 단일 행)을 한국과 미국을 구분하여 원자적으로 갱신합니다.
    """
    conn = get_db_connection(db_path)
    kr = filter_data.get("kr", filter_data)
    us = filter_data.get("us", filter_data)

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE market_regime_filter
                SET sentiment_score = %s,
                    market_regime = %s,
                    risk_alert = %s,
                    recommended_action = %s,
                    position_size_multiplier = %s,
                    blacklist_tickers_json = %s,
                    reason = %s,
                    kr_market_regime = %s,
                    kr_recommended_action = %s,
                    kr_position_size_multiplier = %s,
                    kr_risk_alert = %s,
                    kr_reason = %s,
                    kr_blacklist_tickers_json = %s,
                    us_market_regime = %s,
                    us_recommended_action = %s,
                    us_position_size_multiplier = %s,
                    us_risk_alert = %s,
                    us_reason = %s,
                    us_blacklist_tickers_json = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1;
                """,
                (
                    filter_data["sentiment_score"],
                    filter_data["market_regime"],
                    1 if filter_data["risk_alert"] else 0,
                    filter_data["recommended_action"],
                    filter_data["position_size_multiplier"],
                    json.dumps(filter_data.get("blacklist_tickers", []), ensure_ascii=False),
                    filter_data["reason"],
                    kr.get("market_regime", "SIDEWAYS"),
                    kr.get("recommended_action", "NORMAL"),
                    kr.get("position_size_multiplier", 1.0),
                    1 if kr.get("risk_alert") else 0,
                    kr.get("reason", ""),
                    json.dumps(kr.get("blacklist_tickers", []), ensure_ascii=False),
                    us.get("market_regime", "SIDEWAYS"),
                    us.get("recommended_action", "NORMAL"),
                    us.get("position_size_multiplier", 1.0),
                    1 if us.get("risk_alert") else 0,
                    us.get("reason", ""),
                    json.dumps(us.get("blacklist_tickers", []), ensure_ascii=False),
                ),
            )
        logger.info(
            "market_regime_filter 갱신 완료: [🇰🇷 KR: %s, Action=%s, Mult=%.1f] [🇺🇸 US: %s, Action=%s, Mult=%.1f]",
            kr.get("market_regime"),
            kr.get("recommended_action"),
            float(kr.get("position_size_multiplier", 1.0)),
            us.get("market_regime"),
            us.get("recommended_action"),
            float(us.get("position_size_multiplier", 1.0)),
        )
    except Exception as exc:
        logger.error("market_regime_filter 테이블 갱신 실패: %s", exc)
        raise
    finally:
        conn.close()


def run_single_cycle(db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    1회 단독 실행 사이클
    """
    market_summary = fetch_stock_market_summary()
    news_list = fetch_recent_news_headlines(db_path, limit=20)
    open_pos = fetch_open_positions_tickers(db_path)

    logger.info(
        "시장 데이터 수집: KOSPI=%.1f(20MA=%s), KOSDAQ=%.1f, 환율=%.1f원, 뉴스=%d건",
        market_summary.get("kospi_index", 0.0),
        "상회" if market_summary.get("kospi_above_20ma") else "하회",
        market_summary.get("kosdaq_index", 0.0),
        market_summary.get("usd_krw_rate", 1340.0),
        len(news_list),
    )

    filter_res = call_llm_filter_api(market_summary, news_list, open_pos, db_path)
    update_market_regime_filter_table(filter_res, db_path)
    return filter_res


def seconds_until_next_4h_slot() -> int:
    """
    0시, 4시, 8시, 12시, 16시, 20시 (4시간 간격 KST 정각)까지 남은 초(seconds) 계산
    """
    now_ts = time.time()
    # KST = UTC + 9시간 (32400초)
    kst_sec = int(now_ts + 9 * 3600) % 86400
    slot_sec = 4 * 3600  # 14400초 (4시간)
    rem = slot_sec - (kst_sec % slot_sec)
    return max(5, rem)


def run_worker_loop(interval_sec: int = 14400, db_path: Optional[str] = None) -> None:
    """
    0시, 4시, 8시, 12시, 16시, 20시 (4시간 간격) 정각 스케줄 백그라운드 워커 루프 실행
    """
    logger.info("비동기 거시 LLM 리스크 관리자 워커 가동 시작 (0시, 4시, 8시, 12시, 16시, 20시 4시간 간격 자동 실행)")
    while True:
        try:
            run_single_cycle(db_path)
        except Exception as exc:
            logger.error("워커 사이클 실행 중 오류: %s", exc, exc_info=True)

        wait_sec = seconds_until_next_4h_slot()
        logger.info("다음 4시간 정각(0/4/8/12/16/20시) 분석 사이클까지 %d초(약 %d분) 대기합니다...", wait_sec, wait_sec // 60)
        time.sleep(wait_sec)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="비동기 거시 LLM 리스크 관리자")
    parser.add_argument("--once", action="store_true", help="1회만 실행 후 종료")
    parser.add_argument("--interval", type=int, default=int(os.getenv("LLM_FILTER_INTERVAL_SEC", "14400")), help="실행 주기 (초)")
    args = parser.parse_args()

    if args.once:
        res = run_single_cycle()
        print("\n=== Market Regime Filter Result (id=1) ===")
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        run_worker_loop(interval_sec=args.interval)
