const http = require('http');
const url = require('url');
const mysql = require('mysql2');
const querystring = require('querystring');
const bcrypt = require('bcrypt');
const path = require('path');
const dotenv = require('dotenv');
const env = process.env.NODE_ENV || 'local';
dotenv.config({ path: path.resolve(process.cwd(), `.env.${env}`) });

const COOKIE_NAME = 'session';
const COOKIE_MAX_AGE = 60 * 60 * 8;
const IN_PROD = false;
const SESSIONS = new Map();

const db_cfg = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Cocacol@001',
  database: process.env.DB_NAME || 'coffe'
}
const connection = mysql.createConnection(db_cfg);

// ========== LOG UTILS ==========
function log(...args) {
  const now = new Date().toISOString();
  console.log(`[${now}]`, ...args);
}

// ========== HELPERS ==========
function setCors(req, res) {
  const allow = new Set([
    'http://69.6.250.32',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:5501',
    'http://localhost:5501',
  ]);
  const origin = req.headers.origin;
  if (allow.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function setJson(res, status = 200, body = {}) {
  log(`→ Response ${status}:`, body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (!k) return acc;
    acc[k.trim()] = decodeURIComponent((v || '').trim());
    return acc;
  }, {});
}

function setCookie(res, name, value, { maxAge, path = '/', httpOnly = true, secure = IN_PROD, sameSite = 'Lax' } = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  if (typeof maxAge === 'number') cookie += `; Max-Age=${maxAge}`;
  res.setHeader('Set-Cookie', cookie);
}

function deleteCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      const ct = (req.headers['content-type'] || '').toLowerCase();
      try {
        let body;
        if (ct.includes('application/json')) body = JSON.parse(raw);
        else if (ct.includes('application/x-www-form-urlencoded')) body = querystring.parse(raw);
        else try { body = JSON.parse(raw); } catch { body = { _raw: raw }; }
        log('📦 Body recebido:', body);
        resolve(body);
      } catch (e) {
        log('❌ Erro ao parsear body:', e);
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const sess = SESSIONS.get(token);
  if (sess) log('🔐 Sessão encontrada:', sess);
  else log('⚠️ Sessão não encontrada para token', token);
  return sess || null;
}

// ========== IMPORT CONTROLLERS ==========
const usuarioController = require('./controllers/usuarioController')({
  connection,
  bcrypt,
  readBody,
  setJson,
});
const dashboardController = require('./controllers/dashboardController')({
  connection,
  setJson
});
const produtosRouter = require('./routes/produtos');
const pedidosRouter = require('./routes/pedidos');

// ========== SERVER ==========
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const method = req.method;
  const path = parsedUrl.pathname;
  setCors(req, res);

  log(`🌐 Nova requisição: ${method} ${path}`);

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    // ================== PUBLIC ==================
    if (method === 'POST' && path === '/api/usuarios') {
      let actorRole = 'ANON';
      const sessTry = await getSession(req);
      if (sessTry) {
        const [me] = await connection.promise().execute('SELECT role FROM usuarios WHERE id = ? LIMIT 1', [sessTry.id]);
        actorRole = me?.[0]?.role || 'USER';
      }
      log('👤 Criando usuário com role:', actorRole);
      return usuarioController.create(req, res, { actorRole });
    }

    if (method === 'POST' && path === '/api/usuarios/recover') {
      await usuarioController.gerarCodigoRecuperacao(req, res);
      return true;
    }

    if (method === 'POST' && path === '/api/usuarios/reset') {
      await usuarioController.redefinirSenha(req, res);
      return true;
    }

    if (method === 'POST' && path === '/api/login') {
      log('🔑 Tentando login...');
      const body = await readBody(req);
      const { email, password } = body;
      if (!email || !password) return setJson(res, 400, { message: 'Email e senha são obrigatórios' });

      const [rows] = await connection.promise().execute('SELECT id, email, senha_hash FROM usuarios WHERE email = ? LIMIT 1', [email]);
      log('🧑‍💻 Usuário encontrado:', rows);
      if (rows.length === 0) return setJson(res, 401, { message: 'Credenciais inválidas' });

      const user = rows[0];
      const ok = await bcrypt.compare(String(password), user.senha_hash);
      if (!ok) return setJson(res, 401, { message: 'Credenciais inválidas' });

      const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      SESSIONS.set(token, { id: user.id, email: user.email });
      log('✅ Login bem-sucedido, token:', token);
      setCookie(res, COOKIE_NAME, token, { maxAge: COOKIE_MAX_AGE });
      res.statusCode = 204;
      res.end();
      return;
    }

    // ================== PRIVATE ==================
    const sess = await getSession(req);
    if (!sess) {
      log('🚫 Sem sessão, acesso negado');
      return setJson(res, 401, { message: 'Não autenticado' });
    }

    req.user = sess;
    const [meRows] = await connection.promise().execute('SELECT role,id FROM usuarios WHERE id = ? LIMIT 1', [req.user.id]);
    const user = meRows?.[0] || null;
    const myRole = user?.role || 'USER';
    const isAdmin = myRole === 'ADMIN';
    log('🔎 Usuário autenticado:', user);

    if (method === 'GET' && path === '/api/me') {
      return setJson(res, 200, { id: sess.id, email: sess.email, isAdmin });
    }

    if (method === 'POST' && path === '/api/logout') {
      const cookies = parseCookies(req);
      const token = cookies[COOKIE_NAME];
      if (token) {
        SESSIONS.delete(token);
        log('👋 Logout, token removido:', token);
      }
      deleteCookie(res, COOKIE_NAME);
      res.statusCode = 204;
      res.end();
      return;
    }

    const produtosHandled = await produtosRouter(req, res, { connection, readBody, setJson, myRole });
    if (produtosHandled) return;

    const pedidosHandled = await pedidosRouter(req, res, { connection, readBody, setJson, myRole, user });
    if (pedidosHandled) return;

    // =========================
    // CRUD USUÁRIOS (privado; ideal só ADMIN)
    // =========================
    // LISTAR (ADMIN)
    if (method === 'GET' && path === '/api/usuarios') {
      if (!isAdmin) return setJson(res, 403, { message: 'Proibido' });
      return usuarioController.list(req, res);
    }

    // GET por id (ADMIN)
    if (method === 'GET' && path.startsWith('/api/usuarios/')) {
      if (!user) return setJson(res, 403, { message: 'Proibido' });
      const id = path.split('/')[3];
      return usuarioController.getById(req, res, id);
    }

    // UPDATE (ADMIN total; self parcial)
    if (method === 'PUT' && path.startsWith('/api/usuarios/')) {
      const id = path.split('/')[3];
      return usuarioController.update(req, res, id, { actorId: req.user.id, actorRole: myRole });
    }

    // DELETE (ADMIN)
    if (method === 'DELETE' && path.startsWith('/api/usuarios/')) {
      const id = path.split('/')[3];
      return usuarioController.remove(req, res, id, { actorId: req.user.id, actorRole: myRole });
    }

    if (method === 'GET' && path === '/api/dashboard/resumo') {
      if (!isAdmin) return setJson(res, 403, { message: 'Proibido' });
      await dashboardController.getResumo(req, res);
      return;
    }

    setJson(res, 404, { message: 'Rota não encontrada' });
  } catch (err) {
    log('💥 Erro inesperado:', err);
    setJson(res, 500, { message: 'Erro interno no servidor', error: err.message });
  }
});

server.listen(3000, () => {
  log('🚀 Servidor rodando em http://localhost:3000');
});
