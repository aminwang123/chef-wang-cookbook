// ─────────────────────────────────────────────
//  CHEF WANG 食谱 — Complete Backend Server
//  Node.js + Express + JSON storage + DeepSeek AI
//  No native modules — works on every platform
// ─────────────────────────────────────────────

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ── File Upload ────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype);
    ok ? cb(null, true) : cb(new Error('只支持 JPG、PNG、WEBP、GIF 格式的图片'));
  }
});

// ── JSON File Database ─────────────────────────
// Pure JavaScript — no native compilation needed
// Data stored in data/recipes.json
const dataDir  = process.env.DATA_DIR || path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'recipes.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function readDB() {
  try {
    if (!fs.existsSync(dataFile)) return { recipes: [], nextId: 1 };
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch { return { recipes: [], nextId: 1 }; }
}

function writeDB(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

// Seed sample data on first run
if (!fs.existsSync(dataFile)) {
  const now = new Date().toISOString();
  writeDB({
    nextId: 6,
    recipes: [
      { id:1, title:'皮蛋瘦肉粥配姜丝', cuisine:'cn', method:'煮', time_minutes:35, servings:2, tags:['家常'], description:'广式经典早餐粥，绵滑顺口。', ingredients:[{name:'大米',qty:'100g'},{name:'瘦肉',qty:'150g'},{name:'皮蛋',qty:'2个'},{name:'生姜',qty:'30g'}], steps:['大米洗净，加少许油和盐腌制 10 分钟。','瘦肉切丝，加生抽、淀粉腌制 15 分钟。','皮蛋去壳切块，姜切丝。','锅中水烧开，放入大米，大火煮开转小火熬 20 分钟。','放入肉丝搅散，煮 5 分钟，加入皮蛋，调盐，淋香油上桌。'], source_type:'manual', source_url:'', photo_url:'', status:'published', created_at:now, updated_at:now },
      { id:2, title:'清蒸鲈鱼配姜葱', cuisine:'cn', method:'蒸', time_minutes:25, servings:3, tags:['快手菜','低卡'], description:'鲜嫩清淡，最能品出鱼鲜的做法。', ingredients:[{name:'鲈鱼',qty:'1条约600g'},{name:'生姜',qty:'40g'},{name:'葱',qty:'3根'},{name:'蒸鱼豉油',qty:'3汤匙'}], steps:['鲈鱼洗净，两面划刀，盐抹匀腌 10 分钟。','姜切片铺盘底，鱼放上面，入蒸锅大火蒸 8-10 分钟。','倒掉盘中多余水分，铺上姜丝葱丝，淋蒸鱼豉油。','热油烧至冒烟，迅速淋在鱼上激香即可。'], source_type:'manual', source_url:'', photo_url:'', status:'published', created_at:now, updated_at:now },
      { id:3, title:'干炒牛河', cuisine:'cn', method:'炒', time_minutes:20, servings:2, tags:['快手菜'], description:'镬气十足的广式经典，讲究大火快炒。', ingredients:[{name:'河粉',qty:'300g'},{name:'牛肉',qty:'150g'},{name:'豆芽',qty:'100g'},{name:'生抽',qty:'2汤匙'}], steps:['牛肉切薄片，加生抽、淀粉腌制 20 分钟。','河粉用手轻轻分开，避免黏连。','锅烧至极热，下牛肉大火快炒至半熟盛出。','原锅下河粉，翻炒上色，加入牛肉、豆芽同炒，调味出锅。'], source_type:'manual', source_url:'', photo_url:'', status:'published', created_at:now, updated_at:now },
      { id:4, title:'希腊柠檬烤鸡腿', cuisine:'wn', method:'烤', time_minutes:60, servings:4, tags:['聚会'], description:'地中海香草腌制，外脆内嫩，聚会必备。', ingredients:[{name:'鸡腿',qty:'8只'},{name:'柠檬',qty:'2个'},{name:'大蒜',qty:'8瓣'},{name:'橄榄油',qty:'4汤匙'}], steps:['柠檬汁、蒜末、橄榄油、香草、盐混合成腌料。','鸡腿放入腌料腌制至少 2 小时。','烤箱预热 200°C，烤 40-45 分钟至表皮金黄酥脆。'], source_type:'manual', source_url:'', photo_url:'', status:'published', created_at:now, updated_at:now },
      { id:5, title:'红焖羊肉配橄榄与柠檬', cuisine:'wn', method:'煮', time_minutes:180, servings:6, tags:['周末','聚会'], description:'四小时慢炖，地中海风味的周日大菜。', ingredients:[{name:'羊肩肉',qty:'1.2kg'},{name:'橄榄',qty:'200g'},{name:'柠檬',qty:'2个'},{name:'番茄罐头',qty:'400g'}], steps:['羊肉切大块，盐和黑胡椒腌制 30 分钟。','大火热油，将羊肉每面煎至金黄后取出。','加红酒煮至蒸发，加番茄、橄榄，放回羊肉慢炖 2.5 小时。'], source_type:'photo', source_url:'', photo_url:'', status:'published', created_at:now, updated_at:now }
    ]
  });
  console.log('✅ Sample recipes created');
}

console.log('✅ JSON database ready:', dataFile);

// ── DB Helpers ─────────────────────────────────
function getAll(filters = {}) {
  const db = readDB();
  let list = [...db.recipes];
  const { cuisine, method, tag, search, sort, status } = filters;
  if (status && status !== 'all') list = list.filter(r => r.status === status);
  if (cuisine && cuisine !== 'all') list = list.filter(r => r.cuisine === cuisine);
  if (method) list = list.filter(r => r.method === method);
  if (tag)    list = list.filter(r => r.tags && r.tags.includes(tag));
  if (search) {
    const s = search.toLowerCase();
    list = list.filter(r => r.title.toLowerCase().includes(s) || (r.description||'').toLowerCase().includes(s));
  }
  if (sort === 'time') list.sort((a,b) => a.time_minutes - b.time_minutes);
  else if (sort === 'az') list.sort((a,b) => a.title.localeCompare(b.title));
  else list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  return list;
}

function getById(id) {
  const db = readDB();
  return db.recipes.find(r => r.id === parseInt(id)) || null;
}

function insert(data) {
  const db = readDB();
  const now = new Date().toISOString();
  const recipe = { id: db.nextId++, ...data, created_at: now, updated_at: now };
  db.recipes.push(recipe);
  writeDB(db);
  return recipe;
}

function update(id, data) {
  const db = readDB();
  const idx = db.recipes.findIndex(r => r.id === parseInt(id));
  if (idx === -1) return null;
  db.recipes[idx] = { ...db.recipes[idx], ...data, updated_at: new Date().toISOString() };
  writeDB(db);
  return db.recipes[idx];
}

function remove(id) {
  const db = readDB();
  const idx = db.recipes.findIndex(r => r.id === parseInt(id));
  if (idx === -1) return false;
  db.recipes.splice(idx, 1);
  writeDB(db);
  return true;
}

// ── DeepSeek AI ────────────────────────────────
async function callDeepSeek(messages, max_tokens = 2000) {
  const body = JSON.stringify({ model: 'deepseek-chat', max_tokens, messages });
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
          if (json.error) reject(new Error(json.error.message || 'DeepSeek error'));
          else resolve(json.choices[0].message.content.trim());
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseAIJson(raw) {
  return JSON.parse(raw.replace(/^```json?\s*/i,'').replace(/\s*```$/i,'').trim());
}

// ═══════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'CHEF WANG 食谱' }));

// GET all recipes
app.get('/api/recipes', (req, res) => {
  try {
    const recipes = getAll(req.query);
    res.json({ success: true, count: recipes.length, recipes });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET single recipe
app.get('/api/recipes/:id', (req, res) => {
  try {
    const recipe = getById(req.params.id);
    if (!recipe) return res.status(404).json({ success: false, error: '食谱不存在' });
    res.json({ success: true, recipe });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST create recipe
app.post('/api/recipes', (req, res) => {
  try {
    const { title, cuisine='cn', method='煮', time_minutes=30, servings=4,
            tags=[], ingredients=[], steps=[], description='',
            source_url='', photo_url='', status='draft' } = req.body;
    if (!title) return res.status(400).json({ success: false, error: '食谱名称不能为空' });
    const recipe = insert({ title, cuisine, method, time_minutes: parseInt(time_minutes),
      servings: parseInt(servings), tags, ingredients, steps, description,
      source_type: 'manual', source_url, photo_url, status });
    res.status(201).json({ success: true, recipe });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT update recipe
app.put('/api/recipes/:id', (req, res) => {
  try {
    const recipe = update(req.params.id, req.body);
    if (!recipe) return res.status(404).json({ success: false, error: '食谱不存在' });
    res.json({ success: true, recipe });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH publish recipe
app.patch('/api/recipes/:id/publish', (req, res) => {
  try {
    const recipe = update(req.params.id, { status: 'published' });
    if (!recipe) return res.status(404).json({ success: false, error: '食谱不存在' });
    res.json({ success: true, message: '食谱已发布' });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE recipe
app.delete('/api/recipes/:id', (req, res) => {
  try {
    const ok = remove(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: '食谱不存在' });
    res.json({ success: true, message: '食谱已删除' });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST import photo
app.post('/api/import/photo', upload.single('photo'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传图片文件' });
    filePath = req.file.path;
    if (!process.env.DEEPSEEK_API_KEY) return res.status(400).json({ success: false, error: '请设置 DEEPSEEK_API_KEY' });

    const fileName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const prompt = `用户上传了一张名为"${fileName}"的食谱图片。请根据这道菜名生成一份完整食谱，JSON格式返回，只返回JSON：
{"title":"食谱名","description":"简短描述","cuisine":"cn或wn","method":"炸蒸烤煮炒煎之一","time_minutes":数字,"servings":数字,"tags":["标签"],"ingredients":[{"name":"食材","qty":"用量"}],"steps":["步骤1","步骤2"]}`;

    const raw = await callDeepSeek([{ role:'user', content:prompt }]);
    const extracted = parseAIJson(raw);
    if (extracted.error) return res.status(422).json({ success: false, error: extracted.error });

    const recipe = insert({ ...extracted, source_type:'photo', source_url:'', photo_url:'', status:'draft' });
    res.json({ success: true, recipe, message: 'AI 已提取食谱，请审核后发布' });
  } catch(err) {
    if (err instanceof SyntaxError) res.status(422).json({ success: false, error: 'AI 返回格式错误，请重试' });
    else res.status(500).json({ success: false, error: err.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// POST import URL
app.post('/api/import/url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: '请提供食谱链接' });
    if (!process.env.DEEPSEEK_API_KEY) return res.status(400).json({ success: false, error: '请设置 DEEPSEEK_API_KEY' });

    // Fetch page using built-in https/http
    const html = await new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search,
        method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChefWangBot/1.0)' }, timeout: 10000 };
      const req2 = lib.request(options, (response) => {
        if ([301,302,307,308].includes(response.statusCode) && response.headers.location) {
          const rurl = new URL(response.headers.location, url).toString();
          const lib2 = rurl.startsWith('https') ? https : http;
          lib2.get(rurl, { headers: options.headers }, (res2) => {
            let d = ''; res2.on('data', c => d += c); res2.on('end', () => resolve(d)); res2.on('error', reject);
          }).on('error', reject);
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 400) {
          reject(new Error(`无法访问该网址 (${response.statusCode})`)); response.resume(); return;
        }
        let d = ''; response.setEncoding('utf8');
        response.on('data', c => d += c); response.on('end', () => resolve(d)); response.on('error', reject);
      });
      req2.on('error', reject);
      req2.on('timeout', () => { req2.destroy(); reject(new Error('请求超时')); });
      req2.end();
    });

    const text = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'')
      .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').substring(0, 8000);

    const prompt = `从以下网页内容提取食谱，JSON格式，只返回JSON：
{"title":"","description":"","cuisine":"cn或wn","method":"炸蒸烤煮炒煎之一","time_minutes":数字,"servings":数字,"tags":[],"ingredients":[{"name":"","qty":""}],"steps":[]}
如找不到食谱返回{"error":"未找到食谱内容"}
内容：${text}`;

    const raw = await callDeepSeek([{ role:'user', content:prompt }]);
    const extracted = parseAIJson(raw);
    if (extracted.error) return res.status(422).json({ success: false, error: extracted.error });

    const recipe = insert({ ...extracted, source_type:'url', source_url:url, photo_url:'', status:'draft' });
    res.json({ success: true, recipe, message: 'AI 已从链接提取食谱，请审核后发布' });
  } catch(err) {
    if (err instanceof SyntaxError) res.status(422).json({ success: false, error: 'AI 返回格式错误，请重试' });
    else res.status(500).json({ success: false, error: err.message });
  }
});

// GET AI suggestions
app.get('/api/suggest', async (req, res) => {
  try {
    if (!process.env.DEEPSEEK_API_KEY) return res.json({ success: true, suggestions: defaultSuggestions() });
    const all = getAll({ status: 'published' });
    const titles = all.slice(0,20).map(r => `${r.title}(${r.cuisine==='cn'?'中餐':'西餐'},${r.method})`).join('、');
    const prompt = `CHEF WANG食谱网站已有：${titles}。推荐3道未收录的食谱，JSON返回：[{"title":"","cuisine":"cn或wn","method":"炸蒸烤煮炒煎之一"}]`;
    const raw = await callDeepSeek([{ role:'user', content:prompt }], 500);
    res.json({ success: true, suggestions: parseAIJson(raw) });
  } catch { res.json({ success: true, suggestions: defaultSuggestions() }); }
});

// GET stats
app.get('/api/stats', (req, res) => {
  try {
    const all = getAll({ status: 'published' });
    const drafts = getAll({ status: 'draft' });
    const methods = {};
    all.forEach(r => { methods[r.method] = (methods[r.method]||0) + 1; });
    res.json({ success: true, stats: {
      total: all.length,
      chinese: all.filter(r=>r.cuisine==='cn').length,
      western: all.filter(r=>r.cuisine==='wn').length,
      drafts: drafts.length,
      methods: Object.entries(methods).map(([method,count])=>({method,count}))
    }});
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET drafts
app.get('/api/drafts', (req, res) => {
  try {
    res.json({ success: true, drafts: getAll({ status: 'draft' }) });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// Serve frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function defaultSuggestions() {
  return [
    { title:'清蒸排骨配豆豉', cuisine:'cn', method:'蒸' },
    { title:'香煎三文鱼配柠檬黄油', cuisine:'wn', method:'煎' },
    { title:'蒜蓉炒菜心', cuisine:'cn', method:'炒' }
  ];
}

app.listen(PORT, () => {
  console.log('');
  console.log('  🍜  CHEF WANG 食谱 server running');
  console.log(`  👉  http://localhost:${PORT}`);
  console.log('');
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('  ⚠️  DEEPSEEK_API_KEY not set — AI features disabled\n');
  }
});
