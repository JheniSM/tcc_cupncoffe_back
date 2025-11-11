// routes/produtos.js
const produtoControllerFactory = require('../controllers/produtosController');

module.exports = async function produtosRouter(req, res, { connection, readBody, setJson, myRole }) {
    const produtoController = produtoControllerFactory({ connection, readBody, setJson });
    const method = req.method;
    const path = req.url;

    // =========================
    // CRUD PRODUTOS
    // =========================
    if (method === 'POST' && path === '/api/produtos') {
        await produtoController.create(req, res, { actorRole: myRole });
        return true;
    }

    if (method === 'GET' && path === '/api/produtos') {
        await produtoController.list(req, res);
        return true;
    }

    if (method === 'GET' && path.startsWith('/api/produtos/')) {
        const id = path.split('/')[3];
        await produtoController.getById(req, res, id);
        return true;
    }

    if (method === 'PUT' && path.startsWith('/api/produtos/')) {
        const id = path.split('/')[3];
        await produtoController.update(req, res, id, { actorRole: myRole });
        return true;
    }

    if (method === 'DELETE' && path.startsWith('/api/produtos/')) {
        const id = path.split('/')[3];
        await produtoController.remove(req, res, id, { actorRole: myRole });
        return true;
    }

    // Nenhuma rota de produto correspondeu
    return false;
};
