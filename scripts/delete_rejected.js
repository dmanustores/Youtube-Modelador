const { Database } = require('../database/db');
const { Logger } = require('../utils/logger');

const logger = new Logger('CleanRejected');

async function main() {
  const db = new Database();
  await db.initialize();

  logger.info('Buscando projetos com status "rejeitado"...');
  const rows = await db.getAllRows(
    `SELECT p.id, p.created_at, ps.script
     FROM productions p
     LEFT JOIN production_snapshots ps ON ps.production_id = p.id
     WHERE p.status = 'rejected'`
  );

  if (!rows.length) {
    logger.info('Nenhum projeto rejeitado encontrado no banco de dados.');
    await db.close();
    process.exit(0);
  }

  console.log(`\n📋 Encontrados ${rows.length} projeto(s) rejeitado(s):`);
  for (const row of rows) {
    const script = JSON.parse(row.script || '{}');
    const title = script.title || '(Sem título)';
    console.log(` - [${row.id}] ${title} (${row.created_at || 'sem data'})`);
  }

  logger.info('Excluindo registros e arquivos vinculados...');
  const deleted = await db.deleteRejectedProductions(true);

  logger.success(`✅ ${deleted.length} projeto(s) rejeitado(s) foram excluídos permanentemente com sucesso!`);
  await db.close();
}

main().catch(err => {
  logger.error('Erro ao excluir projetos rejeitados:', err);
  process.exit(1);
});
