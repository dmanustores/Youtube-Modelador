const chalk = require('chalk');
const inquirer = require('inquirer');
const { YouTubeAccountManager } = require('../utils/youtube-account-manager');
const { ModernAuth } = require('../modern-auth');
const { Database } = require('../database/db');

async function main() {
  console.clear();
  console.log(chalk.red.bold('\n╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.red.bold('║              🎬 TROCA DE CONTA DO YOUTUBE                    ║'));
  console.log(chalk.red.bold('║           Gerenciador de Canais & Autenticação               ║'));
  console.log(chalk.red.bold('╚══════════════════════════════════════════════════════════════╝\n'));

  const accountManager = new YouTubeAccountManager();
  await accountManager.initialize();

  while (true) {
    const active = accountManager.getActiveAccount();
    const accounts = accountManager.listAccounts();

    console.log(chalk.cyan.bold('📌 Canal do YouTube Atualmente Conectado:'));
    if (active) {
      console.log(`  ${chalk.white.bold('Nome:')}       ${chalk.green.bold(active.title)}`);
      if (active.customUrl) {
        console.log(`  ${chalk.white.bold('Handle:')}     ${chalk.cyan(active.customUrl)}`);
      }
      console.log(`  ${chalk.white.bold('Canal ID:')}   ${chalk.gray(active.channelId)}`);
      console.log(`  ${chalk.white.bold('Inscritos:')}  ${chalk.yellow(active.subscriberCount || 'Oculto')}`);
      console.log(`  ${chalk.white.bold('Status:')}     ${chalk.green('✅ Conectado e Autorizado')}`);
    } else {
      console.log(`  ${chalk.red('❌ Nenhuma conta do YouTube conectada atualmente.')}`);
    }
    console.log(chalk.gray('─'.repeat(62)));

    const choices = [];

    choices.push({
      name: '🌐 Conectar nova conta / canal do YouTube (abre seletor do Google)',
      value: 'connect_new'
    });

    if (accounts.length > 1) {
      choices.push({
        name: `🔁 Alternar para outra conta salva (${accounts.length} contas disponíveis)`,
        value: 'switch_saved'
      });
    }

    if (active) {
      choices.push({
        name: '🔄 Reconectar / Renovar permissões do canal atual',
        value: 'reconnect'
      });
      choices.push({
        name: '🔍 Testar conexão e ver estatísticas do canal atual',
        value: 'test_current'
      });
    }

    if (accounts.length > 1) {
      choices.push({
        name: '🗑️  Remover uma conta salva do histórico',
        value: 'remove_account'
      });
    }

    choices.push(new inquirer.Separator());
    choices.push({
      name: '🚪 Sair',
      value: 'exit'
    });

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'O que você deseja fazer?',
        choices
      }
    ]);

    if (action === 'exit') {
      console.log(chalk.yellow('\nOperação encerrada. Até logo!\n'));
      break;
    }

    if (action === 'connect_new') {
      await handleConnectNewAccount(accountManager, active);
    } else if (action === 'switch_saved') {
      await handleSwitchSaved(accountManager);
    } else if (action === 'reconnect') {
      await handleReconnect(accountManager, active);
    } else if (action === 'test_current') {
      await handleTestCurrent(accountManager);
    } else if (action === 'remove_account') {
      await handleRemoveAccount(accountManager);
    }

    console.log('\n' + chalk.gray('═'.repeat(62)) + '\n');
  }
}

async function handleConnectNewAccount(accountManager, currentActive) {
  console.log(chalk.cyan.bold('\n🔗 Conectar Nova Conta do YouTube'));
  console.log(chalk.gray('Você será direcionado ao Google para selecionar a conta e o canal desejados.'));

  const creds = accountManager.getCredentials();
  const currentClientId = currentActive?.clientId || creds.youtube?.client_id;
  const currentClientSecret = currentActive?.clientSecret || creds.youtube?.client_secret;

  let clientId = currentClientId;
  let clientSecret = currentClientSecret;

  if (currentClientId) {
    const { useExistingCreds } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useExistingCreds',
        message: `Deseja usar as mesmas credenciais do Google Cloud atuais? (Client ID: ${currentClientId.substring(0, 16)}...)`,
        default: true
      }
    ]);

    if (!useExistingCreds) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'clientId',
          message: 'Informe o novo YouTube Client ID:',
          validate: input => input.trim().length > 0 || 'Client ID é obrigatório'
        },
        {
          type: 'password',
          name: 'clientSecret',
          mask: '*',
          message: 'Informe o novo YouTube Client Secret:',
          validate: input => input.trim().length > 0 || 'Client Secret é obrigatório'
        }
      ]);
      clientId = answers.clientId.trim();
      clientSecret = answers.clientSecret.trim();
    }
  } else {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'clientId',
        message: 'Informe o YouTube Client ID:',
        validate: input => input.trim().length > 0 || 'Client ID é obrigatório'
      },
      {
        type: 'password',
        name: 'clientSecret',
        mask: '*',
        message: 'Informe o YouTube Client Secret:',
        validate: input => input.trim().length > 0 || 'Client Secret é obrigatório'
      }
    ]);
    clientId = answers.clientId.trim();
    clientSecret = answers.clientSecret.trim();
  }

  const auth = new ModernAuth({
    forceSelectAccount: true,
    clientId,
    clientSecret
  });

  try {
    const result = await auth.authenticate();
    console.log(chalk.green.bold('\n🎉 Conta do YouTube conectada e salva com sucesso!'));
    console.log(chalk.white(`Canal Conectado: ${chalk.green.bold(result.channelInfo.title)} (${result.channelInfo.id})`));

    // Perguntar se deseja atualizar o perfil do canal no banco de dados
    const { updateProfile } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'updateProfile',
        message: `Deseja atualizar o nome do canal no perfil do estúdio para "${result.channelInfo.title}"?`,
        default: true
      }
    ]);

    if (updateProfile) {
      try {
        const db = new Database();
        await db.initialize();
        const profile = await db.getChannelProfile() || {};
        await db.saveChannelProfile({
          ...profile,
          channelName: result.channelInfo.title
        });
        await db.close();
        console.log(chalk.green('✅ Perfil do canal atualizado no banco de dados.'));
      } catch (err) {
        console.log(chalk.yellow(`⚠️ Não foi possível atualizar perfil: ${err.message}`));
      }
    }

    await accountManager.initialize();
  } catch (error) {
    console.log(chalk.red(`\n❌ Falha ao conectar conta: ${error.message}`));
  }
}

