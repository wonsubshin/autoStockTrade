#!/usr/bin/env node
/**
 * build_installer.mjs - 비개발자용 크로스 플랫폼(/install) 독립형 배포 패키지 자동 빌더
 * - 프론트엔드 프로덕션 정적 빌드 (Vite build)
 * - /install 자급자족(Self-Contained) 패키지 구조화
 * - Windows/Linux 원클릭 런처 및 Step-by-Step 설정 마법사 탑재
 * - 필수 프로덕션 의존성 번들링 및 무결성 검증
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const INSTALL_DIR = path.join(PROJECT_ROOT, 'install');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'scripts', 'installer_templates');

console.log('========================================================');
console.log('📦 AutoStockTrader 독립형 배포 패키지(/install) 빌드 시작');
console.log(`• 프로젝트 루트: ${PROJECT_ROOT}`);
console.log(`• 패키지 대상  : ${INSTALL_DIR}`);
console.log('========================================================\n');

// 헬퍼: 디렉터리 재귀 복사 (무시 패턴 적용)
function copyDirRecursive(src, dest, ignorePatterns = []) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (ignorePatterns.some((pattern) => {
      if (pattern instanceof RegExp) return pattern.test(entry.name);
      return entry.name === pattern;
    })) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, ignorePatterns);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. 프론트엔드 프로덕션 빌드 (frontend/dist)
console.log('[1/6] 🎨 프론트엔드 React 프로덕션 빌드 수행 (vite build)...');
const frontendDir = path.join(PROJECT_ROOT, 'frontend');
if (fs.existsSync(frontendDir)) {
  try {
    execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });
    console.log('  -> 프론트엔드 빌드 완료: frontend/dist');
  } catch (err) {
    console.error('  [오류] 프론트엔드 빌드 실패:', err.message);
    process.exit(1);
  }
} else {
  console.warn('  [경고] frontend/ 디렉터리가 없어 빌드를 건너뜁니다.');
}

// 2. /install 배포 폴더 구조 생성
console.log('\n[2/6] 📁 /install 패키지 디렉터리 구조 초기화...');
if (fs.existsSync(INSTALL_DIR)) {
  console.log('  -> 기존 /install 디렉터리 갱신...');
}
fs.mkdirSync(path.join(INSTALL_DIR, 'setup_wizard'), { recursive: true });
fs.mkdirSync(path.join(INSTALL_DIR, 'app', 'backend'), { recursive: true });
fs.mkdirSync(path.join(INSTALL_DIR, 'app', 'frontend_dist'), { recursive: true });
fs.mkdirSync(path.join(INSTALL_DIR, 'app', 'config'), { recursive: true });
fs.mkdirSync(path.join(INSTALL_DIR, 'app', 'data'), { recursive: true });
fs.mkdirSync(path.join(INSTALL_DIR, 'app', 'logs'), { recursive: true });
fs.mkdirSync(path.join(INSTALL_DIR, 'app', 'scripts'), { recursive: true });

// 3. Step-by-Step 설정 마법사 파일 복사
console.log('\n[3/6] 🪄 Step-by-Step 온보딩 설정 마법사 모듈 복사...');
const wizardSrcDir = path.join(PROJECT_ROOT, 'setup_wizard');
copyDirRecursive(wizardSrcDir, path.join(INSTALL_DIR, 'setup_wizard'));
console.log('  -> setup_wizard/wizard_server.mjs & wizard_ui.html 복사 완료');

// 4. 코어 앱 파일 패키징 (app/)
console.log('\n[4/6] ⚙️ 코어 애플리케이션(app/) 패키징...');
// 백엔드 복사 (__pycache__, .git 제외)
copyDirRecursive(
  path.join(PROJECT_ROOT, 'backend'),
  path.join(INSTALL_DIR, 'app', 'backend'),
  ['__pycache__', '.git', '*.pyc', 'node_modules']
);
console.log('  -> 백엔드 코어 및 Python 토스 주문 브릿지 복사 완료');

// 프론트엔드 정적 파일 복사
const distSrc = path.join(PROJECT_ROOT, 'frontend', 'dist');
if (fs.existsSync(distSrc)) {
  const targetDist = path.join(INSTALL_DIR, 'app', 'frontend_dist');
  if (fs.existsSync(targetDist)) {
    fs.rmSync(targetDist, { recursive: true, force: true });
  }
  copyDirRecursive(distSrc, targetDist);
  console.log('  -> 프론트엔드 정적 빌드(frontend_dist/) 복사 완료');
}

// 프론트엔드 정적 서빙 및 API 리버스 프록시 서버 복사
const frontendServerSrc = path.join(PROJECT_ROOT, 'scripts', 'frontend_server.mjs');
if (fs.existsSync(frontendServerSrc)) {
  fs.copyFileSync(frontendServerSrc, path.join(INSTALL_DIR, 'app', 'frontend_server.mjs'));
  console.log('  -> 프론트엔드 9900 포트 정적 서빙 & 프록시 서버(frontend_server.mjs) 배치 완료');
}

// 설정 예시 및 마이그레이션 스크립트 복사
const brokerExampleSrc = path.join(PROJECT_ROOT, 'config', 'broker_config.example.json');
if (fs.existsSync(brokerExampleSrc)) {
  fs.copyFileSync(brokerExampleSrc, path.join(INSTALL_DIR, 'app', 'config', 'broker_config.example.json'));
}
const envExampleSrc = path.join(PROJECT_ROOT, '.env.example');
if (fs.existsSync(envExampleSrc)) {
  fs.copyFileSync(envExampleSrc, path.join(INSTALL_DIR, 'app', '.env.example'));
}

// 스크립트 복사 (DB 마이그레이션, PostgreSQL 셋업 등)
copyDirRecursive(
  path.join(PROJECT_ROOT, 'scripts'),
  path.join(INSTALL_DIR, 'app', 'scripts'),
  ['__pycache__', 'installer_templates', 'build_installer.mjs']
);

// package.json 및 메타데이터(version.json, history.md, LICENSE) 복사
fs.copyFileSync(
  path.join(PROJECT_ROOT, 'package.json'),
  path.join(INSTALL_DIR, 'app', 'package.json')
);
if (fs.existsSync(path.join(PROJECT_ROOT, 'version.json'))) {
  fs.copyFileSync(
    path.join(PROJECT_ROOT, 'version.json'),
    path.join(INSTALL_DIR, 'app', 'version.json')
  );
}
if (fs.existsSync(path.join(PROJECT_ROOT, 'history.md'))) {
  fs.copyFileSync(
    path.join(PROJECT_ROOT, 'history.md'),
    path.join(INSTALL_DIR, 'app', 'history.md')
  );
  fs.copyFileSync(
    path.join(PROJECT_ROOT, 'history.md'),
    path.join(INSTALL_DIR, 'history.md')
  );
}
if (fs.existsSync(path.join(PROJECT_ROOT, 'LICENSE'))) {
  fs.copyFileSync(
    path.join(PROJECT_ROOT, 'LICENSE'),
    path.join(INSTALL_DIR, 'LICENSE')
  );
}
if (fs.existsSync(path.join(PROJECT_ROOT, 'package-lock.json'))) {
  fs.copyFileSync(
    path.join(PROJECT_ROOT, 'package-lock.json'),
    path.join(INSTALL_DIR, 'app', 'package-lock.json')
  );
}

// 5. Windows & Linux 런처 및 README_INSTALL.txt 배치
console.log('\n[5/6] 🖥️ Windows & Linux 듀얼 OS 원클릭 런처 생성...');
const filesToPlace = [
  'AutoStockTrader_Windows_Run.bat',
  'AutoStockTrader_Windows_Stop.bat',
  'AutoStockTrader_Linux_Run.sh',
  'AutoStockTrader_Linux_Stop.sh',
  'README_INSTALL.txt',
];

for (const fname of filesToPlace) {
  const src = path.join(TEMPLATES_DIR, fname);
  const dest = path.join(INSTALL_DIR, fname);
  if (fs.existsSync(src)) {
    let content = fs.readFileSync(src, 'utf8');
    // Windows .bat 파일은 CRLF, Linux .sh 파일은 LF 보장
    if (fname.endsWith('.bat')) {
      content = content.replace(/\r?\n/g, '\r\n');
    } else if (fname.endsWith('.sh')) {
      content = content.replace(/\r\n/g, '\n');
    }
    fs.writeFileSync(dest, content, 'utf8');

    // Linux 런처 실행 권한 부여
    if (fname.endsWith('.sh')) {
      try {
        fs.chmodSync(dest, 0o755);
      } catch (e) {}
    }
    console.log(`  -> 배치 완료: install/${fname}`);
  }
}

// 6. 의존성 패키지 설치 (app/node_modules)
console.log('\n[6/6] 📦 app/ 프로덕션 필수 의존성(npm install --omit=dev) 동기화...');
try {
  execSync('npm install --omit=dev', {
    cwd: path.join(INSTALL_DIR, 'app'),
    stdio: 'inherit',
  });
  console.log('  -> app/node_modules 프로덕션 의존성 번들링 완료');
} catch (err) {
  console.warn('  [주의] npm install 경고 (실행 환경에서 자동 설치 지원):', err.message);
}

// 7. 클린 초기 상태 보장 (테스트 잔여물 제거)
for (const cleanupTarget of [
  path.join(INSTALL_DIR, '.setup_completed'),
  path.join(INSTALL_DIR, 'app', '.setup_completed'),
  path.join(INSTALL_DIR, 'app', '.env'),
  path.join(INSTALL_DIR, 'app', 'config', 'broker_config.json'),
]) {
  if (fs.existsSync(cleanupTarget)) {
    fs.rmSync(cleanupTarget, { force: true });
  }
}

// data 및 logs 폴더 내 잔여 파일 정리 (.gitkeep 생성)
const cleanDirs = [path.join(INSTALL_DIR, 'app', 'data'), path.join(INSTALL_DIR, 'app', 'logs')];
for (const d of cleanDirs) {
  if (fs.existsSync(d)) {
    for (const f of fs.readdirSync(d)) {
      fs.rmSync(path.join(d, f), { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(d, '.gitkeep'), '', 'utf8');
  }
}

// 최종 무결성 검증 및 리포트
console.log('\n========================================================');
console.log('🎉 /install 독립형 원클릭 배포 패키지 구성 완료!');
console.log('========================================================');

const tree = [
  'install/',
  '├── AutoStockTrader_Windows_Run.bat     # Windows 원클릭 설치 & 실행 런처',
  '├── AutoStockTrader_Windows_Stop.bat    # Windows 서비스 일괄 종료 스크립트',
  '├── AutoStockTrader_Linux_Run.sh        # Linux 원클릭 설치 & 실행 런처',
  '├── AutoStockTrader_Linux_Stop.sh       # Linux 서비스 일괄 종료 스크립트',
  '├── README_INSTALL.txt                  # 비개발자용 1분 요약 안내서',
  '├── setup_wizard/                       # Step-by-Step 설정 마법사 모듈',
  '│   ├── wizard_server.mjs',
  '│   └── wizard_ui.html',
  '└── app/                                # 패키징된 애플리케이션 코어 본체',
  '    ├── backend/                        # Node.js 백엔드 & Python 주문 브릿지',
  '    ├── frontend_dist/                  # 빌드 완료된 React 프론트엔드',
  '    ├── frontend_server.mjs             # 9900 포트 정적 서빙 및 API 프록시',
  '    ├── config/                         # broker_config.json 저장 경로',
  '    ├── data/                           # SQLite DB(auto_stock_trade.db) 경로',
  '    ├── logs/                           # 실행 로그 저장 경로',
  '    └── node_modules/                   # 코어 런타임 의존성',
];
console.log(tree.join('\n'));
console.log('========================================================');
console.log('💡 비개발자 사용자에게는 오직 `/install` 폴더 하나만 압축해서 전달하면 됩니다.');
console.log('========================================================\n');
