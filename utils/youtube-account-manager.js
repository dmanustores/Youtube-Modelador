const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { Logger } = require('./logger');

class YouTubeAccountManager {
  constructor(options = {}) {
    this.logger = new Logger('YouTubeAccountManager');
    this.baseDir = options.baseDir || path.join(__dirname, '..');
    this.accountsPath = path.join(this.baseDir, 'config', 'youtube_accounts.json');
    this.tokensPath = path.join(this.baseDir, 'config', 'tokens.json');
    this.credentialsPath = path.join(this.baseDir, 'config', 'credentials.json');
    this.data = {
      activeChannelId: null,
      accounts: []
    };
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this;
    await this.loadAccounts();
    await this.ensureInitialAccountDiscovered();
    this.initialized = true;
    return this;
  }

  async reload() {
    await this.loadAccounts();
    return this;
  }

  async loadAccounts() {
    try {
      if (fsSync.existsSync(this.accountsPath)) {
        const raw = await fs.readFile(this.accountsPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          activeChannelId: parsed.activeChannelId || null,
          accounts: Array.isArray(parsed.accounts) ? parsed.accounts : []
        };
      } else {
        this.data = { activeChannelId: null, accounts: [] };
      }
    } catch (err) {
      this.logger.warn(`Erro ao carregar youtube_accounts.json: ${err.message}`);
      this.data = { activeChannelId: null, accounts: [] };
    }
  }

  async saveAccounts() {
    try {
      await fs.mkdir(path.dirname(this.accountsPath), { recursive: true });
      await fs.writeFile(this.accountsPath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      this.logger.error(`Erro ao salvar youtube_accounts.json: ${err.message}`);
      throw err;
    }
  }

  getCredentials() {
    try {
      if (fsSync.existsSync(this.credentialsPath)) {
        return JSON.parse(fsSync.readFileSync(this.credentialsPath, 'utf8'));
      }
    } catch (_err) {
      /* ignore */
    }
    return {};
  }

  getTokens() {
    try {
      if (fsSync.existsSync(this.tokensPath)) {
        return JSON.parse(fsSync.readFileSync(this.tokensPath, 'utf8'));
      }
    } catch (_err) {
      /* ignore */
    }
    return {};
  }

  async ensureInitialAccountDiscovered() {
    if (this.data.accounts.length > 0) return;

    const tokens = this.getTokens();
    const creds = this.getCredentials();

    if (!tokens.youtube || !creds.youtube) {
      return;
    }

    try {
      const channelInfo = await this.fetchChannelInfo(tokens.youtube, creds.youtube);
      if (channelInfo && channelInfo.id) {
        const account = {
          channelId: channelInfo.id,
          title: channelInfo.title,
          customUrl: channelInfo.customUrl || '',
          description: channelInfo.description || '',
          thumbnail: channelInfo.thumbnail || '',
          subscriberCount: channelInfo.subscriberCount || '0',
          tokens: tokens.youtube,
          clientId: creds.youtube.client_id,
          clientSecret: creds.youtube.client_secret,
          connectedAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString()
        };
        this.data.accounts.push(account);
        this.data.activeChannelId = account.channelId;
        await this.saveAccounts();
        this.logger.info(`Conta atual do YouTube auto-registrada: ${account.title} (${account.channelId})`);
      }
    } catch (err) {
      // Se a rede estiver offline ou token expirado, registra com os dados locais conhecidos
      const fallbackName = creds.channel?.channelName || 'Canal Conectado';
      const fallbackAccount = {
        channelId: 'current_active',
        title: fallbackName,
        customUrl: fallbackName.startsWith('@') ? fallbackName : '',
        description: creds.channel?.channelDescription || '',
        thumbnail: '',
        subscriberCount: 'N/A',
        tokens: tokens.youtube,
        clientId: creds.youtube.client_id,
        clientSecret: creds.youtube.client_secret,
        connectedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString()
      };
      this.data.accounts.push(fallbackAccount);
      this.data.activeChannelId = fallbackAccount.channelId;
      await this.saveAccounts();
    }
  }

  async fetchChannelInfo(tokens, youtubeCreds) {
    const creds = youtubeCreds || this.getCredentials().youtube;
    if (!creds || !creds.client_id) {
      throw new Error('Credenciais do YouTube (client_id) não configuradas.');
    }

    const oauth2Client = new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      creds.redirect_uris?.[0] || 'http://127.0.0.1'
    );
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.channels.list({
      part: 'snippet,statistics,contentDetails',
      mine: true,
      maxResults: 1
    });

    const channel = response.data?.items?.[0];
    if (!channel) {
      throw new Error('A conta Google autorizada não possui nenhum canal do YouTube vinculado.');
    }

    return {
      id: channel.id,
      title: channel.snippet?.title || 'Canal sem nome',
      customUrl: channel.snippet?.customUrl || '',
      description: channel.snippet?.description || '',
      thumbnail: channel.snippet?.thumbnails?.default?.url || channel.snippet?.thumbnails?.medium?.url || '',
      subscriberCount: channel.statistics?.subscriberCount || 'Hidden',
      videoCount: channel.statistics?.videoCount || '0',
      viewCount: channel.statistics?.viewCount || '0'
    };
  }

