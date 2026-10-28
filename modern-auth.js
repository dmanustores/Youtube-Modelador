const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const http = require('http');
const { URL } = require('url');
const { YouTubeAccountManager } = require('./utils/youtube-account-manager');

class ModernAuth {
  constructor(options = {}) {
    this.credentialsPath = options.credentialsPath || path.join(__dirname, 'config', 'credentials.json');
    this.tokensPath = options.tokensPath || path.join(__dirname, 'config', 'tokens.json');
    this.forceSelectAccount = options.forceSelectAccount !== false;
    this.customClientId = options.clientId || null;
    this.customClientSecret = options.clientSecret || null;
    this.customRedirectUri = options.redirectUri || null;
    this.incognito = options.incognito === true;
    this.onAuthUrl = options.onAuthUrl || null;
    this.authUrl = null;
    this.server = null;
    this.accountManager = new YouTubeAccountManager({ baseDir: __dirname });
    this.authPromise = null;
  }

  openBrowser(authUrl) {
    const { exec } = require('child_process');
    if (this.incognito) {
      if (process.platform === 'win32') {
        // Tenta abrir no Microsoft Edge InPrivate primeiro (padrão no Windows e onde o usuário usa InPrivate)
        // Se falhar ou não encontrar, tenta Google Chrome incognito, e fallback para navegador padrão
        exec(`start msedge -inprivate "${authUrl}"`, (edgeErr) => {
          if (edgeErr) {
            exec(`start chrome -incognito "${authUrl}"`, (chromeErr) => {
              if (chromeErr) {
                exec(`start "" "${authUrl}"`, () => {});
              }
            });
          }
        });
        return;
      } else if (process.platform === 'darwin') {
        exec(`open -na "Google Chrome" --args --incognito "${authUrl}"`, (err) => {
          if (err) exec(`open "${authUrl}"`, () => {});
        });
        return;
      } else {
        exec(`google-chrome --incognito "${authUrl}"`, (err) => {
          if (err) exec(`xdg-open "${authUrl}"`, () => {});
        });
        return;
      }
    }

    const openCommands = {
      win32: `start "" "${authUrl}"`,
      darwin: `open "${authUrl}"`,
      linux: `xdg-open "${authUrl}"`
    };
    if (openCommands[process.platform]) {
      exec(openCommands[process.platform], () => {});
    }
  }

