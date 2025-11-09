const adminLogger = require('../utils/logger');

module.exports = ({ connection, readBody, setJson }) => {
    const sanitizePedido = (p) => ({
        id: p.id,
        usuario_id: p.usuario_id,
        status: p.status,
        obs: p.obs,
        endereco: p.endereco,
        created_at: p.created_at,
        updated_at: p.updated_at,
        total_itens: Number(p.total_itens || 0),
        feedback: p.feedback
    });

    // =====================================
    // POST /pedidos  (usuário logado)
    // =====================================
    async function create(req, res, { userId } = {}) {
        try {
            if (!userId) {
                await adminLogger.record({
                    connection,
                    userId: null,
                    action: 'CREATE_ORDER_UNAUTHORIZED',
                    resource: 'pedidos',
                    details: { ip: req.ip },
                    req
                });
                return setJson(res, 401, { message: 'Usuário não autenticado.' });
            }

            const body = await readBody(req);
            const { itens, obs = '', endereco = '' } = body;

            if (!Array.isArray(itens) || itens.length === 0) {
                await adminLogger.record({
                    connection,
                    userId,
                    action: 'CREATE_ORDER_INVALID_ITEMS',
                    resource: 'pedidos',
                    details: { itens },
                    req
                });
                return setJson(res, 400, { message: 'O pedido deve conter pelo menos 1 item.' });
            }

            await connection.promise().beginTransaction();

            // Verifica assinatura
            const [[assinaturaRecent]] = await connection.promise().execute(`
                SELECT COUNT(*) AS tem_assinatura
                FROM pedidos p
                JOIN pedido_produto pp ON p.id = pp.pedido_id
                JOIN produtos pr ON pr.id = pp.produto_id
                WHERE p.usuario_id = ?
                  AND p.status = 'PAGO'
                  AND pr.nome LIKE '%Assinatura%'
                  AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `, [userId]);

            const temAssinatura = assinaturaRecent?.tem_assinatura > 0;
            const descontoAssinaturaPct = temAssinatura ? 0.10 : 0;

            // Busca cashback atual
            const [[user]] = await connection.promise().execute(
                `SELECT cashbacktotal FROM usuarios WHERE id = ?`,
                [userId]
            );

            let cashbackDisponivel = Number(user?.cashbacktotal || 0);

            // Calcula total
            let totalBruto = 0;
            for (const item of itens) {
                if (!item.produtoId || !item.quantidade || !item.preco) {
                    await connection.promise().rollback();
                    await adminLogger.record({
                        connection,
                        userId,
                        action: 'CREATE_ORDER_INVALID_ITEM_FIELD',
                        resource: 'pedidos',
                        details: { item },
                        req
                    });
                    return setJson(res, 400, { message: 'Campos inválidos em um dos itens.' });
                }
                totalBruto += item.preco * item.quantidade;
            }

            // Descontos
            let totalDesconto = 0;
            let descontoAssinatura = 0;
            if (descontoAssinaturaPct > 0) {
                descontoAssinatura = totalBruto * descontoAssinaturaPct;
                totalDesconto += descontoAssinatura;
            }

            let descontoCashback = 0;
            if (cashbackDisponivel > 0) {
                const aplicavel = Math.min(cashbackDisponivel, totalBruto - totalDesconto);
                descontoCashback = aplicavel;
                totalDesconto += aplicavel;
                cashbackDisponivel -= aplicavel;
            }

            const totalFinal = totalBruto - totalDesconto;

            // Cria o pedido
            const [result] = await connection.promise().execute(
                `INSERT INTO pedidos (usuario_id, obs, endereco, total_bruto, total_desconto, total_final, descontoCashback, descontoAssinatura)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    `${obs} | Desconto assinatura: R$ ${descontoAssinatura.toFixed(2)}, Cashback: R$ ${descontoCashback.toFixed(2)}`,
                    endereco,
                    totalBruto,
                    totalDesconto,
                    totalFinal,
                    descontoCashback,
                    descontoAssinatura
                ]
            );

            const pedidoId = result.insertId;

            // Cria os itens
            for (const item of itens) {
                await connection.promise().execute(
                    `INSERT INTO pedido_produto (pedido_id, produto_id, quantidade, preco_unitario, desconto)
                     VALUES (?, ?, ?, ?, ?)`,
                    [pedidoId, item.produtoId, item.quantidade, item.preco, 0]
                );
            }

            // Atualiza cashback
            await connection.promise().execute(
                `UPDATE usuarios SET cashbacktotal = ? WHERE id = ?`,
                [cashbackDisponivel, userId]
            );

            await connection.promise().commit();

            await adminLogger.record({
                connection,
                userId,
                action: 'CREATE_ORDER_SUCCESS',
                resource: 'pedidos',
                resourceId: pedidoId,
                details: {
                    totalBruto,
                    totalFinal,
                    descontoAssinatura,
                    descontoCashback
                },
                req
            });

            return setJson(res, 201, {
                message: 'Pedido criado com sucesso',
                pedidoId,
                totalBruto,
                descontoAssinatura,
                descontoCashback,
                totalFinal
            });

        } catch (e) {
            await connection.promise().rollback();
            await adminLogger.record({
                connection,
                userId,
                action: 'CREATE_ORDER_ERROR',
                resource: 'pedidos',
                details: { error: e.message },
                req
            });
            console.error('Erro ao criar pedido:', e);
            return setJson(res, 500, { message: 'Erro ao criar pedido' });
        }
    }

    // =====================================
    // GET /pedidos (usuário logado)
    // =====================================
    async function list(req, res, { userId, actorRole = 'USER' } = {}) {
        try {
            if (!userId && actorRole !== 'ADMIN') {
                await adminLogger.record({
                    connection,
                    userId: null,
                    action: 'LIST_ORDERS_UNAUTHORIZED',
                    resource: 'pedidos',
                    details: { ip: req.ip },
                    req
                });
                return setJson(res, 401, { message: 'Não autorizado.' });
            }

            const sql = actorRole === 'ADMIN'
                ? `SELECT p.*, v.total_itens, p.*
                   FROM vw_pedidos_totais v
                   JOIN pedidos p ON p.id = v.id
                   ORDER BY p.created_at DESC`
                : `SELECT p.*, v.total_itens
                   FROM vw_pedidos_totais v
                   JOIN pedidos p ON p.id = v.id
                   WHERE p.usuario_id = ?
                   ORDER BY p.created_at DESC`;

            const [rows] = await connection.promise().execute(sql, actorRole === 'ADMIN' ? [] : [userId]);

            await adminLogger.record({
                connection,
                userId,
                action: 'LIST_ORDERS_SUCCESS',
                resource: 'pedidos',
                details: { total: rows.length, actorRole },
                req
            });

            return setJson(res, 200, rows.map(sanitizePedido));
        } catch (e) {
            await adminLogger.record({
                connection,
                userId,
                action: 'LIST_ORDERS_ERROR',
                resource: 'pedidos',
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao listar pedidos' });
        }
    }

    // =====================================
    // GET /pedidos/:id
    // =====================================
    async function getById(req, res, id, { userId, actorRole = 'USER' } = {}) {
        try {
            const [rows] = await connection.promise().execute(
                `SELECT p.*, v.total_itens
                 FROM vw_pedidos_totais v
                 JOIN pedidos p ON p.id = v.id
                 WHERE p.id = ?`,
                [id]
            );

            if (!rows.length) {
                await adminLogger.record({
                    connection,
                    userId,
                    action: 'GET_ORDER_NOT_FOUND',
                    resource: 'pedidos',
                    resourceId: id,
                    req
                });
                return setJson(res, 404, { message: 'Pedido não encontrado' });
            }

            const pedido = sanitizePedido(rows[0]);
            if (actorRole !== 'ADMIN' && pedido.usuario_id !== userId) {
                await adminLogger.record({
                    connection,
                    userId,
                    action: 'GET_ORDER_FORBIDDEN',
                    resource: 'pedidos',
                    resourceId: id,
                    req
                });
                return setJson(res, 403, { message: 'Acesso negado a este pedido.' });
            }

            const [itens] = await connection.promise().execute(
                `SELECT i.*, pr.nome, pr.imagem
                 FROM pedido_produto i
                 JOIN produtos pr ON pr.id = i.produto_id
                 WHERE i.pedido_id = ?`,
                [id]
            );

            pedido.itens = itens;

            await adminLogger.record({
                connection,
                userId,
                action: 'GET_ORDER_SUCCESS',
                resource: 'pedidos',
                resourceId: id,
                details: { total_itens: itens.length },
                req
            });

            return setJson(res, 200, pedido);
        } catch (e) {
            await adminLogger.record({
                connection,
                userId,
                action: 'GET_ORDER_ERROR',
                resource: 'pedidos',
                resourceId: id,
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao buscar pedido' });
        }
    }

    // =====================================
    // PUT /pedidos/:id (ADMIN)
    // =====================================
    async function update(req, res, id, { actorRole = 'ANON' } = {}) {
        try {
            if (actorRole !== 'ADMIN') {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'UPDATE_ORDER_FORBIDDEN',
                    resource: 'pedidos',
                    resourceId: id,
                    req
                });
                return setJson(res, 403, { message: 'Apenas administradores podem atualizar pedidos.' });
            }

            const body = await readBody(req);
            const { status, obs, feedback } = body;

            const fields = [];
            const values = [];

            if (status) {
                const valid = ['CRIADO', 'PAGO', 'ENVIADO', 'CANCELADO', 'CONCLUIDO'];
                if (!valid.includes(status)) {
                    await adminLogger.record({
                        connection,
                        userId: req.user?.id || null,
                        action: 'UPDATE_ORDER_INVALID_STATUS',
                        resource: 'pedidos',
                        resourceId: id,
                        details: { status },
                        req
                    });
                    return setJson(res, 400, { message: 'Status inválido.' });
                }
                fields.push('status = ?');
                values.push(status);
            }
            if (obs !== undefined) {
                fields.push('obs = ?');
                values.push(obs);
            }
            if (feedback !== undefined) {
                fields.push('feedback = ?');
                values.push(feedback);
            }

            if (!fields.length) {
                return setJson(res, 400, { message: 'Nada para atualizar.' });
            }

            await connection.promise().beginTransaction();

            values.push(id);
            const [result] = await connection.promise().execute(
                `UPDATE pedidos SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            if (result.affectedRows === 0) {
                await connection.promise().rollback();
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'UPDATE_ORDER_NOT_FOUND',
                    resource: 'pedidos',
                    resourceId: id,
                    req
                });
                return setJson(res, 404, { message: 'Pedido não encontrado.' });
            }

            if (status === 'PAGO') {
                const [[pedido]] = await connection.promise().execute(
                    `SELECT usuario_id, total_final FROM pedidos WHERE id = ?`,
                    [id]
                );
                if (pedido?.usuario_id) {
                    const cashback = (pedido.total_final || 0) * 0.1;
                    await connection.promise().execute(
                        `UPDATE usuarios SET cashbacktotal = COALESCE(cashbacktotal, 0) + ? WHERE id = ?`,
                        [cashback, pedido.usuario_id]
                    );
                }
            }

            await connection.promise().commit();

            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'UPDATE_ORDER_SUCCESS',
                resource: 'pedidos',
                resourceId: id,
                details: { status, obs, feedback },
                req
            });

            return setJson(res, 200, { message: 'Pedido atualizado com sucesso.' });
        } catch (e) {
            await connection.promise().rollback?.();
            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'UPDATE_ORDER_ERROR',
                resource: 'pedidos',
                resourceId: id,
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao atualizar pedido' });
        }
    }

    return { create, list, getById, update };
};
