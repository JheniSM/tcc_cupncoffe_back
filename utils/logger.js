// lib/adminLogger.js
// Helper para registrar logs administrativos.
// Usa a conexão MySQL que seu app já injeta (connection.promise()).
// Chamadas recomendadas: await adminLogger.record({ connection, userId, action, resource, resourceId, details, req });

module.exports = {
    /**
     * Record a log entry
     * @param {Object} args
     * @param {import('mysql2').Connection} args.connection - mysql connection (pool or connection)
     * @param {string|null} args.userId
     * @param {string} args.action
     * @param {string|null} args.resource
     * @param {string|null} args.resourceId
     * @param {Object|null} args.details - will be JSON.stringified
     * @param {IncomingMessage|null} args.req - optional request to extract ip / user-agent
     */
    async record({ connection, userId = null, action, resource = null, resourceId = null, details = null, req = null }) {
        if (!connection || !action) return;
        try {
            const ip = req ? (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null) : null;
            const ua = req ? (req.headers['user-agent'] || null) : null;
            const detailsJson = details ? JSON.stringify(details) : null;

            await connection.promise().execute(
                `INSERT INTO admin_logs (usuario_id, action, resource, resource_id, details, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [userId, action, resource, resourceId, detailsJson, ip, ua]
            );
        } catch (err) {
            // não quebre a aplicação por causa de logs — apenas registre no console
            console.error('adminLogger.record error', err);
        }
    }
};
