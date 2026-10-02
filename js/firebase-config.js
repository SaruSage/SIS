// ============================================================
// PROJETO GOLDEN — Conexão com o Firebase
// ============================================================
// Este arquivo é a "ponte" entre o nosso site e os servidores
// do Firebase. Ele é importado pelo login.js.
//
// ⚠️ IMPORTANTE: substitua os valores em MAIÚSCULAS pelos dados
// do seu firebaseConfig (Console Firebase → ícone </> → seu app).
// ============================================================

// IMPORTAÇÕES — O Firebase é entregue pela internet via CDN
// (endereço oficial do Google). "import" traz funções prontas
// para usar, sem precisar instalar nada no computador.

// initializeApp: função que registra nosso projeto no Firebase.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";


// getAuth: função que cria o "serviço de autenticação"
// (login, senha, sessão do usuário).
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { getFirestore } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// ------------------------------------------------------------
// CONFIGURAÇÃO DO PROJETO
// Essas chaves identificam SEU projeto no Firebase.
// Elas não são segredo (aparecem no site de qualquer jeito) —
// a segurança real fica nas regras do Firebase, não aqui.
// ------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyAd-A2FFUjLV9IAysUMsyvkts_lKFLTAlk",
  authDomain: "projeto-golden-734d9.firebaseapp.com",
  projectId: "projeto-golden-734d9",
  storageBucket: "projeto-golden-734d9.firebasestorage.app",
  messagingSenderId: "680826493831",
  appId: "1:680826493831:web:70b45b088dcb0ee8bc9122"
};

// ------------------------------------------------------------
// INICIALIZAÇÃO
// 1. initializeApp(...) conecta o site ao projeto do Firebase.
// 2. getAuth(...) cria o objeto "auth", que será usado pelo
//    login.js para fazer login de verdade.
// 3. "export" torna o "auth" visível para outros arquivos JS.
// ------------------------------------------------------------
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { firebaseConfig };
