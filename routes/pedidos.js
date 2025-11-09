const pedidosControllerFactory = require('../controllers/pedidosController');

module.exports = async function pedidosRouter(req, res, { connection, readBody, setJson, myRole, user }) {
    const pedidosController = pedidosControllerFactory({ connection, readBody, setJson });
    const method = req.method;
    const path = req.url;

    // =========================
    // CRUD PEDIDOS
    // =========================

    // POST /pedidos → cria pedido (usuário logado)
    if (method === 'POST' && path === '/pedidos') {
        await pedidosController.create(req, res, { userId: user?.id });
        return true;
    }

    // GET /pedidos → lista pedidos (usuário ou admin)
    if (method === 'GET' && path === '/pedidos') {
        await pedidosController.list(req, res, { userId: user?.id, actorRole: myRole });
        return true;
    }

    // GET /pedidos/:id → detalhes do pedido
    if (method === 'GET' && path.startsWith('/pedidos/')) {
        const id = path.split('/')[2];
        await pedidosController.getById(req, res, id, { userId: user?.id, actorRole: myRole });
        return true;
    }

    // PUT /pedidos/:id → atualizar status/obs (admin)
    if (method === 'PUT' && path.startsWith('/pedidos/')) {
        const id = path.split('/')[2];
        await pedidosController.update(req, res, id, { actorRole: myRole });
        return true;
    }

    // Nenhuma rota combinou
    return false;
};