  listAccounts() {
    const activeId = this.data.activeChannelId;
    return this.data.accounts.map(acc => ({
      channelId: acc.channelId,
      title: acc.title,
      customUrl: acc.customUrl,
      description: acc.description,
      thumbnail: acc.thumbnail,
      subscriberCount: acc.subscriberCount,
      videoCount: acc.videoCount,
      isActive: acc.channelId === activeId,
      connectedAt: acc.connectedAt,
      lastVerifiedAt: acc.lastVerifiedAt
    }));
  }

  getActiveAccount() {
    const active = this.data.accounts.find(a => a.channelId === this.data.activeChannelId);
    if (active) {
      return { ...active, isActive: true };
    }
    if (this.data.accounts.length > 0) {
      return { ...this.data.accounts[0], isActive: true };
    }
    return null;
  }

  async registerAccount({ tokens, channelInfo, credentials = null }) {
    if (!tokens) throw new Error('Tokens de autenticação são obrigatórios');
    if (!channelInfo || !channelInfo.id) throw new Error('Informações do canal são obrigatórias');

    const creds = credentials || this.getCredentials().youtube || {};
    const now = new Date().toISOString();

    const existingIndex = this.data.accounts.findIndex(a => a.channelId === channelInfo.id);
    const accountData = {
      channelId: channelInfo.id,
      title: channelInfo.title,
      customUrl: channelInfo.customUrl || '',
      description: channelInfo.description || '',
      thumbnail: channelInfo.thumbnail || '',
      subscriberCount: channelInfo.subscriberCount || '0',
      videoCount: channelInfo.videoCount || '0',
      tokens,
      clientId: creds.client_id || (existingIndex >= 0 ? this.data.accounts[existingIndex].clientId : ''),
      clientSecret: creds.client_secret || (existingIndex >= 0 ? this.data.accounts[existingIndex].clientSecret : ''),
      connectedAt: existingIndex >= 0 ? this.data.accounts[existingIndex].connectedAt : now,
      lastVerifiedAt: now
    };

    if (existingIndex >= 0) {
      this.data.accounts[existingIndex] = accountData;
    } else {
      this.data.accounts.push(accountData);
    }

    this.data.activeChannelId = channelInfo.id;
    await this.saveAccounts();

    // 1. Atualiza config/tokens.json
    await this.writeActiveTokens(tokens);

    // 2. Atualiza config/credentials.json
    await this.updateActiveCredentials(accountData);

    // 3. Atualiza SQLite channel_profiles
    await this.updateDatabaseChannelProfile(accountData);

    this.logger.info(`Conta registrada e ativada: ${accountData.title} (${accountData.channelId})`);
    return accountData;
  }

