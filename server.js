/**
 * ConectaVagas — Backend Express + SQLite
 */
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const JWT_SECRET = process.env.JWT_SECRET || "changeme-super-secret";
const PORT = process.env.PORT || 3000;

(async () => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // Banco de dados (Render não mantém arquivos em /tmp, usar process.cwd())
  let db;
  try {
    db = await open({
      filename: path.join(process.cwd(), 'data.db'),
      driver: sqlite3.Database
    });
  } catch (err) {
    console.error("❌ Erro ao abrir o banco SQLite:", err);
    process.exit(1);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL,
      type TEXT,
      salary TEXT,
      description TEXT,
      tags TEXT,
      urgent INTEGER DEFAULT 0,
      no_exp INTEGER DEFAULT 0,
      remote INTEGER DEFAULT 0,
      apply_url TEXT,
      apply_email TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      company_id INTEGER,
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
  `);

  // SSE para notificações
  const clients = new Set();
  function notifyAll(payload) {
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try { res.write(msg); } catch { }
    }
  }
  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  // Middleware de autenticação
  function auth(req, res, next) {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token ausente' });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      res.status(401).json({ error: 'Token inválido' });
    }
  }

  // Rotas de autenticação
  app.post('/api/auth/register',
    body('name').isLength({ min: 2 }),
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { name, email, password } = req.body;
      const hash = await bcrypt.hash(password, 10);

      try {
        const result = await db.run(
          `INSERT INTO companies (name, email, password_hash) VALUES (?,?,?)`,
          [name, email, hash]
        );
        const token = jwt.sign(
          { id: result.lastID, email, name },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        res.json({ token });
      } catch (e) {
        res.status(400).json({ error: 'Email já cadastrado.' });
      }
    }
  );

  app.post('/api/auth/login',
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password } = req.body;
      const company = await db.get(`SELECT * FROM companies WHERE email=?`, [email]);
      if (!company) return res.status(401).json({ error: 'Credenciais inválidas' });

      const ok = await bcrypt.compare(password, company.password_hash);
      if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

      const token = jwt.sign(
        { id: company.id, email: company.email, name: company.name },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({ token });
    }
  );

  // Listar vagas
  app.get('/api/jobs', async (req, res) => {
    const { q, tag, urgent, noexp, today, page = 1, pageSize = 20 } = req.query;
    const clauses = []; const params = [];

    if (q) {
      clauses.push(`(title LIKE ? OR company LIKE ? OR location LIKE ? OR description LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (tag) { clauses.push(`tags LIKE ?`); params.push(`%${tag}%`); }
    if (urgent === '1') clauses.push(`urgent=1`);
    if (noexp === '1') clauses.push(`no_exp=1`);
    if (today === '1') clauses.push(`date(created_at)=date('now')`);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(parseInt(pageSize) || 20, 100);
    const offset = (Math.max(1, parseInt(page) || 1) - 1) * limit;

    const totalRow = await db.get(`SELECT COUNT(*) as n FROM jobs ${where}`, params);
    const rows = await db.all(
      `SELECT * FROM jobs ${where} ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ total: totalRow.n, page: parseInt(page) || 1, pageSize: limit, jobs: rows });
  });

  // Detalhe da vaga
  app.get('/api/jobs/:id', async (req, res) => {
    const row = await db.get(`SELECT * FROM jobs WHERE id=?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Vaga não encontrada' });
    res.json(row);
  });

  // Criar vaga
  app.post('/api/jobs', auth,
    body('title').isLength({ min: 3 }),
    body('company').isLength({ min: 2 }),
    body('location').isLength({ min: 2 }),
    body('description').isLength({ min: 10 }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const {
        title, company, location, type = '', salary = '', description = '', tags = '',
        urgent = false, no_exp = false, remote = false, apply_url = '', apply_email = ''
      } = req.body;

      const result = await db.run(`
        INSERT INTO jobs
        (title, company, location, type, salary, description, tags, urgent, no_exp, remote, apply_url, apply_email, company_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
        [title, company, location, type, salary, description, tags,
          urgent ? 1 : 0, no_exp ? 1 : 0, remote ? 1 : 0, apply_url, apply_email, req.user.id]
      );

      const job = await db.get(`SELECT * FROM jobs WHERE id=?`, [result.lastID]);
      notifyAll({ type: 'new-job', job });
      res.status(201).json(job);
    }
  );

  // Deletar vaga
  app.delete('/api/jobs/:id', auth, async (req, res) => {
    const row = await db.get(`SELECT * FROM jobs WHERE id=?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Vaga não encontrada' });
    if (row.company_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

    await db.run(`DELETE FROM jobs WHERE id=?`, [req.params.id]);
    notifyAll({ type: 'delete-job', id: req.params.id });
    res.json({ ok: true });
  });

  // Fallback para API ou SPA
  app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(200).json({ status: "API online 🚀" });
    }
  });

  app.listen(PORT, () => console.log(`✅ ConectaVagas rodando na porta ${PORT}`));
})();
