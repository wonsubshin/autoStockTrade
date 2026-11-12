/**
 * notification_service.mjs - 실시간 웹훅 알림 서비스
 * - 텔레그램 (Telegram Bot API) 및 디스코드 (Discord Webhook) 연동
 * - 실전 매매 체결 (BUY / SELL) 즉시 발송
 * - Gemini API 서킷 브레이커 발동 및 순수 퀀트 50% Fallback 전환 즉시 경보
 * - 비동기 Fire-and-Forget 안전 처리 (웹훅 오류로 인한 주문 중단 원천 차단)
 */

import { getDb } from '../db/index.mjs';

export class NotificationService {
  static getWebhookConfig() {
    let tgToken = process.env.TELEGRAM_BOT_TOKEN || '';
    let tgChatId = process.env.TELEGRAM_CHAT_ID || '';
    let discordUrl = process.env.DISCORD_WEBHOOK_URL || '';

    try {
      const db = getDb();
      if (db) {
        if (!tgToken) {
          const row = db.prepare("SELECT value FROM system_settings WHERE key = 'telegram_bot_token'").get();
          if (row && row.value) tgToken = row.value.trim();
        }
        if (!tgChatId) {
          const row = db.prepare("SELECT value FROM system_settings WHERE key = 'telegram_chat_id'").get();
          if (row && row.value) tgChatId = row.value.trim();
        }
        if (!discordUrl) {
          const row = db.prepare("SELECT value FROM system_settings WHERE key = 'discord_webhook_url'").get();
          if (row && row.value) discordUrl = row.value.trim();
        }
      }
    } catch (e) {}

    return { tgToken, tgChatId, discordUrl };
  }

  /**
   * 텔레그램 메시지 발송
   */
  static async sendTelegram(message) {
    const { tgToken, tgChatId } = this.getWebhookConfig();
    if (!tgToken || !tgChatId) return false;

    try {
      const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgChatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch (err) {
      console.warn('[NotificationService] 텔레그램 전송 실패:', err.message);
      return false;
    }
  }

  /**
   * 디스코드 웹훅 발송
   */
  static async sendDiscord(content) {
    const { discordUrl } = this.getWebhookConfig();
    if (!discordUrl) return false;

    try {
      const res = await fetch(discordUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch (err) {
      console.warn('[NotificationService] 디스코드 전송 실패:', err.message);
      return false;
    }
  }

  /**
   * 통합 알림 전송 (텔레그램 + 디스코드)
   */
  static async broadcast(messageText, rawMarkdown = null) {
    const promises = [];
    promises.push(this.sendTelegram(messageText));
    promises.push(this.sendDiscord(rawMarkdown || messageText.replace(/<[^>]*>/g, '')));
    return Promise.allSettled(promises);
  }

  /**
   * 4.3 실전 매매 체결 알림 발송
   */
  static notifyRealTrade({
    botName,
    botNickname,
    side, // 'BUY' | 'SELL'
    stockName,
    stockCode,
    price,
    qty,
    amount,
    reason = '',
    orderId = '',
    profitKrw = null,
    profitPct = null,
  }) {
    const isBuy = side === 'BUY';
    const sideEmoji = isBuy ? '🟢 [실전 매수 체결]' : '🔴 [실전 매도 청산]';
    const nowKst = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());

    let profitText = '';
    if (!isBuy && profitKrw !== null) {
      const sign = profitKrw >= 0 ? '+' : '';
      profitText = `\n💰 <b>실현손익:</b> ${sign}${Math.round(profitKrw).toLocaleString()}원 (${sign}${Number(profitPct).toFixed(2)}%)`;
    }

    const tgHtml = `
<b>${sideEmoji} autoStockTrader</b>
⏰ <b>시간:</b> ${nowKst}
🤖 <b>담당 봇:</b> ${botNickname || botName || '실전 봇'}
📌 <b>종목:</b> ${stockName} (${stockCode})
📊 <b>체결단가:</b> ${typeof price === 'number' ? price.toLocaleString() : price}원
📦 <b>체결수량:</b> ${qty}주
💵 <b>주문금액:</b> ${Math.round(amount || 0).toLocaleString()}원${profitText}
📝 <b>사유:</b> ${reason || '알고리즘 시그널'}
🔖 <b>주문번호:</b> <code>${orderId || 'TOSS_AUTO'}</code>
    `.trim();

    const plainText = `
${sideEmoji} autoStockTrader
⏰ 시간: ${nowKst}
🤖 담당 봇: ${botNickname || botName || '실전 봇'}
📌 종목: ${stockName} (${stockCode})
📊 체결단가: ${typeof price === 'number' ? price.toLocaleString() : price}원 | 수량: ${qty}주
💵 주문금액: ${Math.round(amount || 0).toLocaleString()}원${profitText ? profitText.replace(/<[^>]*>/g, '') : ''}
📝 사유: ${reason || '알고리즘 시그널'} (주문번호: ${orderId || 'TOSS_AUTO'})
    `.trim();

    this.broadcast(tgHtml, plainText).catch(() => {});
  }

  /**
   * 4.3 Gemini API 서킷 브레이커 발동 및 50% 순수 퀀트 Fallback 전환 알림
   */
  static notifyCircuitBreaker({
    modelName = 'Gemini',
    failureCount = 3,
    cooldownMin = 15,
    reason = '',
  }) {
    const nowKst = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());

    const tgHtml = `
🚨 <b>[Gemini API 서킷 브레이커 발동 경보]</b>
⏰ <b>일시:</b> ${nowKst}
⚠️ <b>상태:</b> API 호출 연속 ${failureCount}회 장애 감지
🛡️ <b>조치:</b> 향후 ${cooldownMin}분 동안 API 호출 자동 차단
⚡ <b>운용 모드:</b> <b>순수 퀀트 알고리즘 50% 분할 매매 Fallback 모드</b>로 자동 안전 전환
🔍 <b>오류 원인:</b> <code>${reason || 'HTTP 429 Rate Limit / 할당량 초과'}</code>
    `.trim();

    const plainText = `
🚨 [Gemini API 서킷 브레이커 발동 경보]
⏰ 일시: ${nowKst}
⚠️ 상태: ${modelName} API 연속 ${failureCount}회 장애 감지
🛡️ 조치: 향후 ${cooldownMin}분 동안 API 호출 자동 차단
⚡ 운용 모드: 순수 퀀트 알고리즘 50% 분할 매매 Fallback 모드로 자동 안전 전환
🔍 오류 원인: ${reason || 'HTTP 429 Rate Limit / 할당량 초과'}
    `.trim();

    this.broadcast(tgHtml, plainText).catch(() => {});
  }
}

export const notificationService = NotificationService;
