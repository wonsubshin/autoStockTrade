// Web Push & Browser Notification Service for Auto Stock Trader

/**
 * Service Worker 등록 (W3C 표준 Web Push 및 백그라운드 푸시 알림)
 */
export function registerServiceWorker() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[NotificationService] ServiceWorker 등록 완료 (scope:', reg.scope, ')');
        })
        .catch((err) => {
          console.warn('[NotificationService] ServiceWorker 등록 실패:', err);
        });
    });
  }
}

/**
 * 브라우저 웹 알림 지원 여부 및 권한 상태 반환
 * @returns {'granted' | 'denied' | 'default' | 'unsupported'}
 */
export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * 브라우저 알림 권한 요청 (반드시 버튼 클릭 등 사용자 제스처 이벤트 내에서 호출 권장)
 * @returns {Promise<boolean>} 허용 여부
 */
export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  if (Notification.permission === 'denied') {
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (err) {
    console.warn('[NotificationService] 권한 요청 중 오류:', err);
    return false;
  }
}

/**
 * Web Audio API를 활용한 부드러운 2음 차임벨(Chime) 사운드 재생
 */
export function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    // 1st note: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // 2nd note: A5 (880.00 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.0, now + 0.12);
    gain2.gain.setValueAtTime(0.15, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.6);
  } catch (_) {
    // 오디오 컨텍스트 차단 시 무시
  }
}

/**
 * 웹푸시 알림 전송 메인 함수
 * - Service Worker showNotification 우선 호출 (백그라운드/PWA 표준)
 * - Service Worker 불가 시 window.Notification 폴백
 * - Web Audio 차임벨 사운드 병행 재생
 * 
 * @param {object} params
 * @param {string} [params.title='시황 분석이 끝났습니다'] 알림 제목
 * @param {string} [params.body='AI 증시 뉴스 및 한·미 시장 종합 분석이 완료되었습니다.'] 알림 본문
 * @param {string} [params.url='/'] 알림 클릭 시 이동할 URL
 * @param {string} [params.tag='market-analysis-done'] 동일 알림 그룹핑 태그
 * @returns {Promise<boolean>} 발송 성공 여부
 */
export async function sendMarketAnalysisPushNotification({
  title = '시황 분석이 끝났습니다',
  body = 'AI 증시 뉴스 및 한·미 시장 종합 분석이 완료되었습니다.',
  url = '/',
  tag = 'market-analysis-done',
} = {}) {
  // 1. 차임 사운드 재생
  playNotificationSound();

  // 2. 알림 미지원 브라우저 처리
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.log('[NotificationService] 브라우저가 Notification API를 지원하지 않습니다.');
    return false;
  }

  // 3. 권한 확인
  let permission = Notification.permission;
  if (permission !== 'granted') {
    if (permission === 'default') {
      const granted = await requestNotificationPermission();
      if (!granted) return false;
    } else {
      console.warn('[NotificationService] 알림 권한이 차단(denied)되어 있습니다.');
      return false;
    }
  }

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    renotify: true,
    data: { url },
    vibrate: [200, 100, 200],
  };

  // 4. Service Worker showNotification 시도
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, options);
        return true;
      }
    }
  } catch (swErr) {
    console.warn('[NotificationService] ServiceWorker showNotification 실패, window.Notification 폴백:', swErr);
  }

  // 5. window.Notification 폴백
  try {
    const notif = new Notification(title, options);
    notif.onclick = () => {
      try {
        window.focus();
      } catch (_) {}
      notif.close();
    };
    return true;
  } catch (notifErr) {
    console.warn('[NotificationService] window.Notification 발송 실패:', notifErr);
    return false;
  }
}

/**
 * 웹푸시 알림 테스트 발송 함수
 */
export async function testMarketAnalysisNotification() {
  const granted = await requestNotificationPermission();
  if (!granted) {
    return { success: false, permission: getNotificationPermission() };
  }
  const ok = await sendMarketAnalysisPushNotification({
    title: '시황 분석이 끝났습니다',
    body: '🔔 [테스트] 웹푸시 알림이 정상적으로 수신되었습니다. 뉴스 분석 완료 시 동일하게 발송됩니다.',
  });
  return { success: ok, permission: 'granted' };
}
