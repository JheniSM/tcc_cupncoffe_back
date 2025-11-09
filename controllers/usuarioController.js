const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../utils/mailer');
const adminLogger = require('../utils/logger');

module.exports = ({ connection, bcrypt, readBody, setJson }) => {
    const sanitizeUser = (u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        role: u.role,
        ativo: !!u.ativo,
        assinante: !!u.assinante,
        created_at: u.created_at,
        updated_at: u.updated_at
    });

    // =====================================
    // POST /usuarios  (público; força USER se não-admin)
    // =====================================
    async function create(req, res, { actorRole = 'ANON' } = {}) {
        try {
            const body = await readBody(req);
            let { nome, email, senha, role = 'USER', ativo = 1, assinante = 0 } = body;

            if (!nome || !email || !senha) {
                await adminLogger.record({
                    connection,
                    userId: null,
                    action: 'CREATE_USER_MISSING_FIELDS',
                    resource: 'usuarios',
                    details: { nome, email },
                    req
                });
                return setJson(res, 400, { message: 'nome, email e senha são obrigatórios' });
            }

            // se não for ADMIN, força role=USER
            if (actorRole !== 'ADMIN') {
                role = 'USER';
                ativo = 1;
                assinante = 0;
            }

            if (!['ADMIN', 'USER'].includes(role)) {
                await adminLogger.record({
                    connection,
                    userId: null,
                    action: 'CREATE_USER_INVALID_ROLE',
                    resource: 'usuarios',
                    details: { role },
                    req
                });
                return setJson(res, 400, { message: 'role inválido (ADMIN/USER)' });
            }

            const [dup] = await connection.promise().execute(
                'SELECT 1 FROM usuarios WHERE email = ? LIMIT 1',
                [email]
            );
            if (dup.length) {
                await adminLogger.record({
                    connection,
                    userId: null,
                    action: 'CREATE_USER_DUPLICATE_EMAIL',
                    resource: 'usuarios',
                    details: { email },
                    req
                });
                return setJson(res, 409, { message: 'Email já cadastrado' });
            }

            const id = uuidv4();
            const senha_hash = await bcrypt.hash(String(senha), 10);

            await connection.promise().execute(
                `INSERT INTO usuarios (id, nome, email, senha_hash, role, ativo, assinante)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, nome, email, senha_hash, role, ativo ? 1 : 0, assinante ? 1 : 0]
            );

            await adminLogger.record({
                connection,
                userId: id,
                action: 'CREATE_USER_SUCCESS',
                resource: 'usuarios',
                resourceId: id,
                details: { nome, email, role, ativo, assinante },
                req
            });

            return setJson(res, 201, { id, message: 'Usuário criado com sucesso' });
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: null,
                action: 'CREATE_USER_ERROR',
                resource: 'usuarios',
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao criar usuário' });
        }
    }

    // =====================================
    // GET /usuarios (ADMIN)
    // =====================================
    async function list(req, res) {
        try {
            const [rows] = await connection.promise().execute(
                `SELECT id, nome, email, role, ativo, assinante, created_at, updated_at
                 FROM usuarios ORDER BY created_at DESC`
            );

            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'LIST_USERS',
                resource: 'usuarios',
                details: { total: rows.length },
                req
            });

            return setJson(res, 200, rows.map(sanitizeUser));
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'LIST_USERS_ERROR',
                resource: 'usuarios',
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao listar usuários' });
        }
    }

    // =====================================
    // GET /usuarios/:id (ADMIN)
    // =====================================
    async function getById(req, res, id) {
        try {
            const [rows] = await connection.promise().execute(
                `SELECT id, nome, email, role, ativo, assinante, created_at, updated_at
                 FROM usuarios WHERE id = ? LIMIT 1`,
                [id]
            );
            if (!rows.length) {
                await adminLogger.record({
                    connection,
                    userId: req.user?.id || null,
                    action: 'GET_USER_NOT_FOUND',
                    resource: 'usuarios',
                    resourceId: id,
                    req
                });
                return setJson(res, 404, { message: 'Usuário não encontrado' });
            }

            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'GET_USER_SUCCESS',
                resource: 'usuarios',
                resourceId: id,
                req
            });

            return setJson(res, 200, sanitizeUser(rows[0]));
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: req.user?.id || null,
                action: 'GET_USER_ERROR',
                resource: 'usuarios',
                resourceId: id,
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao buscar usuário' });
        }
    }

    // =====================================
    // PUT /usuarios/:id (ADMIN ou SELF)
    // =====================================
    async function update(req, res, id, { actorId, actorRole }) {
        try {
            const body = await readBody(req);
            let { nome, email, senha, role, ativo, assinante } = body;

            const isAdmin = actorRole === 'ADMIN';
            const isSelf = actorId === id;

            if (!isAdmin && !isSelf) {
                await adminLogger.record({
                    connection,
                    userId: actorId,
                    action: 'UPDATE_USER_FORBIDDEN',
                    resource: 'usuarios',
                    resourceId: id,
                    req
                });
                return setJson(res, 403, { message: 'Proibido' });
            }

            const fields = [];
            const values = [];

            if (nome !== undefined) { fields.push('nome = ?'); values.push(nome); }

            if (email !== undefined) {
                const [dup] = await connection.promise().execute(
                    'SELECT 1 FROM usuarios WHERE email = ? AND id <> ? LIMIT 1',
                    [email, id]
                );
                if (dup.length) {
                    await adminLogger.record({
                        connection,
                        userId: actorId,
                        action: 'UPDATE_USER_DUPLICATE_EMAIL',
                        resource: 'usuarios',
                        resourceId: id,
                        details: { email },
                        req
                    });
                    return setJson(res, 409, { message: 'Email já cadastrado' });
                }
                fields.push('email = ?'); values.push(email);
            }

            if (senha !== undefined) {
                const senha_hash = await bcrypt.hash(String(senha), 10);
                fields.push('senha_hash = ?'); values.push(senha_hash);
            }

            if (isAdmin) {
                if (role !== undefined) {
                    if (!['ADMIN', 'USER'].includes(role)) {
                        return setJson(res, 400, { message: 'role inválido (ADMIN/USER)' });
                    }
                    fields.push('role = ?'); values.push(role);
                }
                if (ativo !== undefined) { fields.push('ativo = ?'); values.push(ativo ? 1 : 0); }
                if (assinante !== undefined) { fields.push('assinante = ?'); values.push(assinante ? 1 : 0); }
            }

            if (!fields.length) return setJson(res, 400, { message: 'Nada para atualizar' });

            values.push(id);
            const [result] = await connection.promise().execute(
                `UPDATE usuarios SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            if (result.affectedRows === 0) {
                await adminLogger.record({
                    connection,
                    userId: actorId,
                    action: 'UPDATE_USER_NOT_FOUND',
                    resource: 'usuarios',
                    resourceId: id,
                    req
                });
                return setJson(res, 404, { message: 'Usuário não encontrado' });
            }

            await adminLogger.record({
                connection,
                userId: actorId,
                action: 'UPDATE_USER_SUCCESS',
                resource: 'usuarios',
                resourceId: id,
                details: { nome, email, role, ativo, assinante },
                req
            });

            return setJson(res, 200, { message: 'Usuário atualizado com sucesso' });
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: actorId,
                action: 'UPDATE_USER_ERROR',
                resource: 'usuarios',
                resourceId: id,
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao atualizar usuário' });
        }
    }

    // =====================================
    // DELETE /usuarios/:id (ADMIN)
    // =====================================
    async function remove(req, res, id, { actorId, actorRole }) {
        try {
            if (actorRole !== 'ADMIN') {
                await adminLogger.record({
                    connection,
                    userId: actorId,
                    action: 'DELETE_USER_FORBIDDEN',
                    resource: 'usuarios',
                    resourceId: id,
                    req
                });
                return setJson(res, 403, { message: 'Proibido' });
            }

            const [result] = await connection.promise().execute(
                'DELETE FROM usuarios WHERE id = ?',
                [id]
            );
            if (result.affectedRows === 0) {
                await adminLogger.record({
                    connection,
                    userId: actorId,
                    action: 'DELETE_USER_NOT_FOUND',
                    resource: 'usuarios',
                    resourceId: id,
                    req
                });
                return setJson(res, 404, { message: 'Usuário não encontrado' });
            }

            await adminLogger.record({
                connection,
                userId: actorId,
                action: 'DELETE_USER_SUCCESS',
                resource: 'usuarios',
                resourceId: id,
                req
            });

            return setJson(res, 200, { message: 'Usuário removido com sucesso' });
        } catch (e) {
            await adminLogger.record({
                connection,
                userId: actorId,
                action: 'DELETE_USER_ERROR',
                resource: 'usuarios',
                resourceId: id,
                details: { error: e.message },
                req
            });
            console.error(e);
            return setJson(res, 500, { message: 'Erro ao remover usuário' });
        }
    }

    // =====================================
    // Recuperação de senha
    // =====================================
    async function gerarCodigoRecuperacao(req, res) {
        try {
            const body = await readBody(req);
            const { email } = body;

            if (!email) return setJson(res, 400, { message: 'E-mail é obrigatório.' });

            const [[user]] = await connection.promise().execute(
                `SELECT id, nome, email FROM usuarios WHERE email = ? LIMIT 1`,
                [email]
            );
            if (!user) return setJson(res, 404, { message: 'Usuário não encontrado.' });

            const code = String(Math.floor(100000 + Math.random() * 900000));

            await connection.promise().execute(
                `UPDATE usuarios SET reset_code = ? WHERE id = ?`,
                [code, user.id]
            );

            const html = `
                <h2>Recuperação de senha</h2>
                <p>Olá, ${user.nome}!</p>
                <p>Use o código abaixo para redefinir sua senha:</p>
                <h1 style="color:#4CAF50;">${code}</h1>
                <p>Se você não solicitou isso, ignore este e-mail.</p>
            `;
            await sendEmail(user.email, 'Recuperação de senha', html);

            await adminLogger.record({
                connection,
                userId: user.id,
                action: 'USER_RESET_CODE_SENT',
                resource: 'usuarios',
                resourceId: user.id,
                req
            });

            return setJson(res, 200, { message: 'Código de recuperação enviado para o e-mail.' });
        } catch (err) {
            await adminLogger.record({
                connection,
                userId: null,
                action: 'USER_RESET_CODE_ERROR',
                resource: 'usuarios',
                details: { error: err.message },
                req
            });
            console.error(err);
            return setJson(res, 500, { message: 'Erro ao gerar código de recuperação.' });
        }
    }

    async function redefinirSenha(req, res) {
        try {
            const body = await readBody(req);
            const { email, codigo, novaSenha } = body;

            if (!email || !codigo || !novaSenha) {
                return setJson(res, 400, { message: 'E-mail, código e nova senha são obrigatórios.' });
            }

            const [[user]] = await connection.promise().execute(
                `SELECT id, reset_code FROM usuarios WHERE email = ? LIMIT 1`,
                [email]
            );
            if (!user) return setJson(res, 404, { message: 'Usuário não encontrado.' });
            if (user.reset_code !== codigo) {
                await adminLogger.record({
                    connection,
                    userId: user.id,
                    action: 'USER_RESET_CODE_INVALID',
                    resource: 'usuarios',
                    resourceId: user.id,
                    details: { codigo },
                    req
                });
                return setJson(res, 400, { message: 'Código inválido.' });
            }

            const senha_hash = await bcrypt.hash(String(novaSenha), 10);
            await connection.promise().execute(
                `UPDATE usuarios SET senha_hash = ?, reset_code = NULL WHERE id = ?`,
                [senha_hash, user.id]
            );

            await adminLogger.record({
                connection,
                userId: user.id,
                action: 'USER_PASSWORD_RESET_SUCCESS',
                resource: 'usuarios',
                resourceId: user.id,
                req
            });

            return setJson(res, 200, { message: 'Senha redefinida com sucesso.' });
        } catch (err) {
            await adminLogger.record({
                connection,
                userId: null,
                action: 'USER_PASSWORD_RESET_ERROR',
                resource: 'usuarios',
                details: { error: err.message },
                req
            });
            console.error(err);
            return setJson(res, 500, { message: 'Erro ao redefinir senha.' });
        }
    }

    return { create, list, getById, update, remove, gerarCodigoRecuperacao, redefinirSenha };
};