  async switchToAccount(channelId) {
    const account = this.data.accounts.find(a => a.channelId === channelId);
    if (!account) {
      throw new Error(`Conta com canal ID ${channelId} não encontrada nas contas salvas.`);
    }

    this.data.activeChannelId = channelId;
    await this.saveAccounts();

    // 1. Atualiza config/tokens.json
    await this.writeActiveTokens(account.tokens);

    // 2. Atualiza config/credentials.json
    await this.updateActiveCredentials(account);

    // 3. Atualiza SQLite
    await this.updateDatabaseChannelProfile(account);

    this.logger.info(`Alternado com sucesso para a conta: ${account.title} (${account.channelId})`);
    return { ...account, isActive: true };
  }

  async removeAccount(channelId) {
    const index = this.data.accounts.findIndex(a => a.channelId === channelId);
    if (index === -1) {
      throw new Error('Conta não encontrada.');
    }

    if (this.data.accounts.length <= 1) {
      throw new Error('Não é possível remover a única conta cadastrada.');
    }

    const wasActive = this.data.activeChannelId === channelId;
    this.data.accounts.splice(index, 1);

    if (wasActive) {
      const nextAccount = this.data.accounts[0];
      await this.switchToAccount(nextAccount.channelId);
    } else {
      await this.saveAccounts();
    }

    return { success: true, remaining: this.data.accounts.length };
  }

  async writeActiveTokens(tokens) {
    const tokenData = { youtube: tokens };
    await fs.mkdir(path.dirname(this.tokensPath), { recursive: true });
    await fs.writeFile(this.tokensPath, JSON.stringify(tokenData, null, 2), 'utf8');
  }

  async updateActiveCredentials(account) {
    try {
      const creds = this.getCredentials();
      if (!creds.channel) creds.channel = {};
      creds.channel.channelName = account.title;
      if (account.description && !creds.channel.channelDescription) {
        creds.channel.channelDescription = account.description;
      }
      if (account.clientId && account.clientSecret) {
        if (!creds.youtube) creds.youtube = { redirect_uris: ['http://127.0.0.1'] };
        creds.youtube.client_id = account.clientId;
        creds.youtube.client_secret = account.clientSecret;
      }
      await fs.writeFile(this.credentialsPath, JSON.stringify(creds, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn(`Erro ao atualizar credentials.json: ${err.message}`);
    }
  }

  async updateDatabaseChannelProfile(account) {
    try {
      const { Database } = require('../database/db');
      const db = new Database();
      await db.initialize();
      const current = await db.getChannelProfile() || {};
      await db.saveChannelProfile({
        ...current,
        channelName: account.title
      });
      await db.close();
    } catch (err) {
      this.logger.warn(`Não foi possível atualizar perfil no SQLite: ${err.message}`);
    }
  }

  async refreshActiveAccount() {
    const active = this.getActiveAccount();
    if (!active || !active.tokens) return null;

    try {
      const freshInfo = await this.fetchChannelInfo(active.tokens, {
        client_id: active.clientId,
        client_secret: active.clientSecret
      });
      const index = this.data.accounts.findIndex(a => a.channelId === active.channelId);
      if (index >= 0) {
        this.data.accounts[index] = {
          ...this.data.accounts[index],
          title: freshInfo.title,
          customUrl: freshInfo.customUrl,
          description: freshInfo.description,
          thumbnail: freshInfo.thumbnail,
          subscriberCount: freshInfo.subscriberCount,
          videoCount: freshInfo.videoCount,
          lastVerifiedAt: new Date().toISOString()
        };
        await this.saveAccounts();
        return this.data.accounts[index];
      }
    } catch (err) {
      this.logger.warn(`Erro ao atualizar dados do canal ativo via YouTube API: ${err.message}`);
    }
    return active;
  }
}

module.exports = { YouTubeAccountManager };
