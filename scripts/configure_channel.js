const axios = require('axios');

async function configure() {
  try {
    const profile = {
      channelName: "El Auto que Dura",
      goal: "Ajudar os motoristas na Espanha a economizar dinheiro com manutenção preventiva, cuidados básicos com o carro e preparação para a inspeção ITV.",
      targetAudience: "Motoristas e proprietários de veículos na Espanha interessados em mecânica básica, manutenção preventiva caseira, prevenção de quebras e economia na oficina.",
      brandVoice: "Claro, didático, direto e com autoridade sobre termos automotivos da Espanha (coche, maletero, ITV, averías, taller).",
      defaultStyle: "tutorial",
      callToAction: "Inscreva-se no canal para não perder nenhuma dica prática de cuidado e manutenção do seu carro!",
      visualStyle: "Imagens automotivas nítidas, alto contraste, estilo profissional, cinematográfico e prático",
      timezone: "Europe/Madrid",
      bannedTopics: []
    };

    const resProfile = await axios.put('http://localhost:3456/api/profile', profile);
    console.log('Perfil atualizado para PT-BR:', resProfile.data.success);

    const strategy = {
      objective: "Tornar-se o canal de referência na Espanha sobre cuidado e longevidade do carro, ensinando manutenção preventiva caseira e como evitar gastos desnecessários.",
      audience: "Proprietários de veículos na Espanha que buscam aumentar a vida útil do carro, passar na ITV sem problemas e evitar oficinas desonestas ou quebras caras.",
      valueProposition: "Dicas práticas, diretas e aplicáveis passo a passo para cuidar do motor, pneus, freios, fluidos e peças essenciais do veículo.",
      contentPillars: [
        "Manutenção básica de motor e fluidos",
        "Dicas práticas para passar na ITV de primeira",
        "Como economizar combustível e evitar desgastes",
        "Diagnóstico de barulhos e luzes do painel",
        "Limpeza e conservação automotiva"
      ],
      cadencePerWeek: 7,
      videosPerRun: 1,
      defaultFormat: "tutorial",
      defaultLength: "medium",
      successMetric: "Crescimento constante de inscritos na Espanha e alta retenção com tutoriais mecânicos práticos.",
      primaryKpi: "views",
      targetValue: 10000,
      targetWindowDays: 28,
      outcomeCurrency: "EUR",
      constraints: "Sem exageros, dados confiáveis de mecânica, foco em segurança, economia e conformidade com as normas da ITV.",
      status: "active"
    };

    const resStrategy = await axios.put('http://localhost:3456/api/operator/strategy', strategy);
    console.log('Estratégia atualizada para PT-BR:', resStrategy.data.success);
  } catch (err) {
    console.error('Erro ao configurar canal:', err.response?.data || err.message);
  }
}

configure();
