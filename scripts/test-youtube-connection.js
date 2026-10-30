const { CredentialManager } = require('../utils/credential-manager');
const { google } = require('googleapis');

async function testYouTube() {
  console.log('\n🔍 TESTE DE CONEXÃO COM A API DO YOUTUBE...');
  console.log('──────────────────────────────────────────────────');

  try {
    const creds = new CredentialManager();
    await creds.initialize();

    if (!creds.tokens.youtube) {
      console.log('❌ NENHUM TOKEN ENCONTRADO em config/tokens.json');
      console.log('👉 Execute: npm run auth:youtube para conectar sua conta.');
      process.exit(1);
    }

    const expiry = creds.tokens.youtube.expiry_date ? new Date(creds.tokens.youtube.expiry_date) : null;
    console.log('📅 Data de expiração registrada:', expiry ? expiry.toLocaleString('pt-BR') : 'Desconhecida');
    console.log('🔑 Possui Refresh Token:', Boolean(creds.tokens.youtube.refresh_token) ? 'Sim' : 'Não');

    const auth = creds.getYouTubeAuth();
    const youtube = google.youtube({ version: 'v3', auth });

    console.log('\n📡 Consultando dados do canal na API oficial do Google...');
    const response = await youtube.channels.list({
      part: 'snippet,statistics',
      mine: true
    });

    const channel = response.data?.items?.[0];
    if (channel) {
      console.log('──────────────────────────────────────────────────');
      console.log('✅ CONEXÃO COM O YOUTUBE BEM-SUCEDIDA!');
      console.log('📺 Canal Conectado:', channel.snippet?.title);
      console.log('🆔 ID do Canal:', channel.id);
      console.log('👥 Inscritos:', channel.statistics?.subscriberCount || 'Oculto');
      console.log('🎬 Total de Vídeos:', channel.statistics?.videoCount || 0);
      console.log('──────────────────────────────────────────────────\n');
      process.exit(0);
    } else {
      console.log('⚠️ Token autenticado, mas nenhum canal foi retornado.');
      process.exit(1);
    }
  } catch (error) {
    console.log('──────────────────────────────────────────────────');
    console.log('❌ FALHA NA CONEXÃO COM A API DO YOUTUBE!');
    console.log('⚠️ Motivo:', error.message);
    if (error.response?.data?.error === 'invalid_grant' || error.message.includes('invalid_grant')) {
      console.log('\n💡 DIAGNÓSTICO:');
      console.log('   O Google revogou ou expirou o token de autorização OAuth (invalid_grant).');
      console.log('   Isso ocorre quando o app no Google Cloud Console está em modo de teste (expira em 7 dias)');
      console.log('   ou quando as permissões foram alteradas na Conta Google.');
      console.log('\n👉 COMO RESOLVER:');
      console.log('   1. No painel (http://localhost:3456/#config), clique em "Conectar Canal do YouTube"');
      console.log('   OU');
      console.log('   2. No terminal, execute: npm run auth:youtube');
    }
    console.log('──────────────────────────────────────────────────\n');
    process.exit(1);
  }
}

testYouTube();
