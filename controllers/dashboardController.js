// controllers/dashboardController.js
module.exports = ({ connection, setJson }) => ({
    async getResumo(req, res) {
        try {
            // 1️⃣ Faturamento total e pedidos
            const [[totais]] = await connection.promise().execute(`
        SELECT 
          COUNT(*) AS total_pedidos,
          SUM(CASE WHEN status = 'PAGO' THEN total_final ELSE 0 END) AS total_vendas,
          SUM(CASE WHEN status = 'PAGO' THEN total_final ELSE 0 END) / COUNT(*) AS ticket_medio
        FROM pedidos;
      `);

            // 2️⃣ Vendas por mês (últimos 6 meses)
            const [porMes] = await connection.promise().execute(`
        SELECT 
          DATE_FORMAT(created_at, '%Y-%m') AS mes,
          SUM(total_final) AS total_mes
        FROM pedidos
        WHERE status = 'PAGO'
        GROUP BY mes
        ORDER BY mes DESC
        LIMIT 6;
      `);

            // 3️⃣ Top produtos
            const [topProdutos] = await connection.promise().execute(`
        SELECT 
          pr.nome,
          SUM(pp.quantidade) AS quantidade_vendida,
          SUM(pp.subtotal) AS total_vendido
        FROM pedido_produto pp
        JOIN produtos pr ON pr.id = pp.produto_id
        JOIN pedidos pe ON pe.id = pp.pedido_id
        WHERE pe.status = 'PAGO'
        GROUP BY pr.id, pr.nome
        ORDER BY total_vendido DESC
        LIMIT 5;
      `);

            // 4️⃣ Top clientes
            const [topClientes] = await connection.promise().execute(`
        SELECT 
          u.nome,
          SUM(p.total_final) AS total_gasto,
          COUNT(p.id) AS pedidos
        FROM pedidos p
        JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.status = 'PAGO'
        GROUP BY u.id
        ORDER BY total_gasto DESC
        LIMIT 5;
      `);

            setJson(res, 200, {
                totais,
                porMes,
                topProdutos,
                topClientes
            });
        } catch (e) {
            console.error('Erro ao gerar dashboard:', e);
            setJson(res, 500, { message: 'Erro ao gerar dashboard' });
        }
    }
});
