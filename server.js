// ─────────────────────────────────────────────
//  CHEF WANG 食谱 — Complete Backend Server
//  Node.js + Express + SQLite + DeepSeek AI
// ─────────────────────────────────────────────

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const http     = require('http');
const https    = require('https');
const Database = require('better-sqlite3');
// DeepSeek uses OpenAI-compatible REST API — no extra SDK needed

// ── App Setup ──────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve the frontend HTML file
app.use(express.static(path.join(__dirname)));

// ── File Upload Setup ──────────────────────────
// Photos are stored in /uploads folder temporarily
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('只支持 JPG、PNG、WEBP、GIF 格式的图片'));
  }
});

// ── SQLite Database Setup (better-sqlite3) ─────
// better-sqlite3 is synchronous and compiles reliably on Railway
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'chefwang.db');
const dbDir  = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
console.log(`✅ Connected to database: ${dbPath}`);

// ── Sync helper wrappers (keep same API surface as before) ──
const dbRun = (sql, params = []) => {
  const stmt   = db.prepare(sql);
  const result = stmt.run(params);
  return Promise.resolve({ id: result.lastInsertRowid, changes: result.changes });
};

const dbAll = (sql, params = []) => {
  const stmt = db.prepare(sql);
  return Promise.resolve(stmt.all(params));
};

const dbGet = (sql, params = []) => {
  const stmt = db.prepare(sql);
  return Promise.resolve(stmt.get(params));
};

// ── Create Tables ──────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    cuisine      TEXT    NOT NULL DEFAULT 'cn',
    method       TEXT    NOT NULL DEFAULT '煮',
    time_minutes INTEGER NOT NULL DEFAULT 30,
    servings     INTEGER NOT NULL DEFAULT 4,
    tags         TEXT    NOT NULL DEFAULT '[]',
    ingredients  TEXT    NOT NULL DEFAULT '[]',
    steps        TEXT    NOT NULL DEFAULT '[]',
    description  TEXT    DEFAULT '',
    source_type  TEXT    NOT NULL DEFAULT 'manual',
    source_url   TEXT    DEFAULT '',
    photo_url    TEXT    DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'draft',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Seed sample recipes if table is empty
const rowCount = db.prepare('SELECT COUNT(*) as count FROM recipes').get();
if (rowCount.count === 0) seedSampleRecipes();

