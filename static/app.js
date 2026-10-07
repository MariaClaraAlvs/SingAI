let mediaRecorder;
let audioChunks = [];
let musicaSelecionada = "";

function classeCor(index) {
  return `c${index % 5}`;
}

function handleCapaError(img, letra) {
  // Se a imagem da capa não existir, volta pro fallback com a letra inicial
  const capa = img.parentElement;
  capa.innerHTML = letra;
}

function capaHTML(identificador, letra, index, classeBase = "capa") {
  return `
    <div class="${classeBase} ${classeCor(index)}">
      <img src="/static/capas/${identificador}.jpg" alt="${letra}" onerror="handleCapaError(this, '${letra}')">
    </div>
  `;
}

async function carregarMusicas() {
  const resposta = await fetch("/musicas");
  const dados = await resposta.json();

  const catalogo = document.getElementById("catalogo");
  const select = document.getElementById("listaMusicas");

  dados.musicas.forEach((musica, index) => {
    const card = document.createElement("div");
    card.className = "musica-card";
    card.innerHTML = `
      ${capaHTML(musica.id, musica.titulo.charAt(0).toUpperCase(), index)}
      <div class="nome">${musica.titulo}</div>
    `;
    card.addEventListener("click", () => abrirModal(musica.id));
    catalogo.appendChild(card);

    const opcao = document.createElement("option");
    opcao.value = musica.id;
    opcao.textContent = musica.titulo;
    select.appendChild(opcao);
  });
}

async function carregarHistorico() {
  const resposta = await fetch("/historico?limite=5");
  const dados = await resposta.json();
  const container = document.getElementById("historico");

  if (dados.historico.length === 0) {
    container.innerHTML = `<div class="historico-item"><span class="mensagem-vazia">Nenhuma performance ainda</span></div>`;
    return;
  }

  container.innerHTML = "";
  dados.historico.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "historico-item";
    div.innerHTML = `
      ${capaHTML(item.musica_id, item.musica_id.charAt(0).toUpperCase(), index, "historico-capa")}
      <div class="historico-info">
        <div class="historico-nome">${item.musica_id.replace(/_/g, " ")}</div>
        <div style="font-size:0.75rem; opacity:0.6;">${item.usuario}</div>
        <div class="barra"><div class="barra-preenchida ${classeCor(index)}" style="width:${item.pontuacao}%"></div></div>
      </div>
      <div class="score">${item.pontuacao}%</div>
    `;
    container.appendChild(div);
  });
}

function abrirModal(musica) {
  document.getElementById("modalFundo").classList.add("aberto");
  if (musica) {
    document.getElementById("listaMusicas").value = musica;
  }
  document.getElementById("resultado").textContent = "Escolha uma música e comece a gravar!";

  // Carrega e toca o áudio original da música selecionada
  const musicaAtual = musica || document.getElementById("listaMusicas").value;
  const player = document.getElementById("playerMusica");
  if (musicaAtual && player) {
    player.src = `/musica-audio/${musicaAtual}`;
    player.load(); // força o navegador a recarregar a nova fonte (necessário ao trocar o src de um <audio> já usado)
    player.play().catch((erro) => {
      // Alguns navegadores bloqueiam autoplay sem interação prévia do usuário;
      // nesse caso os controles do player permitem apertar play manualmente.
      console.warn("Não foi possível iniciar o áudio automaticamente:", erro);
    });
  }
}

function fecharModal() {
  document.getElementById("modalFundo").classList.remove("aberto");

  // Para a música ao fechar o modal
  const player = document.getElementById("playerMusica");
  if (player) {
    player.pause();
    player.currentTime = 0;
  }
}

async function iniciarGravacao() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = (evento) => {
    audioChunks.push(evento.data);
  };
  mediaRecorder.start();
  document.getElementById("btnGravar").disabled = true;
  document.getElementById("btnParar").disabled = false;
}

function pararGravacao() {
  mediaRecorder.stop();

  mediaRecorder.onstop = async () => {
    const nomeUsuario = document.getElementById("nomeUsuario").value.trim() || "Anônimo";
    const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
    musicaSelecionada = document.getElementById("listaMusicas").value;
    const nomeArquivo = `${musicaSelecionada}_${Date.now()}.wav`;

    const formData = new FormData();
    formData.append("audio", audioBlob, nomeArquivo);

    document.getElementById("resultado").textContent = "Enviando áudio...";

    const respostaGravar = await fetch("/gravar", {
      method: "POST",
      body: formData,
    });
    const dadosGravar = await respostaGravar.json();

    document.getElementById("resultado").textContent = "Calculando pontuação...";

    const respostaPontuar = await fetch(
      `/pontuar?nome_arquivo=${dadosGravar.arquivo}&musica_id=${musicaSelecionada}&usuario=${encodeURIComponent(nomeUsuario)}`,
      { method: "POST" }
    );
    const resultado = await respostaPontuar.json();

    document.getElementById("resultado").innerHTML = `
      <p><b>Pontuação:</b> ${resultado.pontuacao}</p>
      <p><b>Transcrição:</b> ${resultado.transcricao}</p>
    `;

    carregarHistorico();
  };

  document.getElementById("btnGravar").disabled = false;
  document.getElementById("btnParar").disabled = true;
}

