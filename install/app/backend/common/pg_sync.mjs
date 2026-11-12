#!/usr/bin/env node
/**
 * backend/common/pg_sync.mjs
 * SQLite ⨉ PostgreSQL 격리 및 동기화 모듈
 * USE_POSTGRES=false 시 완전 격리되어 어떤 DB 연결도 시도하지 않고 안전 종료
 */

import '../db/pg_sync.mjs';
