// Configuracao do Expo: o app.json mais o arquivo do Firebase (FCM), que o
// Android precisa para gerar o token de push (android.googleServicesFile).
//
// De onde vem o google-services.json (o primeiro que existir):
//   1. EAS Build: variavel de ambiente do tipo ARQUIVO chamada
//      GOOGLE_SERVICES_JSON (o EAS entrega o caminho do arquivo enviado)
//   2. Local: barber-mobile/google-services.json (fora do Git, no .gitignore)
// Sem nenhum dos dois, o build segue normal, so que sem push (o app trata:
// o registro do aparelho falha em silencio e a central continua funcionando).
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const arquivo = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : undefined);
  if (!arquivo) return config;
  return { ...config, android: { ...config.android, googleServicesFile: arquivo } };
};
