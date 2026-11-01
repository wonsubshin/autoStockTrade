#!/usr/bin/env python3
"""
토스증권(Toss Securities) Open API v1.2.28 실전/소수점 매매 실행기 (Python Core Executor)
- 하이브리드 아키텍처: Node.js/LLM 분석 엔진의 의사결정을 전달받아 Python이 실제 거래를 집행
- 국내주식 (정수 1주 단위 LIMIT / MARKET) 및 미국주식 소수점 거래 (orderAmount 금액 주문 / fractional quantity 매도) 지원
- OAuth 2.0 Client Credentials 인증 및 토큰 자동 갱신(401 복구)
"""

import sys
import os
import json
import time
import argparse
import urllib.request
import urllib.error
import urllib.parse
from typing import Dict, Any, Optional

class TossPythonExecutor:
    def __init__(self, project_root: str):
        self.project_root = project_root
        self.token: Optional[str] = None
        self.token_expires_at: float = 0.0
        self.account_seq: Optional[int] = None
        self.account_no: Optional[str] = None
        self.config = self.load_config()

    def load_config(self) -> Dict[str, Any]:
        cfg_path = os.path.join(self.project_root, 'config', 'broker_config.json')
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    toss = data.get('toss', {})
                    return {
                        'api_key': toss.get('api_key', ''),
                        'api_secret': toss.get('api_secret', ''),
                        'account_no': toss.get('account_no', ''),
                        'base_url': toss.get('base_url', 'https://openapi.tossinvest.com')
                    }
            except Exception as e:
                sys.stderr.write(f"[PythonExecutor] broker_config.json 로드 실패: {e}\n")

        return {
            'api_key': '',
            'api_secret': '',
            'account_no': '',
            'base_url': 'https://openapi.tossinvest.com'
        }

    def get_token_file_path(self) -> str:
        return os.path.join(self.project_root, 'config', '.toss_token.json')

    def load_cached_token(self) -> Optional[str]:
        path = self.get_token_file_path()
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    now_ms = time.time() * 1000
                    if data.get('access_token') and data.get('expires_at', 0) > (now_ms + 60000):
                        self.token = data['access_token']
                        self.token_expires_at = data['expires_at'] / 1000.0
                        return self.token
            except Exception:
                pass
        return None

    def save_cached_token(self, token: str, expires_in_sec: int):
        path = self.get_token_file_path()
        try:
            expires_at = int((time.time() + expires_in_sec) * 1000)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump({'access_token': token, 'expires_at': expires_at}, f)
            self.token = token
            self.token_expires_at = time.time() + expires_in_sec
        except Exception:
            pass

    def get_auth_token(self, force_refresh: bool = False) -> Optional[str]:
        now = time.time()
        if not force_refresh:
            if self.token and self.token_expires_at > (now + 60):
                return self.token
            cached = self.load_cached_token()
            if cached:
                return cached

        if not self.config['api_key'] or not self.config['api_secret']:
            raise ValueError("토스증권 API Key 또는 Secret이 설정되지 않았습니다.")

        token_url = f"{self.config['base_url']}/oauth2/token"
        payload = urllib.parse.urlencode({
            'grant_type': 'client_credentials',
            'client_id': self.config['api_key'],
            'client_secret': self.config['api_secret']
        }).encode('utf-8')

        req = urllib.request.Request(
            token_url,
            data=payload,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                self.token = data.get('access_token')
                expires_in = int(data.get('expires_in', 86400))
                self.save_cached_token(self.token, expires_in)
                return self.token
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8')
            raise RuntimeError(f"토스 인증 실패 ({e.code}): {err_body}")
        except Exception as e:
            raise RuntimeError(f"토스 인증 네트워크 오류: {str(e)}")

    def fetch_with_auth(self, path: str, method: str = 'GET', data: Optional[Dict[str, Any]] = None, need_account_seq: bool = True, retry: int = 1) -> Dict[str, Any]:
        token = self.get_auth_token()
        if need_account_seq and self.account_seq is None:
            self.resolve_account_seq()

        url = path if path.startswith('http') else f"{self.config['base_url']}{path}"
        headers = {
            'Authorization': f"Bearer {token}",
            'Content-Type': 'application/json'
        }
        if need_account_seq and self.account_seq:
            headers['X-Tossinvest-Account'] = str(self.account_seq)

        body_bytes = json.dumps(data).encode('utf-8') if data is not None else None
        req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8')
            if e.code == 401 and retry > 0:
                # Token revoked or expired, force refresh and retry
                self.token = None
                self.token_expires_at = 0.0
                self.get_auth_token(force_refresh=True)
                return self.fetch_with_auth(path, method, data, need_account_seq, retry - 1)
            raise RuntimeError(f"토스 API 오류 ({e.code}): {err_body}")
        except Exception as e:
            raise RuntimeError(f"토스 API 요청 실패: {str(e)}")

    def resolve_account_seq(self) -> int:
        if self.account_seq is not None:
            return self.account_seq

        res = self.fetch_with_auth('/api/v1/accounts', method='GET', need_account_seq=False)
        accounts = res.get('result', [])
        target_no = str(self.config.get('account_no', ''))

        matched = next((a for a in accounts if str(a.get('accountNo')) == target_no), None)
        if not matched and accounts:
            matched = accounts[0]

        if matched:
            self.account_seq = int(matched['accountSeq'])
            self.account_no = str(matched['accountNo'])
            return self.account_seq

        self.account_seq = 1
        return 1

    def get_exchange_rate(self) -> float:
        try:
            res = self.fetch_with_auth('/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW', method='GET', need_account_seq=False)
            rate = float(res.get('result', {}).get('rate', 1340.0))
            return rate
        except Exception:
            return 1340.0

    def get_balance(self) -> Dict[str, Any]:
        seq = self.resolve_account_seq()
        usd_rate = self.get_exchange_rate()

        # 1) Buying Power
        bp = self.fetch_with_auth('/api/v1/buying-power?currency=KRW', method='GET', need_account_seq=True)
        cash_buying_power = int(bp.get('result', {}).get('cashBuyingPower', 0))

        # 2) Holdings
        hold = self.fetch_with_auth('/api/v1/holdings', method='GET', need_account_seq=True)
        res = hold.get('result', {})

        krw_market = float(res.get('marketValue', {}).get('amount', {}).get('krw', 0.0))
        usd_market = float(res.get('marketValue', {}).get('amount', {}).get('usd', 0.0))
        stock_eval_krw = round(krw_market + (usd_market * usd_rate))

        items = []
        for it in res.get('items', []):
            is_usd = it.get('currency') == 'USD'
            rate = usd_rate if is_usd else 1.0
            items.append({
                'symbol': it.get('symbol'),
                'name': it.get('name'),
                'currency': it.get('currency', 'KRW'),
                'qty': float(it.get('quantity', 0.0)),
                'avgPrice': round(float(it.get('averagePurchasePrice', 0.0)) * rate),
                'currentPrice': round(float(it.get('lastPrice', 0.0)) * rate),
                'evalAmount': round(float(it.get('marketValue', {}).get('amount', 0.0)) * rate),
                'profitKrw': round(float(it.get('profitLoss', {}).get('amount', 0.0)) * rate),
                'profitPct': round(float(it.get('profitLoss', {}).get('rate', 0.0)) * 100, 2)
            })

        return {
            'accountNo': self.account_no or self.config['account_no'],
            'accountSeq': seq,
            'availableCash': cash_buying_power,
            'stockEvalAmount': stock_eval_krw,
            'totalAssetAmount': cash_buying_power + stock_eval_krw,
            'exchangeRateUsdKrw': usd_rate,
            'holdings': items
        }

    def execute_order(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        토스증권 실전 주문 집행 (Python)
        - 국내주식: LIMIT / MARKET, 정수 quantity
        - 미국주식:
            - 소수점 매수: MARKET, orderAmount (달러 금액)
            - 소수점 매도: MARKET, quantity (소수점 주 수량)
            - 일반 지정가: LIMIT, quantity (정수 주 수량)
        """
        symbol = str(params.get('symbol', '')).strip().upper()
        side = str(params.get('side', 'BUY')).upper()
        order_type = str(params.get('orderType', 'MARKET')).upper()
        market = str(params.get('market', '')).upper()

        if not market:
            # 심볼이 숫자로 시작하면 국내(KR), 알파벳이면 미국(US)
            market = 'KR' if symbol and symbol[0].isdigit() else 'US'

        client_order_id = params.get('clientOrderId') or f"py-order-{int(time.time() * 1000)}"

        payload = {
            'clientOrderId': client_order_id,
            'symbol': symbol,
            'side': side,
            'orderType': order_type,
        }

        is_fractional = False

        if market == 'US':
            # 미국 주식 처리
            if side == 'BUY':
                # 소수점 금액 매수 (orderAmount) 또는 수량 매수
                order_amount = params.get('orderAmount')
                if order_amount is not None and float(order_amount) > 0:
                    payload['orderAmount'] = f"{float(order_amount):.2f}"
                    payload['orderType'] = 'MARKET' # 소수점 금액주문은 MARKET 전용
                    is_fractional = True
                else:
                    qty = float(params.get('quantity', 1.0))
                    payload['quantity'] = f"{qty}"
                    if order_type == 'LIMIT':
                        payload['price'] = str(params.get('price'))
            else: # SELL
                qty = float(params.get('quantity', 1.0))
                # 소수점 매도는 MARKET 전용
                if qty < 1.0 or (qty % 1.0 != 0.0):
                    payload['orderType'] = 'MARKET'
                    payload['quantity'] = f"{qty}"
                    is_fractional = True
                else:
                    payload['quantity'] = str(int(qty)) if order_type == 'LIMIT' else f"{qty}"
                    if order_type == 'LIMIT' and params.get('price'):
                        payload['price'] = str(params.get('price'))
        else:
            # 국내 주식 (KR) - 정수 온주 주문만 지원
            qty = int(float(params.get('quantity', 1)))
            if qty <= 0:
                raise ValueError("국내 주식 주문 수량은 1주 이상의 정수여야 합니다.")
            payload['quantity'] = str(qty)
            if order_type == 'LIMIT' and params.get('price'):
                payload['price'] = str(int(params.get('price')))

        res = self.fetch_with_auth('/api/v1/orders', method='POST', data=payload, need_account_seq=True)

        return {
            'success': True,
            'executor': 'Python Toss Executor v1.2',
            'orderId': res.get('result', {}).get('orderId') or client_order_id,
            'clientOrderId': client_order_id,
            'symbol': symbol,
            'side': side,
            'orderType': payload['orderType'],
            'market': market,
            'isFractional': is_fractional,
            'payload': payload,
            'response': res
        }

def main():
    parser = argparse.ArgumentParser(description="Toss Securities Python Core Executor")
    parser.add_argument('--action', required=True, choices=['balance', 'order', 'health', 'rate', 'quote'], help="Action to execute")
    parser.add_argument('--params', default='{}', help="JSON string of order parameters")
    parser.add_argument('--root', default=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), help="Project root directory")

    args = parser.parse_args()
    executor = TossPythonExecutor(project_root=args.root)

    try:
        if args.action == 'health':
            token = executor.get_auth_token()
            seq = executor.resolve_account_seq()
            print(json.dumps({'status': 'ok', 'hasToken': bool(token), 'accountSeq': seq}, ensure_ascii=False))

        elif args.action == 'balance':
            bal = executor.get_balance()
            print(json.dumps(bal, ensure_ascii=False))

        elif args.action == 'rate':
            rate = executor.get_exchange_rate()
            print(json.dumps({'exchangeRate': rate}, ensure_ascii=False))

        elif args.action == 'quote':
            params = json.loads(args.params)
            sym = str(params.get('symbol', 'AAPL')).strip().upper()
            res = executor.fetch_with_auth(f'/api/v1/prices?symbols={sym}', method='GET', need_account_seq=False)
            rate = executor.get_exchange_rate()
            print(json.dumps({'quote': res.get('result', []), 'exchangeRate': rate}, ensure_ascii=False))

        elif args.action == 'order':
            params = json.loads(args.params)
            result = executor.execute_order(params)
            print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        err_res = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(err_res, ensure_ascii=False))
        sys.exit(1)

if __name__ == '__main__':
    main()

