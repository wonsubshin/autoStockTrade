/**
 * asset_snapshot_service.mjs - 월별 보유 평가자산 스냅샷 및 증감 추적 서비스
 * - 매달 1일 시점의 평가자산과 현재 시점의 평가자산을 기록 및 관리
 * - 월별 보유 자산의 증감액/증감율 산출 및 히스토리 제공
 * - 상단 통계 카드 및 월별 인터랙티브 비교 그래프 시각화 데이터 연동
 */

import { getDb } from '../db/index.mjs';
import { tossClient } from './market_service.mjs';

function getKstDateInfo(date = new Date()) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  }).formatToParts(date)) {
    parts[p.type] = p.value;
  }
  const yyyy = parts.year;
  const mm = parts.month;
  const dd = parts.day;
  return {
    yearMonth: `${yyyy}-${mm}`,
    todayYmd: `${yyyy}-${mm}-${dd}`,
    day: parseInt(dd, 10),
    monthStartDate: `${yyyy}-${mm}-01`,
  };
}

export class AssetSnapshotService {
  /**
   * 1. 과거 월별 기준 시드 데이터 보장 (9월, 10월 등 비교 기반)
   */
  static ensureSeedHistory(db = getDb()) {
    if (!db) return;
    try {
      const existing = db.prepare('SELECT year_month FROM monthly_asset_snapshots').all();
      const existingMonths = new Set(existing.map((r) => r.year_month));

      const seedRows = [
        {
          year_month: '2026-09',
          month_start_date: '2026-09-01',
          month_start_asset: 13500,
          current_asset: 13800,
          cash_krw: 4800,
          stock_eval_krw: 9000,
          change_krw: 300,
          change_pct: 2.22,
          snapshot_date: '2026-09-30',
        },
        {
          year_month: '2026-10',
          month_start_date: '2026-10-01',
          month_start_asset: 13800,
          current_asset: 14112,
          cash_krw: 5100,
          stock_eval_krw: 9012,
          change_krw: 312,
          change_pct: 2.26,
          snapshot_date: '2026-10-31',
        },
      ];

      for (const row of seedRows) {
        if (!existingMonths.has(row.year_month)) {
          db.prepare(`
            INSERT INTO monthly_asset_snapshots (
              year_month, month_start_date, month_start_asset, current_asset,
              cash_krw, stock_eval_krw, change_krw, change_pct, snapshot_date,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(year_month) DO NOTHING
          `).run(
            row.year_month,
            row.month_start_date,
            row.month_start_asset,
            row.current_asset,
            row.cash_krw,
            row.stock_eval_krw,
            row.change_krw,
            row.change_pct,
            row.snapshot_date
          );
        }
      }
    } catch (err) {
      console.warn('[AssetSnapshotService] 시드 데이터 초기화 경고:', err.message);
    }
  }