async function handleSwitchSaved(accountManager) {
  const accounts = accountManager.listAccounts();
  const active = accountManager.getActiveAccount();

  const choices = accounts.map(acc => ({
    name: `${acc.isActive ? '👉 [ATIVA] ' : '   '}${acc.title} ${acc.customUrl ? `(${acc.customUrl})` : ''} — ID: ${acc.channelId}`,
    value: acc.channelId
  }));

  const { selectedChannelId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedChannelId',
      message: 'Selecione a conta para a qual deseja alternar:',
      choices,
      default: active?.channelId
    }
  ]);

  if (selectedChannelId === active?.channelId) {
    console.log(chalk.yellow('Esta conta já está atualmente ativa.'));
    return;
  }

  try {
    const switched = await accountManager.switchToAccount(selectedChannelId);
    console.log(chalk.green.bold(`\n✅ Sucesso! O projeto agora está operando no canal "${switched.title}".`));
  } catch (err) {
    console.log(chalk.red(`❌ Erro ao alternar conta: ${err.message}`));
  }
}

async function handleReconnect(accountManager, currentActive) {
  console.log(chalk.cyan(`\n🔄 Reconectando autorização do canal "${currentActive.title}"...`));

  const auth = new ModernAuth({
    forceSelectAccount: true,
    clientId: currentActive.clientId,
    clientSecret: currentActive.clientSecret
  });

  try {
    await auth.authenticate();
    console.log(chalk.green.bold('\n✅ Autorização renovada com sucesso!'));
    await accountManager.initialize();
  } catch (err) {
    console.log(chalk.red(`❌ Falha ao renovar autorização: ${err.message}`));
  }
}

async function handleTestCurrent(accountManager) {
  console.log(chalk.cyan('\n🔍 Testando conexão com YouTube Data API...'));
  const active = accountManager.getActiveAccount();
  if (!active) {
    console.log(chalk.red('Nenhuma conta ativa para testar.'));
    return;
  }

  try {
    const fresh = await accountManager.refreshActiveAccount();
    if (fresh) {
      console.log(chalk.green.bold('✅ Conexão bem-sucedida!'));
      console.log(`  ${chalk.white.bold('Título:')}       ${fresh.title}`);
      if (fresh.customUrl) console.log(`  ${chalk.white.bold('Handle:')}       ${fresh.customUrl}`);
      console.log(`  ${chalk.white.bold('Canal ID:')}     ${fresh.channelId}`);
      console.log(`  ${chalk.white.bold('Inscritos:')}    ${fresh.subscriberCount}`);
      console.log(`  ${chalk.white.bold('Vídeos:')}       ${fresh.videoCount}`);
      console.log(`  ${chalk.white.bold('Última checagem:')} ${fresh.lastVerifiedAt}`);
    }
  } catch (err) {
    console.log(chalk.red(`❌ Falha no teste: ${err.message}`));
  }
}

async function handleRemoveAccount(accountManager) {
  const accounts = accountManager.listAccounts();

  const choices = accounts.map(acc => ({
    name: `${acc.title} ${acc.customUrl ? `(${acc.customUrl})` : ''} ${acc.isActive ? '[ATIVA]' : ''}`,
    value: acc.channelId
  }));

  const { channelId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'channelId',
      message: 'Escolha a conta que deseja remover do histórico:',
      choices
    }
  ]);

  const target = accounts.find(a => a.channelId === channelId);
  const { confirmDelete } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmDelete',
      message: `Tem certeza que deseja remover "${target.title}"? ${target.isActive ? '(Como esta é a conta ativa, outra conta será ativada)' : ''}`,
      default: false
    }
  ]);

  if (!confirmDelete) {
    console.log(chalk.yellow('Operação cancelada.'));
    return;
  }

  try {
    await accountManager.removeAccount(channelId);
    console.log(chalk.green(`✅ Conta "${target.title}" removida com sucesso.`));
  } catch (err) {
    console.log(chalk.red(`❌ Não foi possível remover: ${err.message}`));
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(chalk.red('Erro fatal:'), err);
    process.exit(1);
  });
}

module.exports = { main };
