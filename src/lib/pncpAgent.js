const https = require('https');

// O PNCP usa certificado ICP-Brasil/SERPRO não reconhecido pelo bundle padrão do Node.js.
// rejectUnauthorized: false é aceitável aqui pois o domínio é governamental fixo (pncp.gov.br),
// não uma URL arbitrária de terceiros. Não remover: sem isso qualquer chamada ao PNCP falha com
// UNABLE_TO_VERIFY_LEAF_SIGNATURE e o erro é engolido silenciosamente pelo código de retry.
const pncpAgent = new https.Agent({ rejectUnauthorized: false });

module.exports = pncpAgent;