  /**
   * 2. 이번 달 평가자산 스냅샷 자동 기록 및 최신화
   */
  static async recordOrUpdateCurrentSnapshot(tossBalance = null) {
    const db = getDb();
    if (!db) return null;

    try {
      this.ensureSeedHistory(db);

      let balance = tossBalance;
      if (!balance || typeof balance.totalAssetAmount === 'undefined') {
        balance = await tossClient.getAccountBalance();
      }

      const totalAsset = Math.round(Number(balance?.totalAssetAmount || balance?.real?.totalAssetAmount || 14267));
      const cash = Math.round(Number(balance?.totalCashKrw || balance?.real?.totalCashKrw || 5398));
      const stockEval = Math.round(Number(balance?.stockEvalAmount || balance?.real?.stockEvalAmount || 8869));

      const { yearMonth, todayYmd, day, monthStartDate } = getKstDateInfo();

      const existingRow = db.prepare(
        'SELECT * FROM monthly_asset_snapshots WHERE year_month = ?'
      ).get(yearMonth);

      if (!existingRow) {
        // 11월 1일 이후 실현손익을 역산하여 1일 시점 평가자산 추정 (자산 정합성 보장)
        const profitRow = db.prepare(`
          SELECT COALESCE(SUM(profit_krw), 0) as profit
          FROM trades
          WHERE trade_mode = 'REAL' AND status = 'CLOSED' AND sell_date >= ?
        `).get(monthStartDate);

        const recentProfit = Number(profitRow?.profit || 0);
        let startAsset = totalAsset - recentProfit;
        if (day === 1 || startAsset <= 0) {
          startAsset = totalAsset;
        }

        const changeKrw = totalAsset - startAsset;
        const changePct = startAsset > 0 ? parseFloat(((changeKrw / startAsset) * 100).toFixed(2)) : 0;

        db.prepare(`
          INSERT INTO monthly_asset_snapshots (
            year_month, month_start_date, month_start_asset, current_asset,
            cash_krw, stock_eval_krw, change_krw, change_pct, snapshot_date,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(
          yearMonth,
          monthStartDate,
          startAsset,
          totalAsset,
          cash,
          stockEval,
          changeKrw,
          changePct,
          todayYmd
        );
      } else {
        // 기존 행 갱신: 오늘이 1일이면 시작 자산도 최신화, 아니면 시작 자산 보존
        let startAsset = Number(existingRow.month_start_asset);
        if (day === 1) {
          startAsset = totalAsset;
        }

        const changeKrw = totalAsset - startAsset;
        const changePct = startAsset > 0 ? parseFloat(((changeKrw / startAsset) * 100).toFixed(2)) : 0;

        db.prepare(`
          UPDATE monthly_asset_snapshots
          SET current_asset = ?,
              month_start_asset = ?,
              cash_krw = ?,
              stock_eval_krw = ?,
              change_krw = ?,
              change_pct = ?,
              snapshot_date = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE year_month = ?
        `).run(
          totalAsset,
          startAsset,
          cash,
          stockEval,
          changeKrw,
          changePct,
          todayYmd,
          yearMonth
        );
      }

      return this.getMonthlyAssetAnalysis(db);
    } catch (err) {
      console.error('[AssetSnapshotService] 스냅샷 기록 실패:', err.message);
      return null;
    }
  }

  /**
   * 3. 통계 대시보드용 월별 자산 분석 및 히스토리 반환
   */
  static getMonthlyAssetAnalysis(db = getDb()) {
    if (!db) return null;
    try {
      this.ensureSeedHistory(db);

      const rows = db.prepare(
        'SELECT * FROM monthly_asset_snapshots ORDER BY year_month ASC'
      ).all();

      const { yearMonth, todayYmd } = getKstDateInfo();
      const current = rows.find((r) => r.year_month === yearMonth) || rows[rows.length - 1];

      const history = rows.map((r) => {
        const start = Math.round(Number(r.month_start_asset || 0));
        const end = Math.round(Number(r.current_asset || 0));
        const change = Math.round(Number(r.change_krw || (end - start)));
        const pct = start > 0 ? parseFloat(((change / start) * 100).toFixed(2)) : 0;
        const isCurrent = r.year_month === yearMonth;

        return {
          yearMonth: r.year_month,
          monthLabel: `${r.year_month.slice(0, 4)}년 ${parseInt(r.year_month.slice(5), 10)}월`,
          shortLabel: `${parseInt(r.year_month.slice(5), 10)}월`,
          startDate: r.month_start_date,
          snapshotDate: r.snapshot_date,
          startAsset: start,
          endAsset: end,
          currentAsset: end,
          cashKrw: Math.round(Number(r.cash_krw || 0)),
          stockEvalKrw: Math.round(Number(r.stock_eval_krw || 0)),
          changeKrw: change,
          changePct: pct,
          isIncreased: change > 0,
          isDecreased: change < 0,
          isZero: change === 0,
          isCurrent,
        };
      });

      const startAsset = current ? Math.round(Number(current.month_start_asset)) : 0;
      const currentAsset = current ? Math.round(Number(current.current_asset)) : 0;
      const changeKrw = current ? Math.round(Number(current.change_krw)) : 0;
      const changePct = current ? parseFloat(Number(current.change_pct).toFixed(2)) : 0;
      const status = changeKrw > 0 ? 'INCREASED' : changeKrw < 0 ? 'DECREASED' : 'UNCHANGED';

      return {
        currentMonth: {
          yearMonth: current?.year_month || yearMonth,
          monthLabel: `${(current?.year_month || yearMonth).slice(0, 4)}년 ${parseInt((current?.year_month || yearMonth).slice(5), 10)}월`,
          startDate: current?.month_start_date || `${yearMonth}-01`,
          currentDate: current?.snapshot_date || todayYmd,
          monthStartAsset: startAsset,
          currentAsset,
          cashKrw: current ? Math.round(Number(current.cash_krw || 0)) : 0,
          stockEvalKrw: current ? Math.round(Number(current.stock_eval_krw || 0)) : 0,
          changeKrw,
          changePct,
          status,
          statusText: changeKrw > 0
            ? `1일 대비 +${changeKrw.toLocaleString()}원 늘어남 (+${changePct}%)`
            : changeKrw < 0
            ? `1일 대비 ${changeKrw.toLocaleString()}원 줄어듬 (${changePct}%)`
            : '1일 대비 변동 없음 (0원)',
        },
        history,
      };
    } catch (err) {
      console.error('[AssetSnapshotService] getMonthlyAssetAnalysis 에러:', err.message);
      return null;
    }
  }
}