/* ---------- NAVEGAÇÃO ENTRE TELAS ---------- */

function trocarView(nomeView) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("view-ativa", view.id === `view-${nomeView}`);
  });

  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle("ativo", item.dataset.view === nomeView);
  });

  if (nomeView === "ranking") {
    carregarRanking();
  }
}

/* ---------- TELA DE PERFIL ---------- */

async function verPerfil() {
  const nome = document.getElementById("perfilNome").value.trim();
  const container = document.getElementById("perfilResultado");

  if (!nome) {
    container.innerHTML = `<p class="mensagem-vazia">Digite um nome para ver o perfil.</p>`;
    return;
  }

  container.innerHTML = `<p class="mensagem-vazia">Carregando...</p>`;

  const resposta = await fetch(`/historico?usuario=${encodeURIComponent(nome)}&limite=100`);
  const dados = await resposta.json();

  if (dados.historico.length === 0) {
    container.innerHTML = `<p class="mensagem-vazia">Nenhuma performance encontrada para "${nome}". Confira se o nome foi digitado do mesmo jeito usado ao gravar.</p>`;
    return;
  }

  const pontuacoes = dados.historico.map((item) => item.pontuacao);
  const total = pontuacoes.length;
  const melhor = Math.max(...pontuacoes);
  const media = (pontuacoes.reduce((soma, p) => soma + p, 0) / total).toFixed(2);

  let html = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-valor">${total}</div>
        <div class="stat-label">Performances</div>
      </div>
      <div class="stat-card">
        <div class="stat-valor">${melhor}%</div>
        <div class="stat-label">Melhor pontuação</div>
      </div>
      <div class="stat-card">
        <div class="stat-valor">${media}%</div>
        <div class="stat-label">Média</div>
      </div>
    </div>
    <div class="perfil-lista-titulo">Histórico de ${nome}</div>
  `;

  dados.historico.forEach((item, index) => {
    html += `
      <div class="historico-item">
        ${capaHTML(item.musica_id, item.musica_id.charAt(0).toUpperCase(), index, "historico-capa")}
        <div class="historico-info">
          <div class="historico-nome">${item.musica_id.replace(/_/g, " ")}</div>
          <div class="barra"><div class="barra-preenchida ${classeCor(index)}" style="width:${item.pontuacao}%"></div></div>
        </div>
        <div class="score">${item.pontuacao}%</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/* ---------- TELA DE RANKING ---------- */

async function carregarRanking() {
  const container = document.getElementById("rankingLista");
  container.innerHTML = `<p class="mensagem-vazia">Carregando...</p>`;

  const resposta = await fetch("/ranking?limite=10");
  const dados = await resposta.json();

  if (dados.ranking.length === 0) {
    container.innerHTML = `<p class="mensagem-vazia">Ainda não há performances registradas.</p>`;
    return;
  }

  const medalhas = ["ouro", "prata", "bronze"];

  container.innerHTML = "";
  dados.ranking.forEach((item, index) => {
    const classeMedalha = medalhas[index] || "";
    const div = document.createElement("div");
    div.className = "ranking-item";
    div.innerHTML = `
      <div class="ranking-pos ${classeMedalha}">${index + 1}</div>
      <div class="ranking-nome">${item.usuario}</div>
      <div class="ranking-nota">${item.melhor_pontuacao}%</div>
    `;
    container.appendChild(div);
  });
}

/* ---------- EVENTOS ---------- */

document.getElementById("btnGravar").addEventListener("click", iniciarGravacao);
document.getElementById("btnParar").addEventListener("click", pararGravacao);
document.getElementById("btnAbrirModal").addEventListener("click", () => abrirModal());
document.getElementById("fecharModal").addEventListener("click", fecharModal);

document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
  item.addEventListener("click", () => trocarView(item.dataset.view));
});

document.getElementById("btnAtalhoPerfil").addEventListener("click", () => trocarView("perfil"));
document.getElementById("btnVerPerfil").addEventListener("click", verPerfil);
document.getElementById("perfilNome").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") verPerfil();
});

document.getElementById("btnComecarCantar").addEventListener("click", () => {
  document.getElementById("telaAbertura").classList.add("saindo");
});

carregarMusicas();
carregarHistorico();
