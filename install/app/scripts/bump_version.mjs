#!/usr/bin/env node
/**
 * bump_version.mjs - autoStockTrader 0.0.X 버전 자동 증가 유틸리티
 * 
 * [버전 정책]
 * - 기본 형식: 0.0.X (Git commit 1건당 patch 버전 1씩 증가)
 * - 실행 시: version.json, 루트 package.json, frontend/package.json, install/app/package.json 일괄 갱신
 * - 사용법:
 *     node scripts/bump_version.mjs          # 자동으로 0.0.(X+1)로 증가
 *     node scripts/bump_version.mjs 0.0.8    # 특정 버전 지정
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const versionJsonPath = path.join(ROOT_DIR, 'version.json');
const rootPkgPath = path.join(ROOT_DIR, 'package.json');
const frontPkgPath = path.join(ROOT_DIR, 'frontend', 'package.json');
const installPkgPath = path.join(ROOT_DIR, 'install', 'app', 'package.json');

// 1. 현재 버전 읽기
let currentVersion = '0.0.7';
if (fs.existsSync(versionJsonPath)) {
  try {
    const raw = fs.readFileSync(versionJsonPath, 'utf-8');
    currentVersion = JSON.parse(raw).version || '0.0.7';
  } catch {}
}

// 2. 새 버전 계산
let targetVersion = process.argv[2];
if (!targetVersion) {
  const parts = currentVersion.split('.');
  if (parts.length === 3 && !isNaN(parseInt(parts[2], 10))) {
    const patch = parseInt(parts[2], 10) + 1;
    targetVersion = `${parts[0]}.${parts[1]}.${patch}`;
  } else {
    targetVersion = '0.0.8';
  }
}

console.log(`\n========================================================`);
console.log(`🚀 autoStockTrader Version Bump`);
console.log(`• 현재 버전: v${currentVersion}`);
console.log(`• 변경 버전: v${targetVersion}`);
console.log(`• 버전 규칙: 0.0.X (Git commit 1건당 1씩 증가)`);
console.log(`========================================================\n`);

// 3. version.json 갱신
const today = new Date().toISOString().slice(0, 10);
const versionData = {
  version: targetVersion,
  format: '0.0.X',
  rule: 'Git commit 1건당 patch 버전 1씩 증가 (0.0.1부터 순차 증가)',
  lastUpdated: today,
};
fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2) + '\n', 'utf-8');
console.log(`✅ [OK] ${path.relative(ROOT_DIR, versionJsonPath)} -> ${targetVersion}`);

// 4. package.json 파일들 갱신
function updatePackageJson(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      data.version = targetVersion;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      console.log(`✅ [OK] ${path.relative(ROOT_DIR, filePath)} -> ${targetVersion}`);
    } catch (e) {
      console.error(`❌ [Error] ${filePath}:`, e.message);
    }
  }
}

updatePackageJson(rootPkgPath);
updatePackageJson(frontPkgPath);
updatePackageJson(installPkgPath);

console.log(`\n🎉 버전이 v${targetVersion} 으로 성공적으로 업데이트되었습니다.`);
console.log(`📌 history.md에 v${targetVersion} 변경 내역을 작성한 후 Git 커밋을 진행하세요.\n`);
