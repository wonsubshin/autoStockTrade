import { getDb } from '../db/index.mjs';
import { sendJson, sendError } from '../routes/router_helpers.mjs';

export class NewsController {
  static getNews(req, res, urlObj) {
    const db = getDb();
    const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
    const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;
    const q = urlObj.searchParams.get('q') || '';
    const tag = urlObj.searchParams.get('tag') || '';
    const startDate = urlObj.searchParams.get('startDate');
    const endDate = urlObj.searchParams.get('endDate');

    let whereClause = '1=1';
    const params = [];

    if (q) {
      whereClause += ' AND (title LIKE ? OR summary LIKE ? OR source LIKE ? OR keywords LIKE ?)';
      const queryTerm = `%${q}%`;
      params.push(queryTerm, queryTerm, queryTerm, queryTerm);
    }
    if (tag) {
      whereClause += ' AND keywords LIKE ?';
      params.push(`%${tag}%`);
    }
    if (startDate) {
      whereClause += ' AND published_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND published_at <= ?';
      params.push(endDate + 'T23:59:59.999Z');
    }

    const countSql = `SELECT COUNT(*) as total FROM stock_news WHERE ${whereClause}`;
    const total = db.prepare(countSql).get(...params).total;

    const listSql = `SELECT * FROM stock_news WHERE ${whereClause} ORDER BY published_at DESC LIMIT ? OFFSET ?`;
    const news = db.prepare(listSql).all(...params, limit, offset);

    const counts = db.prepare(`
      SELECT
        COUNT(*) as totalNews,
        SUM(CASE WHEN sentiment = 'BULLISH' THEN 1 ELSE 0 END) as bullishCount,
        SUM(CASE WHEN sentiment = 'BEARISH' THEN 1 ELSE 0 END) as bearishCount,
        SUM(CASE WHEN sentiment = 'NEUTRAL' THEN 1 ELSE 0 END) as neutralCount
      FROM stock_news
    `).get();

    return sendJson(res, 200, {
      news,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      counts: {
        total: counts.totalNews || 0,
        bullish: counts.bullishCount || 0,
        bearish: counts.bearishCount || 0,
        neutral: counts.neutralCount || 0,
      },
    });
  }

  static async postRefresh(req, res, newsService) {
    try {
      const result = await newsService.fetchAndSaveNews();
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  }
}