// ── DeepSeek AI Helper ────────────────────────
// DeepSeek is OpenAI-compatible, so we call it directly over HTTPS
async function callDeepSeek(messages, max_tokens = 2000) {
  const body = JSON.stringify({
    model: 'deepseek-chat',
    max_tokens,
    messages
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message || 'DeepSeek API error'));
          else resolve(json.choices[0].message.content.trim());
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseAIJson(raw) {
  const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(clean);
}

// ═══════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════

// ── GET /health ────────────────────────────────
// Railway uses this to confirm the app is running
app.get('/health', (req, res) => res.json({ status: 'ok', app: 'CHEF WANG 食谱' }));

// ── GET /api/recipes ───────────────────────────
// Fetch all recipes with optional filters
// Query params: cuisine, method, tag, search, sort, status
app.get('/api/recipes', async (req, res) => {
  try {
    const { cuisine, method, tag, search, sort = 'newest', status = 'published' } = req.query;

    let sql = 'SELECT * FROM recipes WHERE 1=1';
    const params = [];

    if (status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (cuisine && cuisine !== 'all') {
      sql += ' AND cuisine = ?';
      params.push(cuisine);
    }
    if (method) {
      sql += ' AND method = ?';
      params.push(method);
    }
    if (search) {
      sql += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (tag) {
      sql += ' AND tags LIKE ?';
      params.push(`%${tag}%`);
    }

    // Sort order
    if (sort === 'time')   sql += ' ORDER BY time_minutes ASC';
    else if (sort === 'az') sql += ' ORDER BY title ASC';
    else                    sql += ' ORDER BY created_at DESC';

    const rows = await dbAll(sql, params);

    // Parse JSON fields
    const recipes = rows.map(parseRecipeRow);

    res.json({ success: true, count: recipes.length, recipes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/recipes/:id ───────────────────────
// Fetch a single recipe by ID
app.get('/api/recipes/:id', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM recipes WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ success: false, error: '食谱不存在' });
    res.json({ success: true, recipe: parseRecipeRow(row) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/recipes ──────────────────────────
// Add a new recipe manually
app.post('/api/recipes', async (req, res) => {
  try {
    const {
      title, cuisine = 'cn', method = '煮',
      time_minutes = 30, servings = 4,
      tags = [], ingredients = [], steps = [],
      description = '', source_url = '',
      photo_url = '', status = 'draft'
    } = req.body;

    if (!title) return res.status(400).json({ success: false, error: '食谱名称不能为空' });

    const result = await dbRun(
      `INSERT INTO recipes
        (title, cuisine, method, time_minutes, servings, tags, ingredients, steps,
         description, source_type, source_url, photo_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
      [
        title, cuisine, method, time_minutes, servings,
        JSON.stringify(tags),
        JSON.stringify(ingredients),
        JSON.stringify(steps),
        description, source_url, photo_url, status
      ]
    );

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [result.id]);
    res.status(201).json({ success: true, recipe: parseRecipeRow(recipe) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/recipes/:id ───────────────────────
// Update an existing recipe
app.put('/api/recipes/:id', async (req, res) => {
  try {
    const existing = await dbGet('SELECT * FROM recipes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: '食谱不存在' });

    const {
      title, cuisine, method, time_minutes, servings,
      tags, ingredients, steps, description,
      source_url, photo_url, status
    } = req.body;

    await dbRun(
      `UPDATE recipes SET
        title        = COALESCE(?, title),
        cuisine      = COALESCE(?, cuisine),
        method       = COALESCE(?, method),
        time_minutes = COALESCE(?, time_minutes),
        servings     = COALESCE(?, servings),
        tags         = COALESCE(?, tags),
        ingredients  = COALESCE(?, ingredients),
        steps        = COALESCE(?, steps),
        description  = COALESCE(?, description),
        source_url   = COALESCE(?, source_url),
        photo_url    = COALESCE(?, photo_url),
        status       = COALESCE(?, status),
        updated_at   = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        title, cuisine, method, time_minutes, servings,
        tags ? JSON.stringify(tags) : null,
        ingredients ? JSON.stringify(ingredients) : null,
        steps ? JSON.stringify(steps) : null,
        description, source_url, photo_url, status,
        req.params.id
      ]
    );

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [req.params.id]);
    res.json({ success: true, recipe: parseRecipeRow(recipe) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/recipes/:id/publish ────────────
// Approve and publish a draft recipe
app.patch('/api/recipes/:id/publish', async (req, res) => {
  try {
    const result = await dbRun(
      'UPDATE recipes SET status = "published", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [req.params.id]
    );
    if (result.changes === 0) return res.status(404).json({ success: false, error: '食谱不存在' });
    res.json({ success: true, message: '食谱已发布' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/recipes/:id ────────────────────
// Delete a recipe
app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM recipes WHERE id = ?', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ success: false, error: '食谱不存在' });
    res.json({ success: true, message: '食谱已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/import/photo ─────────────────────
// Upload a photo → Claude AI extracts the recipe
app.post('/api/import/photo', upload.single('photo'), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传图片文件' });

    filePath = req.file.path;

    if (!process.env.DEEPSEEK_API_KEY) {
      return res.status(400).json({
        success: false,
        error: '请在 .env 文件中设置 DEEPSEEK_API_KEY'
      });
    }

    // DeepSeek does not support image input — describe the file and ask AI to create a template
    // For best results, rename your photo file to the dish name before uploading
    const fileName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const prompt = `用户上传了一张名为"${fileName}"的食谱图片。请根据这道菜名生成一份完整的食谱，以 JSON 格式返回，只返回 JSON，不要任何其他文字。格式如下：
{
  "title": "食谱名称",
  "description": "简短描述（1-2句话）",
  "cuisine": "cn 或 wn（中餐用cn，西餐用wn）",
  "method": "炸、蒸、烤、煮、炒、煎 中的一个",
  "time_minutes": 数字,
  "servings": 数字,
  "tags": ["标签1", "标签2"],
  "ingredients": [{ "name": "食材名", "qty": "用量" }],
  "steps": ["第一步", "第二步"]
}`;

    const rawText = await callDeepSeek([{ role: 'user', content: prompt }]);
    const extracted = parseAIJson(rawText);

    if (extracted.error) {
      return res.status(422).json({ success: false, error: extracted.error });
    }

    // Save as draft recipe
    const result = await dbRun(
      `INSERT INTO recipes
        (title, cuisine, method, time_minutes, servings, tags, ingredients, steps,
         description, source_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'photo', 'draft')`,
      [
        extracted.title,
        extracted.cuisine || 'cn',
        extracted.method  || '煮',
        extracted.time_minutes || 30,
        extracted.servings     || 4,
        JSON.stringify(extracted.tags        || []),
        JSON.stringify(extracted.ingredients || []),
        JSON.stringify(extracted.steps       || []),
        extracted.description || ''
      ]
    );

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [result.id]);
    res.json({ success: true, recipe: parseRecipeRow(recipe), message: 'AI 已提取食谱，请审核后发布' });

  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(422).json({ success: false, error: 'AI 返回格式错误，请重试' });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  } finally {
    // Clean up temp file
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// ── POST /api/import/url ───────────────────────
// Import recipe from a URL → Claude AI extracts it
app.post('/api/import/url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: '请提供食谱链接' });

    if (!process.env.DEEPSEEK_API_KEY) {
      return res.status(400).json({
        success: false,
        error: '请在 .env 文件中设置 DEEPSEEK_API_KEY'
      });
    }

    // Fetch the page content using Node built-in https/http (no node-fetch needed)
    const html = await new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChefWangBot/1.0)' },
        timeout: 10000
      };
      const req2 = lib.request(options, (response) => {
        // Follow redirects (301, 302, 307, 308)
        if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
          const redirectUrl = new URL(response.headers.location, url).toString();
          const lib2 = redirectUrl.startsWith('https') ? https : http;
          lib2.get(redirectUrl, { headers: options.headers }, (res2) => {
            let data = '';
            res2.on('data', chunk => data += chunk);
            res2.on('end', () => resolve(data));
            res2.on('error', reject);
          }).on('error', reject);
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 400) {
          reject(new Error(`无法访问该网址 (${response.statusCode})`));
          response.resume();
          return;
        }
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
        response.on('error', reject);
      });
      req2.on('error', reject);
      req2.on('timeout', () => { req2.destroy(); reject(new Error('请求超时，请检查链接是否有效')); });
      req2.end();
    });

    // Strip HTML tags for a cleaner text input to Claude
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 8000); // Limit to 8000 chars

    // Ask DeepSeek to extract the recipe from the page text
    const prompt = `从以下网页内容中提取食谱，以 JSON 格式返回，只返回 JSON，不要其他文字。

格式：
{
  "title": "食谱名称",
  "description": "简短描述",
  "cuisine": "cn 或 wn",
  "method": "炸、蒸、烤、煮、炒、煎 之一",
  "time_minutes": 数字,
  "servings": 数字,
  "tags": ["标签"],
  "ingredients": [{ "name": "食材", "qty": "用量" }],
  "steps": ["步骤1", "步骤2"]
}

如果找不到食谱，返回 { "error": "未找到食谱内容" }

网页内容：
${text}`;

    const rawText = await callDeepSeek([{ role: 'user', content: prompt }]);
    const extracted = parseAIJson(rawText);

    if (extracted.error) {
      return res.status(422).json({ success: false, error: extracted.error });
    }

    // Save as draft
    const result = await dbRun(
      `INSERT INTO recipes
        (title, cuisine, method, time_minutes, servings, tags, ingredients, steps,
         description, source_type, source_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'url', ?, 'draft')`,
      [
        extracted.title,
        extracted.cuisine || 'cn',
        extracted.method  || '煮',
        extracted.time_minutes || 30,
        extracted.servings     || 4,
        JSON.stringify(extracted.tags        || []),
        JSON.stringify(extracted.ingredients || []),
        JSON.stringify(extracted.steps       || []),
        extracted.description || '',
        url
      ]
    );

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [result.id]);
    res.json({ success: true, recipe: parseRecipeRow(recipe), message: 'AI 已从链接提取食谱，请审核后发布' });

  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(422).json({ success: false, error: 'AI 返回格式错误，请重试' });
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// ── GET /api/suggest ───────────────────────────
// AI-powered recipe suggestions based on existing collection
app.get('/api/suggest', async (req, res) => {
  try {
    if (!process.env.DEEPSEEK_API_KEY) {
      return res.json({ success: true, suggestions: defaultSuggestions() });
    }

    const existing = await dbAll(
      "SELECT title, cuisine, method FROM recipes WHERE status = 'published' LIMIT 20"
    );

    const titles = existing.map(r => `${r.title} (${r.cuisine === 'cn' ? '中餐' : '西餐'}, ${r.method})`).join('\n');

    const prompt = `这是一个名为 CHEF WANG 的社区食谱网站，目前收录了以下食谱：
${titles}

请推荐 3 道还没有收录的食谱，要与已有食谱风格搭配，JSON 格式返回，只返回 JSON：
[
  { "title": "食谱名", "cuisine": "cn 或 wn", "method": "炸蒸烤煮炒煎之一" }
]`;

    const rawText = await callDeepSeek([{ role: 'user', content: prompt }], 500);
    const suggestions = parseAIJson(rawText);

    res.json({ success: true, suggestions });
  } catch (err) {
    res.json({ success: true, suggestions: defaultSuggestions() });
  }
});

// ── GET /api/stats ─────────────────────────────
// Dashboard stats
app.get('/api/stats', async (req, res) => {
  try {
    const total   = await dbGet("SELECT COUNT(*) as n FROM recipes WHERE status = 'published'");
    const cn      = await dbGet("SELECT COUNT(*) as n FROM recipes WHERE cuisine = 'cn' AND status = 'published'");
    const wn      = await dbGet("SELECT COUNT(*) as n FROM recipes WHERE cuisine = 'wn' AND status = 'published'");
    const drafts  = await dbGet("SELECT COUNT(*) as n FROM recipes WHERE status = 'draft'");
    const methods = await dbAll(
      "SELECT method, COUNT(*) as count FROM recipes WHERE status = 'published' GROUP BY method ORDER BY count DESC"
    );

    res.json({
      success: true,
      stats: {
        total:   total.n,
        chinese: cn.n,
        western: wn.n,
        drafts:  drafts.n,
        methods
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/drafts ────────────────────────────
// Get all draft recipes (for admin review)
app.get('/api/drafts', async (req, res) => {
  try {
    const rows = await dbAll("SELECT * FROM recipes WHERE status = 'draft' ORDER BY created_at DESC");
    res.json({ success: true, drafts: rows.map(parseRecipeRow) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Serve frontend for all other routes ────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ═══════════════════════════════════════════════
//  HELPER FUNCTIONS
// ═══════════════════════════════════════════════

function parseRecipeRow(row) {
  return {
    ...row,
    tags:        safeParseJSON(row.tags,        []),
    ingredients: safeParseJSON(row.ingredients, []),
    steps:       safeParseJSON(row.steps,       [])
  };
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); }
  catch { return fallback; }
}

function defaultSuggestions() {
  return [
    { title: '清蒸排骨配豆豉', cuisine: 'cn', method: '蒸' },
    { title: '香煎三文鱼配柠檬黄油', cuisine: 'wn', method: '煎' },
    { title: '蒜蓉炒菜心', cuisine: 'cn', method: '炒' }
  ];
}

// ── Sample Data Seeder ─────────────────────────
async function seedSampleRecipes() {
  const samples = [
    {
      title: '皮蛋瘦肉粥配姜丝',
      cuisine: 'cn', method: '煮', time_minutes: 35, servings: 2,
      tags: JSON.stringify(['家常']),
      description: '广式经典早餐粥，绵滑顺口。',
      ingredients: JSON.stringify([
        { name: '大米', qty: '100g' }, { name: '瘦肉', qty: '150g' },
        { name: '皮蛋', qty: '2个' }, { name: '生姜', qty: '30g' }
      ]),
      steps: JSON.stringify([
        '大米洗净，加少许油和盐腌制 10 分钟。',
        '瘦肉切丝，加生抽、淀粉腌制 15 分钟。',
        '皮蛋去壳切块，姜切丝。',
        '锅中水烧开，放入大米，大火煮开转小火熬 20 分钟。',
        '放入肉丝搅散，煮 5 分钟，加入皮蛋，调盐，淋香油上桌。'
      ]),
      source_type: 'manual', status: 'published'
    },
    {
      title: '清蒸鲈鱼配姜葱',
      cuisine: 'cn', method: '蒸', time_minutes: 25, servings: 3,
      tags: JSON.stringify(['快手菜', '低卡']),
      description: '鲜嫩清淡，最能品出鱼鲜的做法。',
      ingredients: JSON.stringify([
        { name: '鲈鱼', qty: '1条约600g' }, { name: '生姜', qty: '40g' },
        { name: '葱', qty: '3根' }, { name: '蒸鱼豉油', qty: '3汤匙' },
        { name: '食用油', qty: '2汤匙' }
      ]),
      steps: JSON.stringify([
        '鲈鱼洗净，两面划刀，盐抹匀腌 10 分钟。',
        '姜切片铺盘底，鱼放上面，入蒸锅大火蒸 8-10 分钟。',
        '倒掉盘中多余水分，铺上姜丝葱丝，淋蒸鱼豉油。',
        '热油烧至冒烟，迅速淋在鱼上激香即可。'
      ]),
      source_type: 'manual', status: 'published'
    },
    {
      title: '干炒牛河',
      cuisine: 'cn', method: '炒', time_minutes: 20, servings: 2,
      tags: JSON.stringify(['快手菜']),
      description: '镬气十足的广式经典，讲究大火快炒。',
      ingredients: JSON.stringify([
        { name: '河粉', qty: '300g' }, { name: '牛肉', qty: '150g' },
        { name: '豆芽', qty: '100g' }, { name: '葱', qty: '2根' },
        { name: '生抽', qty: '2汤匙' }, { name: '老抽', qty: '1茶匙' }
      ]),
      steps: JSON.stringify([
        '牛肉切薄片，加生抽、淀粉、小苏打腌制 20 分钟。',
        '河粉用手轻轻分开，避免黏连。',
        '锅烧至极热，下牛肉大火快炒至半熟盛出。',
        '原锅下河粉，翻炒上色，加入牛肉、豆芽、葱段同炒，调味出锅。'
      ]),
      source_type: 'manual', status: 'published'
    },
    {
      title: '希腊柠檬烤鸡腿',
      cuisine: 'wn', method: '烤', time_minutes: 60, servings: 4,
      tags: JSON.stringify(['聚会']),
      description: '地中海香草腌制，外脆内嫩，聚会必备。',
      ingredients: JSON.stringify([
        { name: '鸡腿', qty: '8只' }, { name: '柠檬', qty: '2个' },
        { name: '大蒜', qty: '8瓣' }, { name: '橄榄油', qty: '4汤匙' },
        { name: '牛至叶', qty: '2茶匙' }, { name: '百里香', qty: '1茶匙' }
      ]),
      steps: JSON.stringify([
        '柠檬汁、蒜末、橄榄油、香草、盐和黑胡椒混合成腌料。',
        '鸡腿放入腌料中腌制至少 2 小时，隔夜更佳。',
        '烤箱预热至 200°C，鸡腿摆入烤盘，淋上剩余腌料。',
        '烤 40-45 分钟，中途翻面一次至表皮金黄酥脆。',
        '出炉前 5 分钟开启烧烤模式，配沙拉享用。'
      ]),
      source_type: 'manual', status: 'published'
    },
    {
      title: '红焖羊肉配橄榄与柠檬',
      cuisine: 'wn', method: '煮', time_minutes: 180, servings: 6,
      tags: JSON.stringify(['周末', '聚会']),
      description: '四小时慢炖，地中海风味的周日大菜。',
      ingredients: JSON.stringify([
        { name: '羊肩肉', qty: '1.2kg' }, { name: '橄榄', qty: '200g' },
        { name: '柠檬', qty: '2个' }, { name: '番茄罐头', qty: '400g' },
        { name: '大蒜', qty: '6瓣' }, { name: '红酒', qty: '200ml' }
      ]),
      steps: JSON.stringify([
        '羊肉切大块，盐和黑胡椒腌制 30 分钟。',
        '厚底锅大火热油，将羊肉每面煎至金黄后取出。',
        '同锅炒香蒜，加红酒煮至蒸发，约 3 分钟。',
        '加番茄、橄榄、迷迭香和柠檬皮，放回羊肉，水没过食材。',
        '大火烧开转小火慢炖 2.5 小时，出锅前挤柠檬汁调味。'
      ]),
      source_type: 'photo', status: 'published'
    }
  ];

  for (const r of samples) {
    await dbRun(
      `INSERT INTO recipes
        (title, cuisine, method, time_minutes, servings, tags, ingredients, steps,
         description, source_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.title, r.cuisine, r.method, r.time_minutes, r.servings,
       r.tags, r.ingredients, r.steps, r.description, r.source_type, r.status]
    );
  }
  console.log('✅ Sample recipes seeded');
}

// ── Start Server ───────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  🍜  CHEF WANG 食谱 server running');
  console.log(`  👉  http://localhost:${PORT}`);
  console.log('');
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('  ⚠️  DEEPSEEK_API_KEY not set — AI features disabled');
    console.warn('      Add it to a .env file to enable URL import & AI suggestions\n');
  }
});
