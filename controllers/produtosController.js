const slugify = require('slugify');
const adminLogger = require('../utils/logger');

module.exports = ({ connection, readBody, setJson }) => {
    const sanitizeProduto = (p) => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        preco: Number(p.preco),
        estoque: p.estoque,
        ativo: !!p.ativo,
        slug: p.slug,
        created_at: p.created_at,
        updated_at: p.updated_at,
        imagem: p.imagem
    });

    // =====================================
    // POST /produtos (ADMIN)
    // =====================================
    async function create(req, res, { actorRole = 'ANON' } = {}) {
        try {
            if (actorRole !== 'ADMIN') {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'CREATE_PRODUCT_FORBIDDEN',
                    resource: 'produtos',
                    details: { ip: req.ip },
                    req
                });
                return setJson(res, 403, { message: 'Apenas administradores podem criar produtos.' });
            }

            const body = await readBody(req);
            let { nome, descricao = '', preco, estoque = 0, ativo = 1, imagem } = body;

            if (!nome || preco === undefined) {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'CREATE_PRODUCT_INVALID',
                    resource: 'produtos',
                    details: { nome, preco },
                    req
                });
                return setJson(res, 400, { message: 'Nome e preço são obrigatórios.' });
            }

            if (Number(preco) < 0 || Number(estoque) < 0) {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'CREATE_PRODUCT_NEGATIVE_VALUES',
                    resource: 'produtos',
                    details: { nome, preco, estoque },
                    req
                });
                return setJson(res, 400, { message: 'Preço e estoque não podem ser negativos.' });
            }

            const slugBase = slugify(nome, { lower: true, strict: true });
            let slug = slugBase;
            let count = 1;
            while (true) {
                const [dup] = await connection.promise().execute(
                    'SELECT 1 FROM produtos WHERE slug = ? LIMIT 1',
                    [slug]
                );
                if (dup.length === 0) break;
                slug = `${slugBase}-${count++}`;
            }

            await connection.promise().execute(
                `INSERT INTO produtos (nome, descricao, preco, estoque, ativo, slug, imagem)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [nome, descricao, preco, estoque, ativo ? 1 : 0, slug, imagem]
            );

            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'CREATE_PRODUCT_SUCCESS',
                resource: 'produtos',
                resourceId: slug,
                details: { nome, preco, estoque, ativo, slug },
                req
            });

            return setJson(res, 201, { message: 'Produto criado com sucesso', slug });
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'CREATE_PRODUCT_ERROR',
                resource: 'produtos',
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao criar produto' });
        }
    }

    // =====================================
    // GET /produtos
    // =====================================
    async function list(req, res) {
        try {
            const [rows] = await connection.promise().execute(
                `SELECT id, nome, descricao, preco, estoque, ativo, slug, created_at, updated_at, imagem
                 FROM produtos
                 ORDER BY created_at DESC`
            );

            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'LIST_PRODUCTS',
                resource: 'produtos',
                details: { total: rows.length, ip: req.ip },
                req
            });

            return setJson(res, 200, rows.map(sanitizeProduto));
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'LIST_PRODUCTS_ERROR',
                resource: 'produtos',
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao listar produtos' });
        }
    }

    // =====================================
    // GET /produtos/:id
    // =====================================
    async function getById(req, res, id) {
        try {
            const [rows] = await connection.promise().execute(
                `SELECT id, nome, descricao, preco, estoque, ativo, slug, created_at, updated_at, imagem
                 FROM produtos
                 WHERE id = ? LIMIT 1`,
                [id]
            );
            if (!rows.length) {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'GET_PRODUCT_NOT_FOUND',
                    resource: 'produtos',
                    resourceId: id,
                    req
                });
                return setJson(res, 404, { message: 'Produto não encontrado' });
            }

            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'GET_PRODUCT_SUCCESS',
                resource: 'produtos',
                resourceId: id,
                req
            });

            return setJson(res, 200, sanitizeProduto(rows[0]));
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'GET_PRODUCT_ERROR',
                resource: 'produtos',
                resourceId: id,
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao buscar produto' });
        }
    }

    // =====================================
    // PUT /produtos/:id
    // =====================================
    async function update(req, res, id, { actorRole = 'ANON' } = {}) {
        try {
            if (actorRole !== 'ADMIN') {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'UPDATE_PRODUCT_FORBIDDEN',
                    resource: 'produtos',
                    resourceId: id,
                    req
                });
                return setJson(res, 403, { message: 'Apenas administradores podem atualizar produtos.' });
            }

            const body = await readBody(req);
            const { nome, descricao, preco, estoque, ativo, imagem } = body;

            const fields = [];
            const values = [];

            if (nome !== undefined) { fields.push('nome = ?'); values.push(nome); }
            if (imagem !== undefined) { fields.push('imagem = ?'); values.push(imagem); }
            if (descricao !== undefined) { fields.push('descricao = ?'); values.push(descricao); }
            if (preco !== undefined) {
                if (Number(preco) < 0) {
                    await adminLogger.record({
                        connection,
                        userId: req.user?.id || null,
                        action: 'UPDATE_PRODUCT_INVALID_PRICE',
                        resource: 'produtos',
                        resourceId: id,
                        details: { preco },
                        req
                    });
                    return setJson(res, 400, { message: 'Preço não pode ser negativo.' });
                }
                fields.push('preco = ?'); values.push(preco);
            }
            if (estoque !== undefined) {
                if (Number(estoque) < 0) {
                    await adminLogger.record({
                        connection,
                        userId: req.user?.id || null,
                        action: 'UPDATE_PRODUCT_INVALID_STOCK',
                        resource: 'produtos',
                        resourceId: id,
                        details: { estoque },
                        req
                    });
                    return setJson(res, 400, { message: 'Estoque não pode ser negativo.' });
                }
                fields.push('estoque = ?'); values.push(estoque);
            }
            if (ativo !== undefined) { fields.push('ativo = ?'); values.push(ativo ? 1 : 0); }

            if (!fields.length) {
                return setJson(res, 400, { message: 'Nada para atualizar' });
            }

            values.push(id);
            const [result] = await connection.promise().execute(
                `UPDATE produtos SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            if (result.affectedRows === 0) {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'UPDATE_PRODUCT_NOT_FOUND',
                    resource: 'produtos',
                    resourceId: id,
                    req
                });
                return setJson(res, 404, { message: 'Produto não encontrado' });
            }

            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'UPDATE_PRODUCT_SUCCESS',
                resource: 'produtos',
                resourceId: id,
                details: { nome, preco, estoque, ativo },
                req
            });

            return setJson(res, 200, { message: 'Produto atualizado com sucesso' });
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'UPDATE_PRODUCT_ERROR',
                resource: 'produtos',
                resourceId: id,
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao atualizar produto' });
        }
    }

    // =====================================
    // DELETE /produtos/:id
    // =====================================
    async function remove(req, res, id, { actorRole = 'ANON' } = {}) {
        try {
            if (actorRole !== 'ADMIN') {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'DELETE_PRODUCT_FORBIDDEN',
                    resource: 'produtos',
                    resourceId: id,
                    req
                });
                return setJson(res, 403, { message: 'Apenas administradores podem remover produtos.' });
            }

            const [result] = await connection.promise().execute(
                'DELETE FROM produtos WHERE id = ?',
                [id]
            );

            if (result.affectedRows === 0) {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'DELETE_PRODUCT_NOT_FOUND',
                    resource: 'produtos',
                    resourceId: id,
                    req
                });
                return setJson(res, 404, { message: 'Produto não encontrado' });
            }

            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'DELETE_PRODUCT_SUCCESS',
                resource: 'produtos',
                resourceId: id,
                req
            });

            return setJson(res, 200, { message: 'Produto removido com sucesso' });
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'DELETE_PRODUCT_ERROR',
                resource: 'produtos',
                resourceId: id,
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao remover produto' });
        }
    }

    return { create, list, getById, update, remove };
};