  async initiateAuthUrl() {
    console.log(chalk.cyan.bold('\n🔐 Autenticação do YouTube (Fluxo com Seleção de Conta)'));
    console.log(chalk.gray('═'.repeat(60)));
    
    try {
      await this.accountManager.initialize();
      const credentials = fs.existsSync(this.credentialsPath)
        ? JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'))
        : {};
      
      const clientId = this.customClientId || credentials.youtube?.client_id;
      const clientSecret = this.customClientSecret || credentials.youtube?.client_secret;

      if (!clientId || !clientSecret) {
        throw new Error('Credenciais do YouTube (client_id ou client_secret) não configuradas em config/credentials.json');
      }

      const redirect = this.resolveRedirect(credentials);
      const redirectUri = redirect.uri;
      
      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri
      );

      const scopes = [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
        'https://www.googleapis.com/auth/youtube.force-ssl'
      ];

      this.authPromise = new Promise((resolve, reject) => {
        this.resolveAuth = resolve;
        this.rejectAuth = reject;
        this.authTimeout = setTimeout(() => {
          this.cleanup();
          reject(new Error('Tempo limite de autenticação esgotado (5 minutos)'));
        }, 300000);
      });

      // Start a temporary local server at the exact redirect URI used in the OAuth request.
      await this.startTempServer(redirect, oauth2Client, { clientId, clientSecret });
      
      // Generate auth URL com select_account para permitir trocar de conta/canal
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: this.forceSelectAccount ? 'consent select_account' : 'consent'
      });

      this.authUrl = authUrl;
      if (typeof this.onAuthUrl === 'function') {
        try {
          this.onAuthUrl(authUrl);
        } catch (_err) {
          /* ignore */
        }
      }

      console.log(chalk.cyan('🔗 Acesse esta URL no navegador para autorizar a conta desejada:'));
      console.log(chalk.blue(authUrl));

      this.openBrowser(authUrl);

      console.log(chalk.yellow(`\n⚡ Servidor temporário de callback ativo na porta ${redirect.port}`));
      console.log(chalk.yellow('Após selecionar a conta no Google e autorizar, você será redirecionado automaticamente.'));
      console.log(chalk.gray('Aguardando autorização no navegador...'));

      return authUrl;
    } catch (error) {
      this.cleanup();
      console.error(chalk.red('Falha na autenticação:'), error.message);
      throw error;
    }
  }

  async waitForCompletion() {
    if (!this.authPromise) {
      throw new Error('Fluxo de autenticação não foi iniciado. Chame initiateAuthUrl primeiro.');
    }
    return await this.authPromise;
  }

  async authenticate() {
    await this.initiateAuthUrl();
    return await this.waitForCompletion();
  }

  resolveRedirect(credentials) {
    if (this.customRedirectUri) {
      try {
        const candidate = new URL(this.customRedirectUri);
        return {
          uri: candidate.toString(),
          hostname: candidate.hostname,
          port: Number(candidate.port) || 8080,
          pathname: candidate.pathname || '/oauth2callback'
        };
      } catch (_err) {
        /* ignore */
      }
    }

    const explicitRedirect = process.env.YOUTUBE_REDIRECT_URI;
    const configured = [explicitRedirect, ...(credentials.youtube?.redirect_uris || [])].filter(Boolean);
    let redirect = null;
    for (const value of configured) {
      try {
        const candidate = new URL(value);
        if (candidate.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(candidate.hostname)) {
          redirect = candidate;
          break;
        }
      } catch (_error) {
        /* ignore */
      }
    }

    // Porta e caminho: se já especificados no redirect_uri configurado, respeita. Caso contrário, gera porta dinâmica.
    redirect ||= new URL('http://127.0.0.1/');
    if (!redirect.port) redirect.port = String(8000 + Math.floor(Math.random() * 1000));

    const fullUri = `${redirect.protocol}//${redirect.hostname}:${redirect.port}${redirect.pathname}`;
    return {
      uri: fullUri,
      hostname: redirect.hostname,
      port: Number(redirect.port),
      pathname: redirect.pathname
    };
  }

  async exchangeCodeForToken({ code, redirectUri, clientId, clientSecret }) {
    const creds = fs.existsSync(this.credentialsPath)
      ? JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'))
      : {};

    const activeClientId = clientId || this.customClientId || creds.youtube?.client_id;
    const activeClientSecret = clientSecret || this.customClientSecret || creds.youtube?.client_secret;

    if (!activeClientId || !activeClientSecret) {
      throw new Error('Credenciais do YouTube (client_id/client_secret) não configuradas.');
    }

    const oauth2Client = new google.auth.OAuth2(
      activeClientId,
      activeClientSecret,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Obter detalhes reais do canal via YouTube API
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const channelRes = await youtube.channels.list({
      part: 'snippet,statistics,contentDetails',
      mine: true,
      maxResults: 1
    });

    const channelItem = channelRes.data?.items?.[0];
    if (!channelItem) {
      throw new Error('A conta Google selecionada não possui nenhum canal do YouTube vinculado. Crie um canal no YouTube ou selecione outra conta.');
    }

    const channelInfo = {
      id: channelItem.id,
      title: channelItem.snippet?.title || 'Canal do YouTube',
      customUrl: channelItem.snippet?.customUrl || '',
      description: channelItem.snippet?.description || '',
      thumbnail: channelItem.snippet?.thumbnails?.default?.url || channelItem.snippet?.thumbnails?.medium?.url || '',
      subscriberCount: channelItem.statistics?.subscriberCount || 'Hidden',
      videoCount: channelItem.statistics?.videoCount || '0'
    };

    // Salvar no gerenciador de contas e atualizar tokens/credentials/db
    const registeredAccount = await this.accountManager.registerAccount({
      tokens,
      channelInfo,
      credentials: {
        client_id: activeClientId,
        client_secret: activeClientSecret
      }
    });

    return { tokens, channelInfo, registeredAccount };
  }

  async startTempServer(redirect, oauth2Client, clientCreds = {}) {
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url, redirect.uri);
      
      if (url.pathname === redirect.pathname) {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        
        if (error) {
          const isAccessDenied = error === 'access_denied';
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 40px; background: #0c0f14; color: #fff; line-height: 1.6;">
              <div style="max-width: 600px; margin: 0 auto; background: #161b22; padding: 32px; border-radius: 16px; border: 1px solid #30363d; text-align: left;">
                <h1 style="color: #ff4d5e; margin-top: 0; font-size: 22px; text-align: center;">❌ ${isAccessDenied ? 'Acesso Bloqueado pelo Google (Erro 403)' : 'Erro de Autorização'}</h1>
                <p style="color: #cbd5e1; font-size: 14px;">${escapeHTML(error)}</p>
                ${isAccessDenied ? `
                  <div style="background: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 14px; border-radius: 6px; margin: 20px 0;">
                    <strong style="color: #f59e0b; display: block; margin-bottom: 6px;">💡 Primeira vez conectando esta conta?</strong>
                    <p style="color: #e2e8f0; font-size: 13px; margin: 0 0 10px 0;">O aplicativo AgentTube está em modo de teste no Google Cloud. Para liberar o login:</p>
                    <ol style="color: #94a3b8; font-size: 12.5px; padding-left: 20px; margin: 0;">
                      <li style="margin-bottom: 6px;">Acesse a <a href="https://console.cloud.google.com/auth/audience" target="_blank" style="color: #38bdf8; text-decoration: underline;">Tela de Público-alvo no Google Cloud</a>;</li>
                      <li style="margin-bottom: 6px;">Role até <strong>Usuários de teste</strong> (<em>Test users</em>);</li>
                      <li style="margin-bottom: 6px;">Clique em <strong>+ ADD USERS</strong>, insira o seu e-mail e clique em <strong>Salvar</strong>;</li>
                      <li>Volte ao painel e tente conectar novamente.</li>
                    </ol>
                  </div>
                ` : ''}
                <p style="color: #888; font-size: 12px; text-align: center; margin-top: 20px;">Você pode fechar esta aba e retornar ao painel.</p>
              </div>
            </body>
            </html>
          `);
          console.log(chalk.red(`\n❌ Falha na autorização do Google: ${error}`));
          if (isAccessDenied) {
            console.log(chalk.yellow('💡 Dica: Adicione o e-mail da conta como "Usuário de teste" no Google Cloud Console:'));
            console.log(chalk.cyan('   https://console.cloud.google.com/auth/audience\n'));
          }
          this.rejectAuth(new Error(`Erro de autorização: ${error}${isAccessDenied ? ' (Conta não cadastrada como Usuário de Teste no Google Cloud)' : ''}`));
          return;
        }
        
        if (code) {
          try {
            const { channelInfo, registeredAccount, tokens } = await this.exchangeCodeForToken({
              code,
              redirectUri: redirect.uri,
              clientId: clientCreds.clientId,
              clientSecret: clientCreds.clientSecret
            });

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <!DOCTYPE html>
              <html lang="pt-BR">
                <head>
                  <meta charset="utf-8">
                  <title>YouTube Conectado</title>
                </head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #0c0f14; color: #fff; line-height: 1.6;">
                  <div style="max-width: 550px; margin: 0 auto; background: #161b22; padding: 40px; border-radius: 16px; border: 1px solid #30363d; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    <div style="font-size: 48px; margin-bottom: 10px;">🎉</div>
                    <h1 style="color: #4CAF50; margin-top: 0;">Autenticação Concluída com Sucesso!</h1>
                    ${channelInfo.thumbnail ? `<img src="${channelInfo.thumbnail}" style="width: 80px; height: 80px; border-radius: 50%; margin: 15px auto; border: 3px solid #4CAF50; display: block;" alt="Avatar">` : ''}
                    <h2 style="color: #58a6ff; margin: 10px 0;">${escapeHTML(channelInfo.title)}</h2>
                    ${channelInfo.customUrl ? `<p style="color: #8b949e; margin: 0;">${escapeHTML(channelInfo.customUrl)}</p>` : ''}
                    <p style="color: #8b949e; font-size: 13px; font-family: monospace;">ID: ${escapeHTML(channelInfo.id)}</p>
                    <div style="background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); border-radius: 8px; padding: 12px; margin: 25px 0;">
                      <p style="color: #4CAF50; margin: 0; font-weight: 600;">✅ Canal conectado ao agente de automação!</p>
                    </div>
                    <p style="color: #8b949e;">Você pode fechar esta aba e retornar ao terminal ou painel.</p>
                  </div>
                </body>
              </html>
            `);
            
            console.log(chalk.green(`\n✅ Autenticação concluída com sucesso para o canal: ${channelInfo.title}`));
            console.log(chalk.gray(`   Canal ID: ${channelInfo.id}`));
            if (channelInfo.customUrl) console.log(chalk.gray(`   Handle: ${channelInfo.customUrl}`));
            
            this.cleanup();
            this.resolveAuth({ tokens, channelInfo, registeredAccount });
            
          } catch (tokenError) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <!DOCTYPE html>
              <html lang="pt-BR">
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #0c0f14; color: #fff;">
                <h1 style="color: #ff4d5e;">❌ Falha na Troca de Token</h1>
                <p>${escapeHTML(tokenError.message)}</p>
                <p style="color: #888;">Retorne ao terminal para tentar novamente.</p>
              </body>
              </html>
            `);
            this.rejectAuth(tokenError);
          }
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="pt-BR">
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #0c0f14; color: #fff;">
              <h1>🎬 Agente de Automação do YouTube</h1>
              <p>Aguardando callback do Google OAuth...</p>
              <p>Conclua a autorização na outra aba aberta.</p>
            </body>
          </html>
        `);
      }
    });
    
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(redirect.port, redirect.hostname, resolve);
    });
    console.log(chalk.gray(`Servidor OAuth local iniciado em ${redirect.uri}`));
  }
  
  cleanup() {
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }
    if (this.server) {
      try {
        this.server.close();
      } catch (_err) {
        /* ignore */
      }
      this.server = null;
    }
  }

  async testAuthentication() {
    try {
      await this.accountManager.initialize();
      const active = this.accountManager.getActiveAccount();
      if (!active || !active.tokens) {
        console.log(chalk.red('❌ Nenhuma conta do YouTube configurada.'));
        return false;
      }

      const creds = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
      const clientId = active.clientId || creds.youtube?.client_id;
      const clientSecret = active.clientSecret || creds.youtube?.client_secret;

      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials(active.tokens);
      
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
      const response = await youtube.channels.list({
        part: 'snippet,statistics',
        mine: true
      });
      
      if (response.data.items && response.data.items.length > 0) {
        const channel = response.data.items[0];
        console.log(chalk.green(`✅ Conectado ao canal: ${channel.snippet.title}`));
        console.log(chalk.gray(`   Canal ID: ${channel.id}`));
        if (channel.snippet?.customUrl) {
          console.log(chalk.gray(`   Handle: ${channel.snippet.customUrl}`));
        }
        console.log(chalk.gray(`   Inscritos: ${channel.statistics?.subscriberCount || 'Oculto'}`));
        return true;
      } else {
        console.log(chalk.red('❌ Nenhum canal encontrado para a conta conectada.'));
        return false;
      }
    } catch (error) {
      console.error(chalk.red('Teste de autenticação falhou:'), error.message);
      return false;
    }
  }
}

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function runAuth() {
  const auth = new ModernAuth({ forceSelectAccount: true });
  
  try {
    const result = await auth.authenticate();
    
    console.log(chalk.cyan('\n🧪 Testando conexão com o canal...'));
    const success = await auth.testAuthentication();
    
    if (success) {
      console.log(chalk.green.bold('\n🎉 Autenticação Concluída com Sucesso!'));
      console.log(chalk.cyan(`O canal "${result?.channelInfo?.title || 'YouTube'}" agora está pronto para automação!`));
      console.log(chalk.yellow('\n📋 Próximos Passos:'));
      console.log(chalk.white('1. Executar: npm start'));
      console.log(chalk.white('2. Acessar o painel: http://localhost:3456'));
    } else {
      console.log(chalk.red('\n❌ Teste de autenticação falhou.'));
    }
  } catch (error) {
    console.error(chalk.red('\nFalha no processo de autenticação:'), error.message);
    if (error.message.includes('timeout') || error.message.includes('limite')) {
      console.log(chalk.yellow('\n💡 Dica: Tente novamente — a janela de autorização pode ter expirado ou sido fechada.'));
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runAuth();
}

module.exports = { ModernAuth };
